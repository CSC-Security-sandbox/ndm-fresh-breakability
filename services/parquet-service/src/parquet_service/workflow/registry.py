"""Single source of truth for Temporal worker registration (SPEC §6).

Imported by `worker.py` only — never by workflow code — so it stays out of the workflow
sandbox. Register a new workflow/activity here once and the worker picks it up automatically
(rather than maintaining a hand-edited list in worker.py that's easy to forget).
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

ALL_WORKFLOWS = [ScanIngestionWorkflow, MergeSortChildWorkflow]

ALL_ACTIVITIES: list[Callable[..., Any]] = [
    consume_stream,
    sort_per_file,
    build_merkle,
    compare_diff,
    consume_errors,
    promote_and_retain,
    merge_sort_activity,
]
