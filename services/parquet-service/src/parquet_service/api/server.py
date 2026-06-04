"""FastAPI surface (SPEC §5). Starts ScanIngestionWorkflow per (jobRunId, sourcePathId), idempotently.

Adapted from the local-python-temporal prototype: adds the per-path endpoint, run_mode, the worker
Bearer-JWT guard (D15), Redis-key idempotency (D9), and Prometheus metrics.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, Optional

import redis.asyncio as aioredis
from fastapi import Depends, FastAPI, HTTPException
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel, Field
from starlette.responses import Response
from temporalio.client import Client

from ..config import get_settings
from ..workflow.scan_ingestion import ScanIngestionWorkflow
from ..workflow.types import RunMode, ScanIngestionInput
from .auth import require_worker_auth

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger(__name__)

_client: Optional[Client] = None
_redis: Optional[aioredis.Redis] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _client, _redis
    s = get_settings()
    # TODO (D15/§11): pass TLSConfig (mTLS) + JWT auth to Client.connect for non-dev.
    _client = await Client.connect(s.temporal_address, namespace=s.temporal_namespace)
    _redis = aioredis.from_url(s.redis_url, decode_responses=True)
    logger.info("connected: temporal=%s redis ready", s.temporal_address)
    yield
    _client = None
    _redis = None


app = FastAPI(title="parquet-service", lifespan=lifespan)


class StartRequest(BaseModel):
    account_id: str = Field(..., min_length=1)
    job_config_id: str = Field(..., min_length=1)
    run_mode: RunMode = RunMode.INCREMENTAL
    dest_path_id: Optional[str] = Field(default=None, description="required when run_mode=baseline")
    feature_flag_ctx: Optional[dict[str, Any]] = None


class StartResponse(BaseModel):
    workflowId: str
    runId: str
    started: bool


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/metrics")
async def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


def _workflow_id(job_run_id: str, source_path_id: str) -> str:
    return f"ScanIngestionWorkflow-{job_run_id}-{source_path_id}-src"


@app.post("/workflows/{job_run_id}/{source_path_id}/start", response_model=StartResponse, status_code=202)
async def start(
    job_run_id: str,
    source_path_id: str,
    body: StartRequest,
    _user: dict = Depends(require_worker_auth),
) -> StartResponse:
    if _client is None or _redis is None:
        raise HTTPException(status_code=503, detail="service not ready")
    if body.run_mode == RunMode.BASELINE and not body.dest_path_id:
        raise HTTPException(status_code=400, detail="dest_path_id required for baseline")

    s = get_settings()
    wf_id = _workflow_id(job_run_id, source_path_id)
    idem_key = f"idemp:{job_run_id}:{source_path_id}"

    # D9: idempotent — SETNX a 24h key; if it already exists, return the existing run.
    is_new = await _redis.set(idem_key, wf_id, nx=True, ex=s.idempotency_ttl_s)
    if not is_new:
        handle = _client.get_workflow_handle(wf_id)
        desc = await handle.describe()
        return StartResponse(workflowId=wf_id, runId=desc.run_id, started=False)

    inp = ScanIngestionInput(
        account_id=body.account_id, job_config_id=body.job_config_id, job_run_id=job_run_id,
        source_path_id=source_path_id, run_mode=body.run_mode.value,
        dest_path_id=body.dest_path_id, feature_flag_ctx=body.feature_flag_ctx,
    )
    handle = await _client.start_workflow(
        ScanIngestionWorkflow.run, inp, id=wf_id, task_queue=s.task_queue
    )
    run_id = handle.result_run_id or handle.run_id
    logger.info("started %s run=%s mode=%s", wf_id, run_id, body.run_mode.value)
    return StartResponse(workflowId=wf_id, runId=run_id, started=True)


@app.get("/workflows/{job_run_id}/{source_path_id}")
async def describe(job_run_id: str, source_path_id: str, _user: dict = Depends(require_worker_auth)) -> dict:
    if _client is None:
        raise HTTPException(status_code=503, detail="service not ready")
    handle = _client.get_workflow_handle(_workflow_id(job_run_id, source_path_id))
    desc = await handle.describe()
    return {"workflowId": handle.id, "runId": desc.run_id, "status": desc.status.name if desc.status else "UNKNOWN"}
