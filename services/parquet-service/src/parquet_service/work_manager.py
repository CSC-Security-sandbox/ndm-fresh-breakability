"""Config poller (worker-only work-manager front end).

Mirrors the TS `WorkManagerService` cron: every `poll_interval_s`, GET the work-manager config endpoint,
map each returned entry to its dynamic task queue, and `reconcile()` the running workers to that set.
We never start workflows here — the TS side does that via the Temporal client; the poll only decides
which job queues need a worker polling them. A job that has stopped/completed is dropped from the
response, which tears its worker down on the next cycle.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Protocol

from .config import Settings
from .worker_manager import WorkerManager

logger = logging.getLogger(__name__)

TokenProvider = Callable[[], Awaitable[str | None]]


@dataclass(frozen=True)
class WorkerConfig:
    """One entry from the work-manager config poll.

    Only `task_queue` drives behaviour (it's what the worker polls). `job_run_id` / `source_path_id` /
    `dest_path_id` are carried for logging/identity — under the worker-only model the workflow input the
    TS starter passes is what actually feeds the stream-reading activity (SPEC §6), not these copies.
    """

    task_queue: str
    job_run_id: str | None = None
    source_path_id: str | None = None
    dest_path_id: str | None = None
    workflow_id: str | None = None


def _first(d: dict[str, Any], *keys: str) -> Any:
    """Return the first present, non-None value among `keys` (tolerates camelCase variants)."""
    for k in keys:
        if d.get(k) is not None:
            return d[k]
    return None


def parse_config(obj: dict[str, Any]) -> WorkerConfig | None:
    """Map one raw entry to a WorkerConfig, or None if it has no task queue (can't run a worker)."""
    task_queue = _first(obj, "taskQueue", "task_queue", "taskQueueId")
    if not task_queue:
        logger.warning("config entry missing taskQueue, skipping: %s", obj)
        return None
    return WorkerConfig(
        task_queue=str(task_queue),
        job_run_id=_first(obj, "jobRunID", "jobRunId", "job_run_id"),
        source_path_id=_first(obj, "source", "sourcePathId", "source_path_id"),
        dest_path_id=_first(obj, "destination", "destPathId", "dest_path_id"),
        workflow_id=_first(obj, "workflowID", "workflowId", "workflow_id"),
    )


def extract_entries(payload: Any) -> list[dict[str, Any]]:
    """Pull the config list out of the response, tolerating the NDM ResponseInterceptor envelope.

    Accepts a bare list, `{items: [...]}`, `{data: {items: [...]}}`, or
    `{data: {items: {metaConfig: [...]}}}` (worker-service shape).
    """
    if isinstance(payload, list):
        return [e for e in payload if isinstance(e, dict)]
    if isinstance(payload, dict):
        node: Any = payload.get("data", payload)
        if isinstance(node, dict):
            node = node.get("items", node)
        if isinstance(node, dict):
            node = node.get("metaConfig", node)
        if isinstance(node, list):
            return [e for e in node if isinstance(e, dict)]
    logger.warning("unrecognised config payload shape: %s", type(payload).__name__)
    return []


class _ResponseLike(Protocol):
    status_code: int

    def raise_for_status(self) -> Any: ...
    def json(self) -> Any: ...


class _HttpClientLike(Protocol):
    async def get(
        self, url: str, *, headers: dict[str, str] | None = ..., timeout: float | None = ...
    ) -> _ResponseLike: ...


class ConfigPoller:
    """Polls the work-manager config endpoint on an interval and reconciles workers to it."""

    def __init__(
        self,
        manager: WorkerManager,
        settings: Settings,
        http_client: _HttpClientLike,
        *,
        token_provider: TokenProvider | None = None,
    ) -> None:
        self._manager = manager
        self._settings = settings
        self._http = http_client
        self._token_provider = token_provider
        self._url = f"{settings.worker_config_url}/api/v1/work-manager/{settings.config_endpoint}"

    async def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self._token_provider is not None:
            token = await self._token_provider()
            if token:
                headers["Authorization"] = f"Bearer {token}"
        return headers

    async def fetch(self) -> list[WorkerConfig]:
        resp = await self._http.get(
            self._url, headers=await self._headers(), timeout=self._settings.poll_timeout_s
        )
        resp.raise_for_status()
        entries = extract_entries(resp.json())
        configs = [c for c in (parse_config(e) for e in entries) if c is not None]
        return configs

    async def poll_once(self) -> None:
        configs = await self.fetch()
        queues = {c.task_queue for c in configs}
        started, stopped = await self._manager.reconcile(queues)
        if started or stopped:
            logger.info("reconciled workers: started=%s stopped=%s", started, stopped)
        else:
            logger.debug("reconciled: %d active worker(s), no change", len(queues))

    async def run(self, stop: asyncio.Event) -> None:
        """Poll until `stop` is set; one cycle's failure is logged and the loop continues."""
        logger.info(
            "config poller started url=%s interval=%ss", self._url, self._settings.poll_interval_s
        )
        while not stop.is_set():
            try:
                await self.poll_once()
            except Exception as exc:  # never let one bad cycle kill the loop
                logger.error("config poll cycle failed: %s", exc)
            # Sleep one interval, but wake immediately if asked to stop.
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=self._settings.poll_interval_s)
        logger.info("config poller stopped")
