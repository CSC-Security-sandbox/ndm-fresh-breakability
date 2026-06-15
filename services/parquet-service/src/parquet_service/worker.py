"""Temporal worker entrypoint — registers ScanIngestionWorkflow + child + activities (SPEC §6)."""

from __future__ import annotations

import asyncio
import logging
import signal
from concurrent.futures import ThreadPoolExecutor

from temporalio.client import Client
from temporalio.worker import Worker

from .config import get_settings
from .workflow.registry import ALL_ACTIVITIES, ALL_WORKFLOWS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger(__name__)


async def main() -> None:
    s = get_settings()
    # TODO (D15/§11): TLSConfig (mTLS) + JWT auth on Client.connect for non-dev; JWT refresh cron 1380m.
    client = await Client.connect(s.temporal_address, namespace=s.temporal_namespace)

    worker = Worker(
        client,
        task_queue=s.task_queue,
        workflows=ALL_WORKFLOWS,
        activities=ALL_ACTIVITIES,
        activity_executor=ThreadPoolExecutor(max_workers=8),
    )

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    logger.info("worker listening on %s (queue=%s)", s.temporal_address, s.task_queue)
    async with worker:
        await stop.wait()
    logger.info("worker shutdown")


if __name__ == "__main__":
    asyncio.run(main())
