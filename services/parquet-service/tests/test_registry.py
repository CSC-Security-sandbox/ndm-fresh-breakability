"""Parquet workers register activities only — workflows live in the TS orchestrator now."""

from __future__ import annotations

from parquet_service.workflow import registry


def test_registry_exposes_activities() -> None:
    assert registry.ALL_ACTIVITIES, "expected at least one activity registered"


def test_registry_has_no_workflows() -> None:
    # The worker-only model must not reintroduce workflow registration in parquet-service.
    assert not hasattr(registry, "ALL_WORKFLOWS")
