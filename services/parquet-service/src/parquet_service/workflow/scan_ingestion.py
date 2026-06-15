"""ScanIngestionWorkflow (SPEC §6) — orchestrates ingest -> sort -> merge -> merkle -> diff.

Branches on run_mode (D5):
  * incremental: one source leg, diff vs prior source snapshot.
  * baseline:    source + dest legs in parallel, diff source-vs-dest.

Signals (D16): `action` in {Running, Paused, Stopped}; consume_stream honours it at the rotation
boundary. Merge/diff are atomic w.r.t. pause/stop. On completion (both parquet stream(s) and the error
stream drained to EOF, and diff emitted) signal the parent MigrationWorkflow.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from .activities import (
        build_merkle,
        compare_diff,
        consume_errors,
        consume_stream,
        promote_and_retain,
        sort_per_file,
    )
    from .merge_child import MergeSortChildWorkflow
    from .types import (
        DiffInput,
        IngestLegInput,
        JobRunStatus,
        RunMode,
        ScanIngestionInput,
        ScanIngestionResult,
    )

_ACTIVITY_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=5),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(minutes=2),
    maximum_attempts=3,
)


@workflow.defn(name="ScanIngestionWorkflow")
class ScanIngestionWorkflow:
    def __init__(self) -> None:
        self._action: str = JobRunStatus.RUNNING.value

    # --- signals/queries ---
    @workflow.signal
    def action(self, status: str) -> None:
        self._action = status

    @workflow.query
    def current_action(self) -> str:
        return self._action

    # --- main ---
    @workflow.run
    async def run(self, inp: ScanIngestionInput) -> ScanIngestionResult:
        workflow.logger.info("ScanIngestion start jobRun=%s mode=%s", inp.job_run_id, inp.run_mode)

        legs = [_leg(inp, inp.source_path_id, "src")]
        if inp.run_mode == RunMode.BASELINE.value:
            if not inp.dest_path_id:
                raise ValueError("baseline run_mode requires dest_path_id")
            legs.append(_leg(inp, inp.dest_path_id, "dst"))

        # Ingest legs (+ error stream) run concurrently; each leg: consume -> sort -> merge(child) -> merkle.
        await asyncio.gather(
            *[self._ingest_leg(leg) for leg in legs],
            self._consume_errors(legs[0]),
        )

        # Diff once snapshots exist.
        diff = DiffInput(
            account_id=inp.account_id, job_config_id=inp.job_config_id, job_run_id=inp.job_run_id,
            source_path_id=inp.source_path_id, run_mode=inp.run_mode, dest_path_id=inp.dest_path_id,
        )
        diff_res = await workflow.execute_activity(
            compare_diff, diff, start_to_close_timeout=timedelta(hours=6), retry_policy=_ACTIVITY_RETRY
        )

        await workflow.execute_activity(
            promote_and_retain, diff, start_to_close_timeout=timedelta(minutes=30), retry_policy=_ACTIVITY_RETRY
        )

        # TODO: signal the parent MigrationWorkflow with {status, commands_emitted} (SPEC §6 / completion).
        return ScanIngestionResult(
            job_run_id=inp.job_run_id,
            commands_emitted=diff_res.commands_emitted,
            subtrees_skipped=diff_res.subtrees_skipped,
        )

    async def _ingest_leg(self, leg: IngestLegInput) -> None:
        await workflow.execute_activity(
            consume_stream, leg, start_to_close_timeout=timedelta(hours=6),
            heartbeat_timeout=timedelta(minutes=5), retry_policy=_ACTIVITY_RETRY,
        )
        await workflow.execute_activity(
            sort_per_file, leg, start_to_close_timeout=timedelta(hours=6), retry_policy=_ACTIVITY_RETRY
        )
        await workflow.execute_child_workflow(
            MergeSortChildWorkflow.run, leg, id=f"merge-{leg.job_run_id}-{leg.path_id}-{leg.side}"
        )
        await workflow.execute_activity(
            build_merkle, leg, start_to_close_timeout=timedelta(hours=6), retry_policy=_ACTIVITY_RETRY
        )

    async def _consume_errors(self, leg: IngestLegInput) -> None:
        await workflow.execute_activity(
            consume_errors, leg, start_to_close_timeout=timedelta(hours=6),
            heartbeat_timeout=timedelta(minutes=5), retry_policy=_ACTIVITY_RETRY,
        )


def _leg(inp: ScanIngestionInput, path_id: str, side: str) -> "IngestLegInput":
    return IngestLegInput(
        account_id=inp.account_id, job_config_id=inp.job_config_id, job_run_id=inp.job_run_id,
        path_id=path_id, side=side,
    )
