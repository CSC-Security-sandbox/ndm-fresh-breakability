"""Shared workflow/activity payloads (Pydantic-free dataclasses; Temporal default JSON converter)."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class RunMode(str, Enum):
    BASELINE = "baseline"      # scan source + dest, diff src-vs-dst (D5)
    INCREMENTAL = "incremental"  # scan source only, diff vs prior source snapshot


class JobRunStatus(str, Enum):
    RUNNING = "Running"
    PAUSED = "Paused"
    STOPPED = "Stopped"


@dataclass
class ScanIngestionInput:
    account_id: str
    job_config_id: str
    job_run_id: str
    source_path_id: str
    run_mode: str = RunMode.INCREMENTAL.value
    dest_path_id: str | None = None       # required when run_mode == baseline
    feature_flag_ctx: dict | None = None


@dataclass
class IngestLegInput:
    """One ingest leg: source ('src') or destination ('dst')."""
    account_id: str
    job_config_id: str
    job_run_id: str
    path_id: str
    side: str  # "src" | "dst"


@dataclass
class DiffInput:
    account_id: str
    job_config_id: str
    job_run_id: str
    source_path_id: str
    run_mode: str
    dest_path_id: str | None = None


# --- Activity / workflow result payloads (typed boundaries, symmetric with the inputs above).
# Temporal's default JSON converter (re)builds these from the callee's return annotation. ---


@dataclass
class ConsumeResult:
    rows: int
    side: str
    path_id: str


@dataclass
class SortResult:
    sorted_files: int


@dataclass
class MergeResult:
    inputs: int
    merged: str


@dataclass
class MerkleResult:
    root_hash: str
    n_dirs: int


@dataclass
class DiffResult:
    commands_emitted: int
    subtrees_skipped: int


@dataclass
class ErrorsResult:
    """consume_errors output. Fields provisional until the activity is implemented (SPEC §3.3)."""

    rows: int
    sealed_files: int


@dataclass
class PromoteResult:
    """promote_and_retain output. Fields provisional until implemented (SPEC §8 / D14)."""

    snapshots_deleted: int
    bytes_freed: int


@dataclass
class ScanIngestionResult:
    job_run_id: str
    commands_emitted: int
    subtrees_skipped: int
