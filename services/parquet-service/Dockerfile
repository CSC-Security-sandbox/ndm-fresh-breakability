# syntax=docker/dockerfile:1
# Single image, three run modes — selected by the container command:
#   serve  (default) -> python -m parquet_service.serve             # work-manager: poll config + 1 worker/job
#   api              -> uvicorn parquet_service.api.server:app ...  # HTTP trigger API (dev/manual; starts workflows)
#   worker           -> python -m parquet_service.worker            # static single worker, all queues (dev/manual)
#
# Helm Deployments override `command:` to pick the role. The prod path is `serve`: it polls the
# work-manager config endpoint and runs ONE in-process Temporal Worker per active job (worker-only — the
# TS side starts the workflows). `api`/`worker` are kept for local/manual testing.
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
# uvicorn (serve + api modes) listens here
EXPOSE 6666

# Default to the all-in-one serve mode; override `command` for the split api/worker roles.
CMD ["python", "-m", "parquet_service.serve"]
