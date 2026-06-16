"""Unit tests for the dynamic worker manager (no Temporal server needed)."""

from __future__ import annotations

import asyncio

from parquet_service.config import Settings
from parquet_service.worker_manager import WorkerManager


class _FakeWorker:
    """Stand-in for temporalio Worker: run() blocks until shutdown() is called."""

    def __init__(self, task_queue: str) -> None:
        self.task_queue = task_queue
        self._stop = asyncio.Event()
        self.shutdown_called = False

    async def run(self) -> None:
        await self._stop.wait()

    async def shutdown(self) -> None:
        self.shutdown_called = True
        self._stop.set()


def _settings() -> Settings:
    return Settings.from_env({"WORKER_SHUTDOWN_TIMEOUT": "2"})


def test_ensure_is_idempotent() -> None:
    created: list[str] = []

    def factory(tq: str) -> _FakeWorker:
        created.append(tq)
        return _FakeWorker(tq)

    async def scenario() -> None:
        mgr = WorkerManager(None, _settings(), worker_factory=factory)
        assert await mgr.ensure("parquet-job1-taskqueue") is True
        assert await mgr.ensure("parquet-job1-taskqueue") is False  # already running
        assert created == ["parquet-job1-taskqueue"]
        assert mgr.active_queues() == ["parquet-job1-taskqueue"]
        await mgr.shutdown()

    asyncio.run(scenario())


def test_reconcile_starts_new_and_stops_vanished() -> None:
    workers: dict[str, _FakeWorker] = {}

    def factory(tq: str) -> _FakeWorker:
        w = _FakeWorker(tq)
        workers[tq] = w
        return w

    async def scenario() -> None:
        mgr = WorkerManager(None, _settings(), worker_factory=factory)

        started, stopped = await mgr.reconcile(["q-a", "q-b"])
        assert started == ["q-a", "q-b"]
        assert stopped == []
        assert mgr.active_queues() == ["q-a", "q-b"]

        # q-b drops out, q-c appears: q-c starts, q-b is shut down, q-a stays.
        started, stopped = await mgr.reconcile(["q-a", "q-c"])
        assert started == ["q-c"]
        assert stopped == ["q-b"]
        assert mgr.active_queues() == ["q-a", "q-c"]
        assert workers["q-b"].shutdown_called is True

        # Empty desired set tears everything down.
        started, stopped = await mgr.reconcile([])
        assert started == []
        assert stopped == ["q-a", "q-c"]
        assert mgr.active_queues() == []

    asyncio.run(scenario())


def test_reconcile_no_change_is_noop() -> None:
    created: list[str] = []

    def factory(tq: str) -> _FakeWorker:
        created.append(tq)
        return _FakeWorker(tq)

    async def scenario() -> None:
        mgr = WorkerManager(None, _settings(), worker_factory=factory)
        await mgr.reconcile(["q-a"])
        started, stopped = await mgr.reconcile(["q-a"])
        assert started == [] and stopped == []
        assert created == ["q-a"]  # not recreated
        await mgr.shutdown()

    asyncio.run(scenario())


def test_shutdown_worker_cancels_on_timeout() -> None:
    class _StuckWorker(_FakeWorker):
        async def shutdown(self) -> None:
            self.shutdown_called = True  # ignores the signal — run() never returns

    async def scenario() -> None:
        mgr = WorkerManager(None, _settings(), worker_factory=lambda tq: _StuckWorker(tq))
        await mgr.ensure("q-stuck")
        await mgr.shutdown_worker("q-stuck")  # must not hang: cancels after WORKER_SHUTDOWN_TIMEOUT
        assert mgr.active_queues() == []

    asyncio.run(scenario())
