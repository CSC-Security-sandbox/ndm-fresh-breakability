# parquet-service

Python control-plane service for the NDM Parquet metadata-storage redesign.
Consumes the per-path Parquet Redis stream(s) published by the TS scan workers, lands columnar Parquet on the
CP local disk, builds a per-directory Merkle hash, diffs snapshots, and emits `OPS_CMD` commands to the
existing sync worker.

See [`SPEC.md`](./SPEC.md) for the full design and decisions (D1–D18).

## Layout

```
src/parquet_service/
  api/        FastAPI shell (trigger, health, metrics) + worker Bearer-JWT guard
  workflow/   ScanIngestionWorkflow + activities + merge-sort child workflow
  lib/        PURE library — schema, parquet writer, sorter, merkle, comparator, command, paths
  io/         Redis adapters — stream reader/writer, diff checkpoint
  config.py   env/Helm-value settings
  worker.py   Temporal worker entrypoint
tests/        fixtures + unit tests
helm/         chart bundled into the Control Plane Helm install
```

**Layering rule:** `lib/` has no Redis/Temporal/HTTP imports; only `io/`, `workflow/`, `api/` touch the
outside world. Activities are thin wrappers; algorithms live in `lib/`.

## Local dev

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
export REDIS_URL=redis://default:redis@localhost:6379/0
export TEMPORAL_ADDRESS=localhost:7233
export DATA_ROOT=./data

python -m parquet_service.serve                        # work-manager (prod): poll config + 1 worker/job
python -m parquet_service.worker                       # static single worker, all queues (dev/manual)
uvicorn parquet_service.api.server:app --port 6666     # HTTP trigger API (dev/manual; starts workflows)
pytest
```

`serve` is the deployed mode (worker-only work-manager): it polls
`GET {WORKER_CONFIG_URL}/api/v1/work-manager/{CONFIG_ENDPOINT}` every `POLL_INTERVAL_S`, runs one
in-process Temporal worker per active job on its `parquet-{jobId}-taskqueue`, and tears a worker down
when its job drops out of the response. It does **not** start workflows — the TS side does that.

## Run modes (D5)

The caller (worker) passes `run_mode` at start:
- **incremental** — consume 1 stream (`{jobRunId}:{sourcePathId}:parquet`), diff vs the prior source snapshot.
- **baseline** — consume 2 streams (source + dest), diff source-vs-destination.

## Status

Scaffold. Implemented: schemas, stream I/O, paths, command encoding, config, API, worker, packaging, Helm.
Stubbed (contracts defined, see `# TODO`): parquet rotation, k-way merge-sort, Merkle build, comparator/diff.
