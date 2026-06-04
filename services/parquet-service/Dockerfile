# syntax=docker/dockerfile:1
# Single image for BOTH roles. The Helm Deployments override `command:` —
#   api    -> uvicorn parquet_service.api.server:app
#   worker -> python -m parquet_service.worker
# (docker-compose / `docker run` can do the same.) Default CMD = worker.
FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml ./
COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip setuptools wheel && \
    pip install .

ENV PYTHONUNBUFFERED=1
# PVC mounted here (D5 / §8)
ENV DATA_ROOT=/data
EXPOSE 6666

CMD ["python", "-m", "parquet_service.worker"]
