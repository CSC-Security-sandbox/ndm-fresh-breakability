"""Unit tests for the config poller + parsing (no HTTP server / Temporal needed)."""

from __future__ import annotations

import asyncio

import pytest

from parquet_service.config import Settings
from parquet_service.work_manager import (
    ConfigPoller,
    WorkerConfig,
    extract_entries,
    parse_config,
)
from parquet_service.worker_manager import WorkerManager


def _settings() -> Settings:
    return Settings.from_env(
        {"WORKER_CONFIG_URL": "http://cfg:8080", "CONFIG_ENDPOINT": "parquet-config"}
    )


# --- parsing ---------------------------------------------------------------


def test_parse_config_camelcase_and_aliases() -> None:
    cfg = parse_config(
        {
            "jobRunID": "job1",
            "source": "src1",
            "destination": "dst1",
            "taskQueue": "parquet-job1-taskqueue",
            "workflowID": "parquet-job1",
            "status": "active",
        }
    )
    assert cfg == WorkerConfig(
        task_queue="parquet-job1-taskqueue",
        job_run_id="job1",
        source_path_id="src1",
        dest_path_id="dst1",
        workflow_id="parquet-job1",
    )


def test_parse_config_null_destination_ok() -> None:
    cfg = parse_config({"jobRunID": "j", "source": "s", "destination": None, "taskQueue": "q"})
    assert cfg is not None and cfg.dest_path_id is None


def test_parse_config_missing_task_queue_is_skipped() -> None:
    assert parse_config({"jobRunID": "j", "source": "s"}) is None


def test_extract_entries_shapes() -> None:
    bare = [{"taskQueue": "q1"}, {"taskQueue": "q2"}]
    assert extract_entries(bare) == bare
    assert extract_entries({"data": {"items": {"metaConfig": bare}}}) == bare
    assert extract_entries({"items": bare}) == bare
    assert extract_entries([]) == []  # a cleanly-empty roster is valid (tears all workers down)


def test_extract_entries_unrecognised_shape_raises() -> None:
    # An unrecognised shape must NOT be silently read as "no jobs" (that would nuke all workers).
    with pytest.raises(ValueError):
        extract_entries({"unexpected": 1})


# --- poller ----------------------------------------------------------------


class _FakeResponse:
    def __init__(self, payload: object) -> None:
        self._payload = payload
        self.status_code = 200

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        return self._payload


class _FakeHttp:
    def __init__(self, payload: object) -> None:
        self.payload = payload
        self.calls: list[tuple[str, dict[str, str] | None]] = []

    async def get(
        self, url: str, *, headers: dict[str, str] | None = None, timeout: float | None = None
    ) -> _FakeResponse:
        self.calls.append((url, headers))
        return _FakeResponse(self.payload)


class _FakeWorker:
    def __init__(self, task_queue: str) -> None:
        self._stop = asyncio.Event()

    async def run(self) -> None:
        await self._stop.wait()

    async def shutdown(self) -> None:
        self._stop.set()


def test_poller_fetch_builds_url_and_parses() -> None:
    http = _FakeHttp([{"taskQueue": "q1", "jobRunID": "j1"}, {"foo": "bar"}])

    async def scenario() -> None:
        mgr = WorkerManager(None, _settings(), worker_factory=lambda tq: _FakeWorker(tq))
        poller = ConfigPoller(mgr, _settings(), http)
        configs = await poller.fetch()
        assert [c.task_queue for c in configs] == ["q1"]  # the no-taskQueue entry is dropped
        assert http.calls[0][0] == "http://cfg:8080/api/v1/work-manager/parquet-config"

    asyncio.run(scenario())


def test_poller_poll_once_reconciles_workers() -> None:
    http = _FakeHttp([{"taskQueue": "parquet-j1-taskqueue"}, {"taskQueue": "parquet-j2-taskqueue"}])

    async def scenario() -> None:
        mgr = WorkerManager(None, _settings(), worker_factory=lambda tq: _FakeWorker(tq))
        poller = ConfigPoller(mgr, _settings(), http)
        await poller.poll_once()
        assert mgr.active_queues() == ["parquet-j1-taskqueue", "parquet-j2-taskqueue"]

        # Job j1 completes -> dropped from the response -> its worker is torn down.
        http.payload = [{"taskQueue": "parquet-j2-taskqueue"}]
        await poller.poll_once()
        assert mgr.active_queues() == ["parquet-j2-taskqueue"]
        await mgr.shutdown()

    asyncio.run(scenario())


def test_poller_skips_reconcile_on_unrecognised_payload() -> None:
    http = _FakeHttp([{"taskQueue": "parquet-j1-taskqueue"}])

    async def scenario() -> None:
        mgr = WorkerManager(None, _settings(), worker_factory=lambda tq: _FakeWorker(tq))
        poller = ConfigPoller(mgr, _settings(), http)
        await poller.poll_once()
        assert mgr.active_queues() == ["parquet-j1-taskqueue"]

        # Upstream returns garbage -> poll_once swallows it and leaves the worker running.
        http.payload = {"unexpected": 1}
        await poller.poll_once()
        assert mgr.active_queues() == ["parquet-j1-taskqueue"]
        await mgr.shutdown()

    asyncio.run(scenario())
