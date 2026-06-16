"""Worker-only work-manager entrypoint: poll config -> run one Temporal Worker per active job.

Run ONE container — `python -m parquet_service.serve` — and it:
  1. connects to Temporal,
  2. polls the work-manager config endpoint on an interval (`ConfigPoller`),
  3. reconciles in-process Temporal Workers to the returned job task-queues (`WorkerManager`),
  4. serves a light `/health` + `/metrics` surface.

It does NOT start workflows: the TS side starts `ScanIngestionWorkflow` (id `parquet-{jobRunId}`) on the
job's `parquet-{jobId}-taskqueue` via the Temporal client; this process only guarantees a worker is
polling that queue. A job that stops/completes drops out of the config response and its worker is torn
down on the next cycle.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal

import httpx
import uvicorn
from fastapi import FastAPI
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from starlette.responses import Response
from temporalio.client import Client

from .config import Settings, get_settings
from .work_manager import ConfigPoller
from .worker_manager import WorkerManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger(__name__)


def build_app(manager: WorkerManager) -> FastAPI:
    app = FastAPI(title="parquet-service (work-manager: poll + dynamic workers)")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "active_workers": ",".join(manager.active_queues()) or "none"}

    @app.get("/metrics")
    async def metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    return app


async def main() -> None:
    s: Settings = get_settings()
    logger.info("work-manager: connecting temporal=%s ns=%s", s.temporal_address, s.temporal_namespace)
    # TODO (D15/§11): TLSConfig (mTLS) + JWT auth on Client.connect for non-dev.
    client = await Client.connect(s.temporal_address, namespace=s.temporal_namespace)

    manager = WorkerManager(client, s)
    app = build_app(manager)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    server = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=s.api_port, log_config=None))

    # TODO (D15): plug a Keycloak token_provider for the outbound poll once auth is wired (dev: none).
    async with httpx.AsyncClient() as http:
        poller = ConfigPoller(manager, s, http, token_provider=None)
        poller_task = asyncio.create_task(poller.run(stop), name="pqsvc-config-poller")
        server_task = asyncio.create_task(server.serve(), name="pqsvc-api")
        logger.info("work-manager: API on :%s; polling for jobs every %ss", s.api_port, s.poll_interval_s)
        try:
            await stop.wait()
        finally:
            server.should_exit = True
            stop.set()
            with contextlib.suppress(Exception):
                await poller_task
            with contextlib.suppress(Exception):
                await server_task
            await manager.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
