"""PVC layout + atomic-seal utility (SPEC §8, D7).

Layout:  /data/<accountId>/<jobConfigId>/<pathId>/<jobRunId>/{raw,merged,merkle,errors}/
"""

from __future__ import annotations

import contextlib
import os
from collections.abc import Iterator
from pathlib import Path

import pyarrow.parquet as pq


def run_dir(data_root: str, account_id: str, job_config_id: str, path_id: str, job_run_id: str) -> Path:
    return Path(data_root) / account_id / job_config_id / path_id / job_run_id


def raw_dir(run: Path) -> Path:
    return run / "raw"


def merged_path(run: Path, job_run_id: str, side: str) -> Path:
    return run / "merged" / f"{job_run_id}-{side}.parquet"


def merkle_path(run: Path, job_run_id: str) -> Path:
    return run / "merkle" / f"{job_run_id}.parquet"


def errors_dir(run: Path) -> Path:
    # D18: co-located under the same jobRun dir as the other scan-result Parquets.
    return run / "errors"


def find_prior_snapshot(
    data_root: str, account_id: str, job_config_id: str, source_path_id: str, current_job_run_id: str
) -> tuple[Path, Path] | None:
    """Return (merged, merkle) for the most-recent sealed prior run, else None (=> baseline-shaped).

    "Sealed" = a non-.tmp merkle Parquet exists (footer-validated at seal time, SPEC §10.3).
    jobRunIds are time-ordered; we pick the newest that is not the current run.
    """
    base = Path(data_root) / account_id / job_config_id / source_path_id
    if not base.is_dir():
        return None
    candidates = []
    for child in base.iterdir():
        if not child.is_dir() or child.name == current_job_run_id:
            continue
        mk = merkle_path(child, child.name)
        if mk.exists() and not mk.with_suffix(".parquet.tmp").exists():
            candidates.append(child.name)
    if not candidates:
        return None
    prior = sorted(candidates)[-1]  # TODO: order by true run timestamp, not lexical jobRunId
    prun = base / prior
    return merged_path(prun, prior, "src"), merkle_path(prun, prior)


@contextlib.contextmanager
def atomic_parquet(final_path: Path) -> Iterator[Path]:
    """Yield a .tmp path; on clean exit: validate footer -> rename -> fsync(dir). (D7 / §13.3)

    Usage:
        with atomic_parquet(dst) as tmp:
            pq.write_table(table, tmp, ...)
    """
    final_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = final_path.with_suffix(final_path.suffix + ".tmp")
    try:
        yield tmp
        promote_atomically(tmp, final_path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            tmp.unlink()
        raise


def sweep_tmp(directory: Path) -> int:
    """Delete orphaned *.tmp files (startup recovery / stop cleanup, D16 / §13.3). Returns count."""
    if not directory.is_dir():
        return 0
    n = 0
    for p in directory.glob("*.tmp"):
        with contextlib.suppress(FileNotFoundError):
            p.unlink()
            n += 1
    return n


# --- D7 atomic-seal primitives (single source of truth, shared by ParquetWriter + atomic_parquet) ---


def fsync_dir(directory: Path) -> None:
    """fsync a directory entry so a contained rename/unlink is durable (D7)."""
    fd = os.open(str(directory), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def validate_parquet_footer(path: Path) -> None:
    """Read just the Parquet footer; raises if the file is truncated or not valid Parquet (D7)."""
    pq.read_metadata(str(path))


def promote_atomically(tmp: Path, final: Path) -> None:
    """The D7 seal sequence: footer-validate the .tmp -> atomic rename -> fsync the parent dir."""
    validate_parquet_footer(tmp)
    tmp.replace(final)  # atomic on POSIX within the same mount
    fsync_dir(final.parent)
