"""Merge-sort activity (SPEC §6, D11).

The k-way merge of a leg's `*.sorted.parquet` files into one merged snapshot. It used to be isolated
in a `MergeSortChildWorkflow`; that orchestration now lives in the TS orchestrator, so this is a plain
activity. Long-running — the caller (TS workflow) sets the heartbeat/retry policy.
"""

from __future__ import annotations

from temporalio import activity

from ..config import get_settings
from ..lib import paths, sorter
from ..lib.schema import RAW_SCHEMA
from .types import IngestLegInput, MergeResult


@activity.defn(name="merge_sort")
def merge_sort_activity(leg: IngestLegInput) -> MergeResult:
    """k-way merge of the *.sorted.parquet files -> merged/<run>-<side>.parquet."""
    s = get_settings()
    run = paths.run_dir(s.data_root, leg.account_id, leg.job_config_id, leg.path_id, leg.job_run_id)
    sorted_inputs = sorted(paths.raw_dir(run).glob(f"{leg.job_run_id}-{leg.side}-*.sorted.parquet"))
    out = paths.merged_path(run, leg.job_run_id, leg.side)
    sorter.merge_sort(
        sorted_inputs, out, RAW_SCHEMA,
        fan_in=s.merge_fan_in, mem_budget_bytes=s.merge_mem_budget_bytes, spill_dir=s.spill_dir,
    )
    return MergeResult(inputs=len(sorted_inputs), merged=str(out))
