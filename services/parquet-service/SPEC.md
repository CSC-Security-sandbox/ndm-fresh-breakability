# parquet-service — Specification

> **Status:** Draft v0.3 · **Owner:** Abhishek Buragadda · **Last updated:** 2026-06-09
> Python control-plane service for the NDM Parquet metadata-storage redesign.
> Starting point: the `local-python-temporal` prototype (FastAPI + Temporal worker + Redis→Parquet activity).
> Parent design: `ndm-parquet-storage-redesign.md` (technical) + CDMT Confluence proposal (planning).
> Producer (worker) side: [`services/worker/PARQUET_PRODUCER_SPEC.md`](../worker/PARQUET_PRODUCER_SPEC.md).
> v0.3 adds: dir own-attributes copied into the merkle Parquet (D12), single-char `file_type` (D17),
> error Parquet co-located under `<jobRunId>/` (D18), workflow name confirmed (D2), and the **error→command
> replay** design (`ERROR_SCHEMA` + `attempt`/`is_dir`; `replay_errors` activity §9.1). v0.2 resolved §1 blockers.

---

## 0. Scope

TS scan workers **dual-publish** file metadata: unchanged to `${jobRunId}:files` (→ db-writer → Postgres
inventory) **and** additionally to a new per-path Parquet stream consumed by this service. The service lands
metadata as columnar Parquet on the CP local disk, computes a per-directory Merkle hash, diffs snapshots, and
emits `OPS_CMD` commands to the existing sync worker.

- **Baseline:** scan **source AND destination** → two snapshots → diff source-vs-destination → commands.
- **Incremental:** scan **source only** → diff against the **prior source snapshot** → commands.
- The **run mode is passed in by the caller at start** (not inferred). Incremental ⇒ consume **1** parquet
  stream; baseline ⇒ consume **2** (source + destination).

### 0.1 In scope (this service)
Service on the CP via Helm (PVC `/data`, JWT+mTLS to Temporal, **worker-auth Bearer JWT** inbound) · trigger
API idempotent per `(jobRunId, sourcePathId)` · consume parquet stream(s) → rotated 200 MB Parquet (12-col
§3) · per-file sort + **k-way external merge-sort** · directory Merkle hash · sort-merge diff (baseline
src-vs-dst, incremental src-vs-prior) with subtree short-circuit · command emission to `${jobRunId}:commands`
· error stream → **write** error Parquet · pause/stop signals · completion signal to parent
`MigrationWorkflow` · 4 Prometheus counters.

### 0.2 Deferred to Phase 2
`continue_as_new` cadence · OpenTelemetry trace propagation · schema-evolution helper ·
**error→commands** retry conversion (the `replay_errors` activity, §9.1 — Phase 1 only *writes* the error
Parquet) · full Prometheus suite ·
rich cross-SDK signal payload.

> Note: baseline (destination scan + src-vs-dst diff) is **in Phase 1** here — wider than the Confluence MVP,
> which had baselines fall back to the old pipeline. Per your 2026-06-04 decision the new pipeline owns both.

---

## 1. Decisions (resolved 2026-06-04)

| # | Decision |
|---|---|
| D1 | Folder `services/parquet-service`; Python 3.11; sync activities on a `ThreadPoolExecutor`. |
| D2 | Workflow **`ScanIngestionWorkflow`** (confirmed; renamed from prototype `RedisToParquetWorkflow`). Task queue `python-pipeline`. |
| D3 | Stream keys `${jobRunId}:${sourcePathId}:parquet`, `${jobRunId}:${destPathId}:parquet`. |
| **D4** | **Merged (full-row) snapshot is RETAINED** — not deleted when the merkle/dir Parquet is built. The merkle is only a comparison **speed-up index**. Deletions are detected by comparing against the prior **merged** file (a path in prior but not in current ⇒ `rf`/`rd`). |
| **D5** | **Run mode is an input at start.** Baseline ⇒ scan source + dest, consume **2** streams, diff source-merkle vs dest-merkle. Incremental ⇒ scan source only, consume **1** stream, diff vs prior source snapshot. |
| **D6** | OPS_CMD mapping per §10. **`acl_hash` change ⇒ `sm`** (stamp-metadata, same as mode/uid/gid). Comparison is **file-to-file and directory-to-directory**, so a file↔dir flip emits the right commands naturally — **no `correlation_id`** needed (dropped). |
| **D7** | **Ack-after-flush/seal:** XACK a stream entry only after its rows are written into a Parquet that is flushed → footer-validated → atomically renamed → `fsync`ed (fixes the prototype's ack-on-read). |
| **D8** | Per-file sort writes a **separate sorted file in the same folder** as the input (not in-place, not a `sorted/` dir). |
| **D9** | Idempotency per `(jobRunId, sourcePathId)`: duplicate start returns the existing runId (HTTP 200, `started=false`) via a Redis idempotency key (24h TTL) + deterministic Temporal workflow id. |
| D10 | NFC path normalization is done on the **TS producer** side; the Python sorter assumes NFC. |
| **D11** | **k-way external merge-sort is REQUIRED** (volumes are huge; entries don't fit in memory). Each rotated file is sorted in memory (it fits), then files are merged k-way (fan-in 16, 2 GB budget, `/tmp` spill). |
| **D12** | **Dir Merkle hash = over the directory's CHILDREN only** (file + subdir attributes). The directory's **own** attributes are **copied into the merkle Parquet row** (§3.2), so an own-attribute change is found by direct column comparison and a child change via `dir_hash` — both from one file. |
| **D13** | **Empty directory ⇒ a row with an empty hash** (no children to hash from); its own attributes are still compared. |
| **D14** | Promotion: when **diff generation completes** (all commands pushed to the stream), delete the **older** snapshot; the **current** snapshot becomes the prior for the next incremental. |
| **D15** | Inbound auth = **worker Bearer-JWT guard** (the worker calls the API on workflow start, sending `Authorization: Bearer <accessToken>` from `getAccessToken()`); replicate `JwtService.verifyToken` (`lib/auth-lib`). |
| **D16** | **Pause:** halt consumption and wait; on resume continue writing — the Parquet is updated once it resumes (no special seal-on-pause). **Stop:** delete partially-created (`.tmp`/unsealed) Parquet files as cleanup. The stop signal flows worker → parquet-service. |
| **D17** | `file_type` stored as a **single-character code** with a char⇄type enum mapping (§3.1, `FILE_TYPE_CODES`); precise type preserved, diff classifies into file/dir/symlink. |
| **D18** | Error Parquet lives in the **same `<jobRunId>/` directory** as the other scan-result Parquets (`<jobRunId>/errors/`). |

---

## 2. Repository layout

```
services/parquet-service/
  pyproject.toml  Dockerfile  README.md          # one image; Helm deployments override `command` (api vs worker)
  helm/   Chart.yaml  values.yaml  templates/{deployment,service,configmap,secret,networkpolicy,pvc}.yaml
  src/parquet_service/
    api/        server.py      # FastAPI: /health /metrics POST /workflows/{jobRunId}/{pathId}/start
                auth.py        # worker Bearer-JWT guard (D15)
    workflow/   scan_ingestion.py  # ScanIngestionWorkflow + signal handlers; branches on run_mode
                activities.py      # thin wrappers over lib/ (no business logic)
                merge_child.py     # k-way merge-sort child workflow
    lib/        schema.py      # RAW_SCHEMA / MERKLE_SCHEMA / ERROR_SCHEMA + KV metadata
                parquet_writer.py  # ParquetWriter (rotation + atomic seal)
                sorter.py          # per-file sort (separate file) + k-way external merge
                merkle.py          # MerkleBuilder (children-only hash; dir-attr hash separate)
                comparator.py      # ParquetComparator (file/dir diff + dir_path checkpoint)
                command.py         # Cmd build + msgpack-b64 encode
                paths.py           # PVC layout + .tmp→validate→rename→fsync
    io/         stream_reader.py   # StreamReader (filemeta src/dest, errors)
                stream_writer.py   # StreamWriter (push / push_bulk → commands stream)
                checkpoint.py      # Redis checkpoint store (dir_path cursor)
    config.py   worker.py      # Temporal worker entrypoint (mTLS+JWT client)
  tests/  fixtures/  test_*.py
```

**Layering rule:** `lib/` is pure (no Redis/Temporal/HTTP). Only `io/`, `workflow/`, `api/` touch external
systems. Activities are thin; all algorithms live in `lib/`.

---

## 3. Parquet schemas

### 3.1 Raw scan rows — `RAW_SCHEMA` (12 columns)
Directories are **first-class rows** (`file_type=DIRECTORY`). ✓ = feeds the children Merkle hash (D12).

```python
RAW_SCHEMA = pa.schema(
    [
        pa.field("filepath",  pa.string(), nullable=False),  # ✓ (basename), NFC
        pa.field("file_type", pa.string(), nullable=False),  # ✓ single-char code (see FILE_TYPE_CODES, D17)
        pa.field("file_size", pa.int64(),  nullable=False),  # ✓
        pa.field("mtime",     pa.int64(),  nullable=False),  # ✓ epoch ns
        pa.field("mode",      pa.int32(),  nullable=False),  # ✓
        pa.field("uid",       pa.int64(),  nullable=False),  # ✓
        pa.field("gid",       pa.int64(),  nullable=False),  # ✓
        pa.field("acl_hash",  pa.string(), nullable=True),   # ✓ SMB; owner SID folded in
        pa.field("atime",     pa.int64(),  nullable=True),   # ✗ value-only
        pa.field("birthtime", pa.int64(),  nullable=True),   # ✗ value-only
        pa.field("ctime",     pa.int64(),  nullable=True),   # ✗ value-only — NEVER hashed
        pa.field("inode_num", pa.int64(),  nullable=True),   # ✗ value-only
    ],
    metadata={b"schema_version": b"1", b"ndm_acl_hash_algo": b"blake3-128", b"ndm_path_normalize": b"NFC"},
)
```
For a file row, its hash contribution = length-prefixed concat of the 8 ✓ columns. For a directory row, its
**own** attributes are NOT in its hash (D12); they are compared separately (§10).

**`file_type` is stored as a single character (D17)** — cheap on the wire, lossless. An enum maps each
char to the worker's `FileType` (`services/worker/src/activities/types/tasks.ts`); the diff/merkle logic
classifies each into one of three **behaviour classes**: directory, symlink-like, or file-like.

```python
FILE_TYPE_CODES = {        # char  -> FileType         (behaviour class)
    "F": "FILE",                 # file
    "D": "DIRECTORY",            # dir
    "L": "SYMBOLIC_LINK",        # symlink
    "J": "JUNCTION",             # symlink-like
    "H": "SHORTCUT",             # symlink-like
    "M": "VOLUME_MOUNT_POINT",   # symlink-like
    "S": "SOCKET",               # file-like (migration handling below)
    "P": "FIFO",                 # file-like
    "C": "CHARACTER_DEVICE",     # file-like
    "B": "BLOCK_DEVICE",         # file-like
    "T": "STREAM",               # file-like (NTFS ADS)
    "U": "UNKNOWN",              # file-like
}
```
We store the precise type (no information loss), and compare **file-class to file-class and dir to dir**
(§9). **OPEN (behaviour only):** whether NDM actually migrates SOCKET/FIFO/devices/STREAM or skips them —
storage is settled; copy semantics are a migration-policy question.

`acl_hash` (net-new on TS): BLAKE3-128 hex over a normalized canonical form of the **source-side** SD,
**owner SID included**. Canonical-form rules still to lock.

### 3.2 Merkle / dir-summary rows — `MERKLE_SCHEMA`
Built after the merge (§6). One row per directory: `dir_hash` over the directory's **children** (file +
subdir attributes), **plus the directory's OWN attributes copied in** (D12). This makes the directory the
single comparison unit — a change to the **directory itself** is found by direct column comparison, a change
to its **children** is found via `dir_hash`, all from this one file without touching `merged/` for unchanged
subtrees.

```python
MERKLE_SCHEMA = pa.schema([
    pa.field("dir_path",    pa.string(), nullable=False),
    pa.field("dir_hash",    pa.string(), nullable=False),  # BLAKE3-128 hex over CHILDREN; "" if empty dir (D13)
    # --- directory's OWN attributes (copied from its raw row) — for direct comparison & dir sm ---
    pa.field("file_type",   pa.string(), nullable=False),  # "D"
    pa.field("mode",        pa.int32(),  nullable=False),
    pa.field("uid",         pa.int64(),  nullable=False),
    pa.field("gid",         pa.int64(),  nullable=False),
    pa.field("acl_hash",    pa.string(), nullable=True),
    pa.field("mtime",       pa.int64(),  nullable=True),
    pa.field("atime",       pa.int64(),  nullable=True),
    pa.field("birthtime",   pa.int64(),  nullable=True),
    pa.field("ctime",       pa.int64(),  nullable=True),
    pa.field("inode_num",   pa.int64(),  nullable=True),
    # --- aggregates ---
    pa.field("child_count", pa.int64(),  nullable=False),
    pa.field("total_bytes", pa.int64(),  nullable=False),
])
```
Diff per matched directory: compare the **own-attribute columns** directly (mode/uid/gid/acl_hash[/times] →
`sm` if changed); compare `dir_hash` to decide whether to descend into children.

### 3.3 Error rows — `ERROR_SCHEMA` (Phase 1 writes; Phase 2 replays)
Sourced 1:1 from the **enriched** `OperationError` (`lib/jobs-lib/src/types/metadata-types.ts` — the parquet
`ParquetChildSyncWorkflow` executor adds `opKind`/`command`/`attempt`; producer SPEC §15). Columns:
- `operation_id` — the failed `Cmd.id`; becomes the replay's `originalCmdId`.
- `file_path`, `file_name` — identity.
- `error_code`, `error_message`, `error_type` (`FATAL|TRANSIENT|RECOVERABLE|METADATA_UPDATE_CONFLICT` —
  **drives retryability**), `operation_name`, `origin`, `original_job_run_id`.
- `op_kind` (`cc|sm|sa|cf|cd|rd|rf|cs`) — **what to retry**.
- **`command_metadata`** = `JSON.stringify(Cmd)` — **the replay source of truth** (path, `isDir`, `ops`+params,
  `metadata`); the diff is gone by retry time, so the failed command is carried here, not re-derived.
- **`attempt`** (int32, NEW) — retry-cap counter.
- **`is_dir`** (bool, NEW) — filter/partition without parsing `command_metadata`.
- `ts` (int64, epoch ns) — dedup tiebreak.

Single per-jobRun stream (`${jobRunId}:errors`) → one error-Parquet area under `<jobRunId>/errors/`, sealed at
sync completion. Phase-2 replay: §9.1.

### 3.4 Writer settings
ZSTD level 3 · row-group ~128 MB · page 1 MiB · `use_dictionary=["file_type","acl_hash","mode","uid","gid"]`
· KV metadata stamps `schema_version, ndm_writer_version, ndm_jobconfig_id, ndm_jobrun_id`, and exactly one
of `ndm_source_path_id` / `ndm_dest_path_id`.

---

## 4. Redis stream contracts

| Stream | Key | Direction | When |
|---|---|---|---|
| File metadata (source) | `${jobRunId}:${sourcePathId}:parquet` | consume | always |
| File metadata (dest) | `${jobRunId}:${destPathId}:parquet` | consume | **baseline only** |
| Errors | `${jobRunId}:errors` | consume | always (write-only Parquet) |
| Commands | `${jobRunId}:commands` | **produce** | diff output (`Cmd` msgpack-b64 under `obj`) |

- Consumer group `pipeline`, `MKSTREAM` on attach; one consumer per `(jobRunId, pathId)`.
- EOF: accept `eof=1` **or** payload `filePath=LAST_FILE` (+ `:state` hash `eofSeen=1`).
- **Ack-after-seal (D7).** **Completion** waits for **all** input streams to reach EOF (source[+dest]
  parquet **and** errors) before signalling the parent (Q8.3).

---

## 5. API surface

```
GET  /health                                      GET /metrics
POST /workflows/{jobRunId}/{sourcePathId}/start   GET /workflows/{jobRunId}/{sourcePathId}
```
- **Auth (D15):** worker-auth Bearer-JWT guard. The worker calls this API when starting its workflow,
  sending `Authorization: Bearer <accessToken>` (from `WorkManager`/`AuthService.getAccessToken()`); the
  guard verifies the token like jobs-service's `JwtAuthGuard` (`JwtService.verifyToken`, decoded `user`
  required). Same JWT signing material/issuer as auth-lib.
- **Request body:** `accountId, jobConfigId, run_mode ∈ {baseline,incremental}, sourcePathId,
  destPathId? (baseline), feature_flag_ctx`.
- **Idempotency (D9):** `SETNX idemp:${jobRunId}:${sourcePathId}` (TTL 24h); if present return existing run
  (`started=false`), else `start_workflow` (deterministic id) → `started=true`.
- **Response:** `{ workflowId, runId, started }`.

---

## 6. Temporal workflow & activities

**`ScanIngestionWorkflow`**, ids `ScanIngestionWorkflow-${jobRunId}-${sourcePathId}-src`
(`-${destPathId}-dst` for the baseline dest leg). Independent of TS `MigrationWorkflow` (different SDK/queue;
failure isolation). The TS side starts it via the API and signals pause/stop; it signals completion back.

Flow branches on `run_mode`:
- **incremental:** ingest **source** → sort → merge → merkle → `compare_diff(prior_source, current_source)`.
- **baseline:** ingest **source** and **dest** (two legs, same activities) → two snapshots →
  `compare_diff(source, dest)`. Dest snapshot is single-use (dropped after the baseline diff); source
  snapshot is retained as the next prior.

| Activity | Calls | Notes |
|---|---|---|
| `consume_stream` | StreamReader + ParquetWriter | drain → rotated `raw/*.parquet`; **ack-after-seal**; heartbeat `rows=` |
| `sort_per_file` | sorter | sort each raw file → **separate `*.sorted.parquet` in the same folder** (D8) |
| `merge_sort` (child wf) | sorter | **k-way** merge of sorted files (fan-in 16, 2 GB, `/tmp` spill) → `merged/<run>.parquet`; 1s heartbeat, 6h S2C, transient-IO retry |
| `build_merkle` | MerkleBuilder | after merge: children-only `dir_hash` **+ the dir's own attributes copied in** → `merkle/<run>.parquet` (retained alongside merged) |
| `compare_diff` | ParquetComparator + StreamWriter | file-vs-file & dir-vs-dir; `dir_path` checkpoint (§10) |
| `consume_errors` | StreamReader + ParquetWriter | `${jobRunId}:errors` → error Parquet under `<jobRunId>/errors/`; ack-after-seal |
| `replay_errors` (Phase 2) | ParquetReader + StreamWriter | read error Parquet → filter retryable + dedup → rebuild **failed-op-only** `Cmd` → bulk-XADD `${jobRunId}:commands` (§9.1) |
| `promote_and_retain` | paths | on diff complete: delete older snapshot, current becomes prior (D14); drop `raw/`+`*.sorted` |

Activity options (from prototype): `start_to_close=6h`, `heartbeat=5m` (1s for merge), retry
`5s / 2.0 / 2m / 3` (merge: transient-IO only).

**Signals (D16):** inbound `action ∈ {Running, Paused, Stopped}` (matches `JobRunStatus`; jobs-service
`sendSignal` unchanged). Pause halts consumption and waits; resume continues writing the same file. Stop
deletes partial `.tmp` files and returns. Merge/diff are atomic w.r.t. pause/stop (diff is checkpoint-resumable per §10).

---

## 7. Library interfaces

```python
# io/stream_reader.py
class StreamReader:
    def __init__(self, client, job_run_id, path_id, kind: Literal["filemeta","errors"]): ...
    def ensure_group(self); def consume(self, consumer, count, block_ms) -> list[tuple[str,dict]]
    def decode(self, fields) -> dict|None; def is_eof(self, fields) -> bool
    def ack(self, ids: list[str]) -> int            # ONLY after seal (D7)

# lib/parquet_writer.py
class ParquetWriter:                                 # rotation + atomic seal
    def __init__(self, out_dir, name_fn, schema, *, rotate_bytes=200*MB, on_seal): ...
    def append(self, row); def close(self) -> SealInfo
    # _rotate(): .tmp -> footer-validate -> rename -> fsync(dir); on_seal fires ack-after-seal

# lib/sorter.py
def sort_file(src_path, dst_path, schema) -> None           # in-memory sort one file -> separate file (D8)
def merge_sort(sorted_inputs, out_path, *, fan_in=16, mem_budget=2*GB, spill_dir="/tmp") -> None  # k-way (D11)

# lib/merkle.py
class MerkleBuilder:                                 # D12/D13
    def build(self, merged_path, out_path) -> RootHash
    # dir_hash = BLAKE3_128( for child in sorted(children by name):
    #               name || (child.dir_hash if dir else child.row_attr_bytes) )    # children ONLY
    # empty dir -> dir_hash = ""                                                    # D13
    # row also carries the directory's OWN attribute columns (mode/uid/gid/acl_hash/times) # D12 — for direct compare

# lib/comparator.py
class ParquetComparator:
    def __init__(self, prior_merged, prior_merkle, curr_merged, curr_merkle,
                 writer: StreamWriter, checkpoint: CheckpointStore, batch=DIFF_BATCH): ...
    def run(self) -> DiffStats                       # file-vs-file & dir-vs-dir; resumes from cursor

# io/stream_writer.py
class StreamWriter:
    def push(self, cmd: Cmd) -> str
    def push_bulk(self, cmds: list[Cmd]) -> list[str]   # pipelined XADD

# io/checkpoint.py
class CheckpointStore:
    def load(self) -> str|None                       # last completed dir_path
    def save(self, dir_path) -> None                 # AFTER the dir's commands are pushed (Q4.1)
```

---

## 8. PVC layout & retention

```
/data/<accountId>/<jobConfigId>/<sourcePathId>/<jobRunId>/
    raw/      <run>-src-<ts>-<n>.parquet  +  <...>.sorted.parquet   (transient)
    merged/   <run>-src.parquet           (RETAINED as prior — full rows, enables delete detection, D4)
    merkle/   <run>.parquet               (RETAINED — children dir_hash + dir's own attributes copied in, D12)
    errors/   <run>-err-<n>.parquet       (write-only; co-located under this jobRun dir, D18)
```
- `raw/` + `*.sorted` dropped after merge. **`merged/` + `merkle/` are kept** as the prior snapshot.
- On diff completion (D14): delete the **older** `merged/`+`merkle/`; current becomes prior. `fsync(dir)`
  after unlink. Dest-leg snapshot (baseline) is dropped after the baseline diff.
- Run mode comes from the start request (D5) — no PVC-derived detection. For an incremental, the prior is the
  most-recent sealed `merged/`+`merkle/` for `(accountId, jobConfigId, sourcePathId)`.

---

## 9. Diff: algorithm, OPS_CMD mapping, checkpointing

**Inputs:** prior + current `merged` (full rows) and `merkle` (skip-index). Sort-merge join on `dir_path`.

For each matched directory pair (all read straight from the merkle Parquet — no `merged/` read for unchanged
subtrees):
1. **Compare the directory's own attribute columns** (mode/uid/gid/acl_hash[/times], copied in per D12) → if
   changed, emit `sm` for the dir.
2. If `dir_hash` (children) equal → **skip the subtree**. Else descend into the `merged` rows for that dir
   and compare **file children to file children** and **dir children to dir children** by name.

**Delta → OPS_CMD (D6):**

| Delta | Command(s) |
|---|---|
| current-only file | `cf` (+ `sm`) |
| current-only dir | `cd` (+ `sm`) |
| prior-only file | `rf` |
| prior-only dir | `rd` + subtree (depth DESC) |
| file in both, `file_size`/`mtime` changed | `cf` |
| file in both, only `mode`/`uid`/`gid`/**`acl_hash`** changed | `sm` |
| dir in both, own attrs changed (direct column compare) | `sm` |
| file↔dir flip (same name) | naturally `rf` (file pass) + `cd`+subtree (dir pass) — **no correlation_id** |

Ordering: creates depth **ASC**, deletes depth **DESC**. `CmdMeta.ctime = null` on the Parquet path.

**Checkpointing (Q4.1):** process the join in batches; for each directory, build commands →
`StreamWriter.push_bulk` → `CheckpointStore.save(dir_path)`. On restart, resume from the cursor; the
in-flight directory may re-emit commands — safe (sync is idempotent on OPS_CMD). When the join completes
(diff generation done), `promote_and_retain` deletes the older snapshot and the current becomes prior (D14).

### 9.1 Error → command replay (Phase 2, `replay_errors`)

The same service that emits diff commands also replays failures — there is **no re-scan** path here (the diff
is the only command source, and it's gone by retry time; the legacy `RetryMigrationWorkflow` re-derived
commands by re-scanning source-vs-target, producer SPEC §15). Run as a retry-mode pass over the prior run's
error Parquet:

1. Read `<jobRunId>/errors/*.parquet`.
2. **Filter retryable:** `error_type ∈ {TRANSIENT, RECOVERABLE, METADATA_UPDATE_CONFLICT}` (drop **FATAL** —
   `EACCES`/`ENOSPC`/identity-mapping never replay) **and** `op_kind` + `command_metadata` present (skip
   scan/`READ_DIR` errors, which carry no command) **and** `attempt < MAX_RETRY` (~3 — caps retry storms).
3. **Dedup** by `(file_path, op_kind)` keeping `max(ts)` — one file logs multiple rows per root cause.
4. **Rebuild the `Cmd`** from `command_metadata`: new `id` (uuid), `originalCmdId = operation_id`,
   `status = READY`, `attempt = attempt + 1`, and set **only the failed op `READY`** (`ops[op_kind].status =
   READY`; leave succeeded ops `COMPLETED` — minimal re-work; the executor honors per-op status).
5. `StreamWriter.push_bulk` the rebuilt `Cmd`s (`Cmd.to_wire()`, msgpack-b64 under `obj`) to
   `${jobRunId}:commands`; the sync worker drains and re-executes.

**Idempotent:** OPS_CMD are idempotent (cc overwrites / sm re-stamps / rf removes), `(path, op_kind)` dedup
collapses repeats, and a checkpoint/idempotency key makes a double-run safe. A re-failure writes a fresh error
row with `attempt+1`; once `attempt` reaches `MAX_RETRY` it is surfaced, not retried.

---

## 10. Pause / Stop / Resume (D16)

- **Paused:** stop reading new entries and wait (`wf.wait_condition(action != Paused)`). On resume, continue
  writing the same Parquet — it is finalized in the normal rotation flow. Ack-after-seal still holds, so a
  crash during pause replays ≤ the in-flight rotation window.
- **Stopped:** delete partially-created (`.tmp`/unsealed) Parquet files, then return. The stop signal flows
  worker → parquet-service when the worker is stopped. Next run starts fresh (new jobRunId).
- Merge-sort and diff are atomic w.r.t. pause/stop; the diff resumes from its `dir_path` checkpoint.

---

## 11. Deployment, deps, observability, failure

- **Helm:** own chart bundled into the CP install; `replicas=1`; PVC RWO local-storage at `/data` (200 GB
  initial); ClusterIP Service; NetworkPolicy ingress from the worker/jobs-service; mTLS+JWT to Temporal
  (replaces prototype plaintext), JWT refresh cron 1380 min; Redis via CP creds. `mem ≥ baseline + 2 GB ×
  max_concurrent_merges`.
- **Deps (Py 3.11):** `temporalio fastapi uvicorn[standard] redis pyarrow pydantic msgpack blake3
  prometheus-client pyjwt[crypto]/cryptography`; dev `pytest fakeredis`.
- **Metrics:** `parquets_written, bytes_written, commands_emitted, errors_seen` on `/metrics`.
- **Failure:** pod restart mid-ingest → replay ≤ 200 MB (ack-after-seal), deduped at merge; partial write →
  `.tmp` swept at startup; merge crash → re-read `raw/`; diff crash → resume from `dir_path` cursor;
  CP-node/PVC loss → prior gone → next run must be a baseline.

---

## 12. Phase-1 acceptance gate
Deployed in staging behind a flag (OFF in prod): healthy `/health`, JWT+mTLS to Temporal · idempotent trigger
per `(jobRunId, sourcePathId)` · consume → rotated 12-col Parquet → per-file sort → k-way merge → merkle ·
**baseline** src-vs-dst diff **and** incremental src-vs-prior diff emit commands · pause/stop ·
errors → error Parquet · completion signal on both-stream EOF · Postgres pipeline unchanged, flag reverts.
1-day load test on a 1M-file fixture.

---

## 13. Remaining opens
1. `acl_hash` canonical-form rules (ACE order, inherited flags, byte encoding) — **blocks the TS producer**.
2. **Migration behaviour** (not storage) for SOCKET/FIFO/CHARACTER_DEVICE/BLOCK_DEVICE/STREAM/UNKNOWN —
   does NDM copy or skip them? Storage is settled (single-char code, D17).
3. Single-char codes for `FILE_TYPE_CODES` — confirm the letters in §3.1 (esp. S/P/C/B/H/M/T).
4. **Replay tuning (§9.1):** `MAX_RETRY` default (~3) and whether `METADATA_UPDATE_CONFLICT` is replayable
   alongside `TRANSIENT`/`RECOVERABLE`.

*Resolved since v0.2:* dir own-attrs copied into merkle (D12) · error location `<jobRunId>/errors/` (D18) ·
workflow name `ScanIngestionWorkflow` (D2) · `file_type` single-char (D17).
