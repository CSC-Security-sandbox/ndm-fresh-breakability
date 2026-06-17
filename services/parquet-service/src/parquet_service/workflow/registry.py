"""Worker registration: the flat activity list every parquet worker registers.

Imported by `worker.py` / `worker_manager.py` only — never by workflow code — so it stays out
of the workflow sandbox.

Topology (worker-only work-manager): one Temporal Worker **per job**, polling that job's dynamic
task queue (`parquet-{jobRunId}-taskqueue`) and registering ONLY the activities below — workflows
live in the TS orchestrator now, so this process hosts no workflow definitions. The single per-job
worker runs both ingest legs (src + dst, distinguished by `IngestLegInput.side`) plus sort, merge,
merkle, diff and promote for that job.
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
from .merge_child import merge_sort_activity

# Everything a per-job worker registers on its dynamic task queue (activities only — no workflows).
ALL_ACTIVITIES: list[Callable[..., Any]] = [
    consume_stream,
    sort_per_file,
    build_merkle,
    compare_diff,
    consume_errors,
    promote_and_retain,
    merge_sort_activity,
]
