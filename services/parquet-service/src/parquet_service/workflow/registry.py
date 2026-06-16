"""Worker registration: the flat workflow/activity lists every parquet worker registers.

Imported by `worker.py` / `worker_manager.py` only — never by workflow code — so it stays out
of the workflow sandbox.

Topology (worker-only work-manager): one Temporal Worker **per job**, polling that job's dynamic
task queue (`parquet-{jobId}-taskqueue`) and registering the WHOLE bundle below. The merge child
inherits the parent's queue (the TS starter leaves `merge_task_queue` unset), so a single per-job
worker runs the entire ingest -> sort -> merge -> merkle -> diff pipeline.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .activities import (
    build_merkle,
    compare_diff,
    consume_errors,
    consume_stream,
    promote_and_retain,
    sort_per_file,
)
from .merge_child import MergeSortChildWorkflow, merge_sort_activity
from .scan_ingestion import ScanIngestionWorkflow

# Everything a per-job worker registers on its dynamic task queue.
ALL_WORKFLOWS: list[type[Any]] = [ScanIngestionWorkflow, MergeSortChildWorkflow]
ALL_ACTIVITIES: list[Callable[..., Any]] = [
    consume_stream,
    sort_per_file,
    build_merkle,
    compare_diff,
    consume_errors,
    promote_and_retain,
    merge_sort_activity,
]
