"""Merge-sort child workflow + activity (SPEC §6, D11).

Run as a CHILD workflow of ScanIngestionWorkflow so the long-running k-way merge is isolated with its
own heartbeat/retry policy (1 s heartbeat, 6 h start-to-close, retry only on transient IO).
"""

from __future__ import annotations

from datetime import timedelta

from temporalio import activity, workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from ..config import get_settings
    from ..lib import paths, sorter
    from ..lib.schema import RAW_SCHEMA
    from .types import IngestLegInput


@activity.defn(name="merge_sort")
def merge_sort_activity(leg: IngestLegInput) -> dict:
    """k-way merge of the *.sorted.parquet files -> merged/<run>-<side>.parquet."""
    s = get_settings()
    run = paths.run_dir(s.data_root, leg.account_id, leg.job_config_id, leg.path_id, leg.job_run_id)
    sorted_inputs = sorted(paths.raw_dir(run).glob(f"{leg.job_run_id}-{leg.side}-*.sorted.parquet"))
    out = paths.merged_path(run, leg.job_run_id, leg.side)
    sorter.merge_sort(
        sorted_inputs, out, RAW_SCHEMA,
        fan_in=s.merge_fan_in, mem_budget_bytes=s.merge_mem_budget_bytes, spill_dir=s.spill_dir,
    )
    return {"inputs": len(sorted_inputs), "merged": str(out)}


@workflow.defn(name="MergeSortChildWorkflow")
class MergeSortChildWorkflow:
    @workflow.run
    async def run(self, leg: IngestLegInput) -> dict:
        return await workflow.execute_activity(
            merge_sort_activity,
            leg,
            start_to_close_timeout=timedelta(hours=6),
            heartbeat_timeout=timedelta(seconds=1),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=5),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(minutes=2),
                maximum_attempts=3,
                # TODO: restrict retries to transient IO (non_retryable_error_types for fatal/corrupt).
            ),
        )
