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
