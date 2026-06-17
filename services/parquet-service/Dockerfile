# syntax=docker/dockerfile:1
# Single image, two run modes — selected by the container command:
#   serve  (default) -> python -m parquet_service.serve   # work-manager: poll config + 1 worker/job
#   worker           -> python -m parquet_service.worker  # static activity-only worker on TASK_QUEUE (dev/manual)
#
# Helm Deployments override `command:` to pick the role. The prod path is `serve`: it polls the
# work-manager config endpoint and runs ONE in-process Temporal Worker per active job (worker-only — the
# TS side hosts/starts the workflows). `worker` is kept for local/manual testing.
FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml ./
COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip setuptools wheel && \
    pip install .

ENV PYTHONUNBUFFERED=1
# Volume / PVC mounted here (D5 / §8); the worker writes Parquet under this root.
ENV DATA_ROOT=/data
# uvicorn (serve mode: /health + /metrics) listens here
EXPOSE 6666

# Default to the work-manager serve mode; override `command` for the dev worker role.
CMD ["python", "-m", "parquet_service.serve"]
