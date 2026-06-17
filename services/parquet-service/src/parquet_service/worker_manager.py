"""In-process dynamic Temporal worker manager (worker-only work-manager).

Mirrors the TS `WorkManagerService`: ONE process runs a Temporal Worker **per job**, each polling that
job's dynamic task queue (`parquet-{jobRunId}-taskqueue`) and registering activities only
(`ALL_ACTIVITIES`) — workflows live in the TS orchestrator. Workers are created/destroyed by
`reconcile()` against the list
returned by the config poll: a queue in the list with no worker is started; a worker whose queue is no
longer in the list is shut down. This process **never starts workflows** — the TS side does that via the
Temporal client; here we only guarantee a poller exists on each active job's queue.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from typing import Protocol

from temporalio.client import Client
from temporalio.worker import Worker

from .config import Settings
from .workflow.registry import ALL_ACTIVITIES

logger = logging.getLogger(__name__)


class _WorkerLike(Protocol):
    """Structural type for what the manager drives — satisfied by temporalio's Worker (and test fakes)."""

    async def run(self) -> None: ...
    async def shutdown(self) -> None: ...


# Factory takes the dynamic task queue to poll and returns a worker for it.
WorkerFactory = Callable[[str], _WorkerLike]


class WorkerManager:
    """Lazily creates and runs one Temporal Worker per job task-queue, all in this process."""

    def __init__(
        self,
        client: Client | None,
        settings: Settings,
        *,
        worker_factory: WorkerFactory | None = None,
    ) -> None:
        self._client = client
        self._settings = settings
        self._make_worker: WorkerFactory = worker_factory or self._default_factory
        self._workers: dict[str, _WorkerLike] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._lock = asyncio.Lock()

    def _default_factory(self, task_queue: str) -> _WorkerLike:
        if self._client is None:
            raise RuntimeError("WorkerManager needs a Temporal client to build real workers")
        return Worker(
            self._client,
            task_queue=task_queue,
            activities=ALL_ACTIVITIES,
            activity_executor=ThreadPoolExecutor(
                max_workers=self._settings.max_concurrent_activities
            ),
            max_concurrent_activities=self._settings.max_concurrent_activities,
        )

    async def ensure(self, task_queue: str) -> bool:
        """Start the worker for `task_queue` if not already running. Returns True if newly started."""
        async with self._lock:
            if task_queue in self._workers:
                return False
            worker = self._make_worker(task_queue)
            self._workers[task_queue] = worker
            self._tasks[task_queue] = asyncio.create_task(
                self._run(task_queue, worker), name=f"pqsvc-worker-{task_queue}"
            )
            logger.info("started worker queue=%s", task_queue)
            return True

    async def reconcile(self, desired: Iterable[str]) -> tuple[list[str], list[str]]:
        """Converge running workers to `desired` (presence-based, like TS handleConfigurations).

        Starts a worker for every desired queue without one; shuts down every running worker whose
        queue is no longer desired. Returns (started, stopped) task-queue names for logging/tests.
        """
        desired_set = set(desired)
        started: list[str] = []
        for task_queue in desired_set:
            if await self.ensure(task_queue):
                started.append(task_queue)

        stale = [tq for tq in self.active_queues() if tq not in desired_set]
        for task_queue in stale:
            await self.shutdown_worker(task_queue)
        return sorted(started), sorted(stale)

    def active_queues(self) -> list[str]:
        return sorted(self._workers)

    async def _run(self, task_queue: str, worker: _WorkerLike) -> None:
        try:
            await worker.run()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("worker queue=%s crashed", task_queue)
        finally:
            self._workers.pop(task_queue, None)
            self._tasks.pop(task_queue, None)

    async def shutdown_worker(self, task_queue: str) -> None:
        """Gracefully stop one worker: signal shutdown, then bounded-wait for its run task to finish.

        Assumes 'stopped/completed' jobs have already wound down (so the worker is idle); the bounded
        wait is insurance against yanking a still-running activity. On timeout the run task is cancelled.
        """
        async with self._lock:
            worker = self._workers.pop(task_queue, None)
            task = self._tasks.pop(task_queue, None)
        if worker is None:
            return
        logger.info("stopping worker queue=%s", task_queue)
        with contextlib.suppress(Exception):
            await worker.shutdown()
        if task is not None:
            try:
                await asyncio.wait_for(task, timeout=self._settings.worker_shutdown_timeout)
            except TimeoutError:
                logger.warning("worker queue=%s did not stop in time; cancelling", task_queue)
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task

    async def shutdown(self) -> None:
        """Gracefully stop every running worker."""
        for task_queue in self.active_queues():
            await self.shutdown_worker(task_queue)
        logger.info("worker manager shut down")
