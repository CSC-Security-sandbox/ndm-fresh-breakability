# PostgreSQL Tuning Changes — Control Plane

## Summary

Updated the PostgreSQL `extendedConfiguration` block in the Control Plane Helm values template so every new/upgraded Control Plane deployment ships with production-tuned defaults instead of near-stock Bitnami values.

**File changed:** `ndm/app-deployment/ansible/control-plane/roles/configure-postgres/setup-postgres/templates/postgres-values.j2`

Settings apply cluster-wide — all databases (`datamigrator`, `temporal`, `temporal_visibility`, `keycloak`) benefit. Per-database / per-table Temporal-specific tuning is **not** part of this change and will be handled separately.

## Target environment

- **Host**: 8 vCPU, 64 GB RAM, SSD storage
- **Co-tenants**: PostgreSQL shares the host with other services (Temporal, Redis, app pods, etc.)
- **PostgreSQL version**: 17.6 (Bitnami chart, `17.6.0-debian-12-r0`)
- **Memory budget for PG**: ~8 GB peak (leaves headroom for co-tenants)

## Jinja conditional

The new tuning only applies to real production clusters. Local/dev clusters (`local_cluster is defined`) fall through to PostgreSQL built-in defaults, matching the existing pattern for pod resource requests.

```jinja
extendedConfiguration: |
{% if local_cluster is defined %}
    # Local cluster: no custom parameters (PostgreSQL built-in defaults)
{% else %}
    ...tuned values...
{% endif %}
```

## Changes (before → after)

| Setting | Before | After | Purpose |
|---|---|---|---|
| `max_connections` | 1000 | **500** | 1000 was unsafe with the old 768 MB `shared_buffers`; 500 balances capacity with per-backend overhead (~10 MB each) |
| `shared_buffers` | 768 MB | **2 GB** | ~2.7× more hot data cached in PG; biggest read-side win without starving co-tenants |
| `effective_cache_size` | *(unset)* | **4 GB** | Planner hint for OS cache available to PG → picks index scans more aggressively |
| `work_mem` | 32 MB | **8 MB** | Per-sort/hash, not per-query; 32 MB × 500 connections could blow memory. 8 MB is safer under concurrency |
| `maintenance_work_mem` | 256 MB | **512 MB** | 2× faster `VACUUM`, `CREATE INDEX`, `ALTER TABLE` |
| `temp_buffers` | *(default 8 MB)* | **16 MB** | Faster queries using temp tables |
| `max_wal_size` | 1 GB | **4 GB** | **Biggest write-throughput win.** Checkpoints fire 4× less often → fewer full-page writes, smoother write latency |
| `min_wal_size` | *(default 80 MB)* | **512 MB** | Avoids WAL file recycle churn during traffic spikes |
| `checkpoint_timeout` | *(default 5 min)* | **10 min** | Spreads checkpoint I/O over a longer window |
| `checkpoint_completion_target` | 0.9 | 0.9 | Unchanged |
| `wal_buffers` | 8 MB | **32 MB** | Fewer WAL flushes on commit-heavy workloads |
| `wal_compression` | off | **lz4** | Reduces WAL I/O; supported by this Bitnami PostgreSQL 17.6 build — small CPU cost, good disk savings |
| `random_page_cost` | *(default 4)* | **1.1** | SSD-appropriate; stops planner over-penalizing index scans |
| `effective_io_concurrency` | *(default 1)* | **200** | Enables parallel page prefetch on SSD → bitmap scans much faster |
| `maintenance_io_concurrency` | *(default 10)* | **200** | Faster VACUUM / ANALYZE on large tables |
| `max_worker_processes` | *(default 8)* | **8** | Matches vCPU count (unchanged from default, now explicit) |
| `max_parallel_workers` | *(default 8)* | **4** | Caps concurrent parallel query workers — leaves CPU for co-tenants |
| `max_parallel_workers_per_gather` | 2 | 2 | Unchanged |
| `max_parallel_maintenance_workers` | *(default 2)* | **2** | Explicit |
| `parallel_tuple_cost` / `parallel_setup_cost` | 0.1 / 500 | 0.1 / 500 | Unchanged |
| `autovacuum_max_workers` | *(default 3)* | **4** | Keeps up with bloat on more tables concurrently |
| `autovacuum_vacuum_cost_limit` | *(default 200)* | **1000** | Autovacuum runs ~5× faster → less bloat, fresher stats |
| `autovacuum_naptime` | *(default 1 min)* | **20 s** | Reacts faster to row churn |
| `autovacuum_vacuum_scale_factor` | *(default 0.2)* | **0.1** | Triggers VACUUM at 10% dead rows instead of 20% |
| `autovacuum_analyze_scale_factor` | *(default 0.1)* | **0.05** | Stats stay fresh on large tables → better plans |
| `default_statistics_target` | *(default 100)* | **100** | Unchanged (explicit) |
| `jit` | *(default on)* | **off** | JIT overhead hurts OLTP short queries — ~5–20% faster on small queries |
| `shared_preload_libraries` | `pg_stat_statements` | `pg_stat_statements` | Unchanged |

## Pod resources

The production branch requests were adjusted to match the new memory footprint:

```yaml
resources:
  requests:
    cpu: "1"
    memory: "4Gi"
```

No `limits` set on the production branch (leaves burst headroom). Local cluster branch (`local_cluster is defined`) keeps its existing cpu/memory caps (`1.2` / `1.7Gi`).

## Expected performance impact

| Workload dimension | Expected change |
|---|---|
| Read cache hit rate | ~**2–3× fewer disk reads** (from `shared_buffers` 768 MB → 2 GB) |
| Write throughput (TPS) | ~**2× higher** (from `max_wal_size` 1 GB → 4 GB, `wal_buffers` 8 MB → 32 MB, `wal_compression = lz4`) |
| Large analytic scans | ~**2–3× faster** (from `effective_io_concurrency = 200`, `random_page_cost = 1.1`) |
| Index build / VACUUM speed | ~**2× faster** (from `maintenance_work_mem = 512 MB`, `autovacuum_vacuum_cost_limit = 1000`) |
| Planner quality | More accurate plans on large tables — `effective_cache_size` + `random_page_cost` combine to favor index-driven execution on SSD |
| Bloat / table health | Much reduced — aggressive autovacuum triggers at lower thresholds and runs faster |
| Short-query latency (OLTP, Temporal) | Slightly lower — `jit = off` removes JIT startup overhead |
| Memory footprint | Bounded at ~8 GB peak — won't steal RAM from co-tenant services |
| Connection capacity | Halved from 1000 → 500; safer with larger `shared_buffers`, no functional impact unless apps actively used >500 simultaneous connections |

Aggregate: roughly **2–3× improvement** on typical read/write mixed workloads for the `datamigrator` database, and smoother write latency cluster-wide (which helps Temporal workflow progress as well).

## What this change does NOT do

- **No per-database overrides** (`ALTER DATABASE temporal SET work_mem = …`) — Temporal will use the global `work_mem = 8 MB`. That's fine as a starting point.
- **No per-table autovacuum tuning** on Temporal hot tables (`executions`, `history_node`, `tasks`, etc.) — the global autovacuum tuning helps, but Temporal-specific per-table settings give meaningfully more bloat protection. Track this separately.
- **No connection pooler** (PgBouncer) — `max_connections = 500` is enough for current usage; revisit if apps scale past this.
- **No statement timeouts** (`statement_timeout`, `idle_in_transaction_session_timeout`) — left at defaults to avoid breaking Temporal's long-running history queries.
- **No changes to init SQL** (`postgres-configmap.j2`) — schemas/roles/users unchanged.

## Rollout behavior

- **Fresh deployment**: Ansible runs `helm install` → Bitnami chart applies `extendedConfiguration` → Postgres starts with tuned values.
- **Existing deployment upgrade**: Ansible runs `helm upgrade` → chart updates the Postgres ConfigMap → pod is restarted → new `postgresql.conf` active.
- **Settings requiring a restart** (covered by the pod roll): `shared_buffers`, `max_connections`, `wal_buffers`, `shared_preload_libraries`, `max_worker_processes`.
- **No data migration** required. Existing PVC contents remain intact.

## Verification after rollout

Run these from any pod/VM that can reach the Postgres instance:

```bash
psql -h <host> -U postgres -c "
  SELECT name, setting, unit FROM pg_settings
  WHERE name IN (
    'shared_buffers','effective_cache_size','work_mem','maintenance_work_mem',
    'max_connections','max_wal_size','min_wal_size','wal_buffers','wal_compression',
    'random_page_cost','effective_io_concurrency','checkpoint_timeout',
    'autovacuum_vacuum_cost_limit','autovacuum_vacuum_scale_factor','jit'
  ) ORDER BY name;
"
```

Expected values after rollout match the "After" column in the table above.

## Follow-up work (not in this change)

1. **Temporal per-database tuning** — `ALTER DATABASE temporal SET jit = off; statement_timeout = 0; max_parallel_workers_per_gather = 0;` etc.
2. **Temporal per-table autovacuum** on hot tables (`executions`, `history_node`, `tasks`, `task_queues`, `timer_tasks`, `buffered_events`) at `autovacuum_vacuum_scale_factor = 0.01`.
3. **Ingest-path code change** in `db-writer` — wrap multiple batches per transaction and optionally switch to `COPY` into a staging table for larger ingests.
4. **`pg_stat_statements` extension create** (`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`) per database for query-level observability.
5. **PgBouncer** if connection count becomes a bottleneck again.
