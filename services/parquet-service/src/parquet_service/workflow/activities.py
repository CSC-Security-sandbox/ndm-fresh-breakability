"""Thin Temporal activity wrappers (SPEC §6). All algorithms live in lib/; these only wire I/O.

Activities are synchronous (run on the worker's ThreadPoolExecutor) since pyarrow/redis are sync.
"""

from __future__ import annotations

import logging
from pathlib import Path

import redis
from temporalio import activity

from ..config import get_settings
from ..io.checkpoint import CheckpointStore
from ..io.stream_reader import StreamReader
from ..io.stream_writer import StreamWriter
from ..lib import merkle, paths, sorter
from ..lib.comparator import ParquetComparator
from ..lib.parquet_writer import ParquetWriter, SealInfo
from ..lib.schema import RAW_SCHEMA, build_kv_metadata
from .types import DiffInput, IngestLegInput

logger = logging.getLogger(__name__)


def _redis() -> redis.Redis:
    return redis.from_url(get_settings().redis_url, decode_responses=False)


@activity.defn(name="consume_stream")
def consume_stream(leg: IngestLegInput) -> dict:
    """Drain the per-path parquet stream into rotated raw Parquet; ack-after-seal (D7)."""
    s = get_settings()
    client = _redis()
    reader = StreamReader(client, leg.job_run_id, leg.path_id, "filemeta", group=s.consumer_group)
    reader.ensure_group()
    run = paths.run_dir(s.data_root, leg.account_id, leg.job_config_id, leg.path_id, leg.job_run_id)

    kv = build_kv_metadata(
        jobconfig_id=leg.job_config_id, jobrun_id=leg.job_run_id, writer_version="0.1.0",
        source_path_id=leg.path_id if leg.side == "src" else None,
        dest_path_id=leg.path_id if leg.side == "dst" else None,
    )

    def on_seal(info: SealInfo) -> None:
        reader.ack(info.entry_ids)  # D7: ack only after the file is sealed
        activity.heartbeat(f"sealed={info.path.name} rows={info.rows}")

    writer = ParquetWriter(
        paths.raw_dir(run),
        lambda n: f"{leg.job_run_id}-{leg.side}-0-{n}.parquet",  # TODO: real {ts}
        RAW_SCHEMA, rotate_bytes=s.rotate_bytes, kv_metadata=kv, on_seal=on_seal,
    )

    # TODO: full drain loop with EOF detection, pause/stop check at rotation boundary (D16),
    #       and pending-list (XAUTOCLAIM) recovery on restart. See prototype drain_stream_to_parquet.
    rows = 0
    consumer = f"parquet-{activity.info().activity_id}"
    eof = False
    while not eof:
        entries = reader.consume(consumer, s.stream_batch_size, s.stream_block_ms)
        if not entries and reader.eof_seen():
            break
        for entry_id, fields in entries:
            if reader.is_eof(fields):
                eof = True
                continue
            payload = reader.decode(fields)
            if payload:
                writer.append(payload, entry_id)
                rows += 1
    writer.close()
    return {"rows": rows, "side": leg.side, "path_id": leg.path_id}


@activity.defn(name="sort_per_file")
def sort_per_file(leg: IngestLegInput) -> dict:
    """Sort each rotated raw Parquet -> separate *.sorted.parquet in the same folder (D8)."""
    s = get_settings()
    run = paths.run_dir(s.data_root, leg.account_id, leg.job_config_id, leg.path_id, leg.job_run_id)
    rdir = paths.raw_dir(run)
    n = 0
    for raw in sorted(rdir.glob(f"{leg.job_run_id}-{leg.side}-*.parquet")):
        if raw.name.endswith(".sorted.parquet"):
            continue
        dst = raw.with_suffix(".sorted.parquet")
        sorter.sort_file(raw, dst, RAW_SCHEMA)
        n += 1
        activity.heartbeat(f"sorted={raw.name}")
    return {"sorted_files": n}


@activity.defn(name="build_merkle")
def build_merkle(leg: IngestLegInput) -> dict:
    """Build the directory Merkle (children-only hash + copied dir attrs) from the merged file."""
    s = get_settings()
    run = paths.run_dir(s.data_root, leg.account_id, leg.job_config_id, leg.path_id, leg.job_run_id)
    merged = paths.merged_path(run, leg.job_run_id, leg.side)
    out = paths.merkle_path(run, leg.job_run_id)
    root = merkle.MerkleBuilder().build(merged, out)
    return {"root_hash": root.dir_hash, "n_dirs": root.n_dirs}


@activity.defn(name="compare_diff")
def compare_diff(diff: DiffInput) -> dict:
    """Diff snapshots, emit OPS_CMD to {jobRunId}:commands, checkpoint by dir_path (D14)."""
    s = get_settings()
    client = _redis()
    run = paths.run_dir(s.data_root, diff.account_id, diff.job_config_id, diff.source_path_id, diff.job_run_id)
    curr_merged = paths.merged_path(run, diff.job_run_id, "src")
    curr_merkle = paths.merkle_path(run, diff.job_run_id)

    if diff.run_mode == "baseline":
        assert diff.dest_path_id
        drun = paths.run_dir(s.data_root, diff.account_id, diff.job_config_id, diff.dest_path_id, diff.job_run_id)
        prior_merged = paths.merged_path(drun, diff.job_run_id, "dst")
        prior_merkle = paths.merkle_path(drun, diff.job_run_id)
    else:
        prior = paths.find_prior_snapshot(
            s.data_root, diff.account_id, diff.job_config_id, diff.source_path_id, diff.job_run_id
        )
        if prior is None:
            raise RuntimeError("incremental run with no prior source snapshot")
        prior_merged, prior_merkle = prior

    cmp = ParquetComparator(
        prior_merged, prior_merkle, curr_merged, curr_merkle,
        StreamWriter(client, diff.job_run_id),
        CheckpointStore(client, diff.job_run_id, diff.source_path_id, ttl_s=s.idempotency_ttl_s),
        batch=s.diff_batch_dirs,
    )
    stats = cmp.run()
    return {"commands_emitted": stats.commands_emitted, "subtrees_skipped": stats.subtrees_skipped}


@activity.defn(name="consume_errors")
def consume_errors(leg: IngestLegInput) -> dict:
    """Consume {jobRunId}:errors -> error Parquet under <jobRunId>/errors/ (write-only, Phase 1, D18)."""
    # TODO: drain errors stream to ERROR_SCHEMA Parquet via ParquetWriter, ack-after-seal.
    raise NotImplementedError("error-stream -> error Parquet (write-only) — SPEC §3.3 / D18")


@activity.defn(name="promote_and_retain")
def promote_and_retain(diff: DiffInput) -> dict:
    """On diff completion: drop raw/+*.sorted, delete the older snapshot, keep current as prior (D14)."""
    # TODO: implement retention per §8 (fsync(dir) after unlink). Dest-leg snapshot dropped at baseline.
    raise NotImplementedError("retention / promotion — SPEC §8 / D14")
