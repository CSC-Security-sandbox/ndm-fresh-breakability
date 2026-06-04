# Worker (Producer) Changes — NDM Parquet Redesign

> **Status:** Draft v0.2 · **Owner:** Abhishek Buragadda · **Last updated:** 2026-06-04
> The producer half of the Parquet metadata redesign. Pairs with
> [`services/parquet-service/SPEC.md`](../parquet-service/SPEC.md) (the consumer).
> Touches `services/worker` and `lib/jobs-lib`. All file:line refs are on branch `ab/parquet-redesign`
> unless noted as `ab/parquet-changes`.
> **v0.2:** the parquet path is a **separate duplicated workflow family** (`ParquetMigrationWorkflow` +
> `ParquetChildScanWorkflow` + `ParquetChildSyncWorkflow`), selected by jobs-service routing on
> `enable_parquet` — the legacy `MigrationWorkflow` is untouched. See §11–§14.

---

## 0. Scope

The TS scan worker must **dual-publish** per-file metadata: keep writing `ItemInfo` to `${jobRunId}:files`
(→ db-writer → Postgres inventory, **unchanged**) and **additionally** publish a `ParquetItem` to a new
per-path stream consumed by `parquet-service`. The parquet-service then ingests, builds the directory
Merkle, diffs snapshots, and emits the `OPS_CMD` commands the sync worker already consumes.

This is delivered as a **separate, duplicated workflow family** (§11), not a flag-branch in the existing
workflow. jobs-service routes to the new `ParquetMigrationWorkflow` when `enable_parquet` is on (the
parquet-service diff is the source of commands) or the legacy `MigrationWorkflow` when off (today's pipeline,
literally untouched).

---

## 1. Prerequisite — bring the foundation onto this branch

The `ParquetItem` foundation exists **only on `ab/parquet-changes`** and is **absent from
`ab/parquet-redesign`** (verified). Before any of the below, merge/cherry-pick:

| Symbol | File (on `ab/parquet-changes`) | Current state |
|---|---|---|
| `ParquetItem` (7 fields) | `lib/jobs-lib/src/datatype/stream-datatypes.ts:218` | absent here |
| `RedisParquetItemCollection` | `lib/jobs-lib/src/redis/redis-collections.ts:259` | absent here |
| `JobManagerContext.parquetStream` + `publishToParquetStream(Bulk)` | `lib/jobs-lib/src/types/job-manager-context/job-manager-context.ts:19,117` | absent here |
| `RedisJobManagerContext` init of `parquetStream` | `job-manager-redis.ts:19` | absent here |

Current `ParquetItem` (7 fields): `filePath, mtime, atime, gid, uid, mode, aclhash`. Wire format (via
`RedisStreamCollection.append`): **msgpack-lite → base64 under the `obj` field** — already matches the
parquet-service decoder and `RedisCommandCollection`.

---

## 2. Key corrections to the original design framing

Three things the codebase shows that differ from the technical design doc — get these right or the wiring lands in the wrong place:

1. **The producer hook is `DiscoveryScanService`, NOT `MigrateScanService`.** `MigrateScanService`
   (`.../scan/migrate/migrate-scan.service.ts`) emits **only commands** to `${jobRunId}:commands`; it never
   writes `ItemInfo`. The per-file `ItemInfo` → `${jobRunId}:files` emission is in
   **`DiscoveryScanService`** at `services/worker/src/activities/core/scan/discovery/discovery-scan.service.ts:141`
   (`publishToFileStream`) and `:155` (`publishToFileStreamBulk`). **The dual-stream `ParquetItem` publish
   goes here.**
2. **INT64 ns timestamps cannot be JS `Number`.** The schema stores `mtime/atime/ctime/birthtime` as epoch
   **nanoseconds** and `inode_num` as int64 — both exceed `Number.MAX_SAFE_INTEGER` (2^53). Carrying them as
   JS numbers loses precision. Stat with `{ bigint: true }` and carry these fields **as decimal strings** in
   `ParquetItem`; the parquet-service casts to int64 at ingest. (See §3.)
3. **Backpressure is the FILE-stream gate (200000), not the command gate (5000).** Extend
   `validateFileStreamLength` (`workflow-utils.ts:169`, cap `maxDiscoveryFileStreamLen=200000`,
   `app.config.ts:40`), used by `child-scan.workflow.ts:109` — not `validateCommandStreamLength`. (See §10.)

---

## 3. `ParquetItem` schema expansion (7 → 12 fields)

Expand `ParquetItem` to the parquet-service `RAW_SCHEMA` (SPEC §3.1). All values come from the **same
`fs.Stats`** that already builds `ItemInfo`/`CmdMeta` — no second stat. Use `fs.stat(path, {bigint:true})`
to get `*Ns` + `ino` as `BigInt`.

| ParquetItem field | Type on wire | Source (`sFile: fs.Stats` / scan) | Notes |
|---|---|---|---|
| `filepath` | string | scanned path | **NFC-normalize** (§8) |
| `file_type` | string | `FileTypeDetectionService` (`FileType` enum) | send native enum string; parquet-service maps to single char (§7) |
| `file_size` | number | `sFile.size` | < 2^53, safe as number |
| `mtime` | **string** (epoch ns) | `sFile.mtimeNs` | bigint → decimal string |
| `mode` | number | `sFile.mode` | |
| `uid` | number | `sFile.uid` | |
| `gid` | number | `sFile.gid` | |
| `acl_hash` | string \| null | **computed (net-new, §6)** | BLAKE3-128 hex |
| `atime` | **string** (epoch ns) | `sFile.atimeNs` | |
| `birthtime` | **string** (epoch ns) | `sFile.birthtimeNs` | |
| `ctime` | **string** (epoch ns) | `sFile.ctimeNs` | not in `ItemMeta` today; free from stat |
| `inode_num` | **string** | `sFile.ino` (bigint) | SMB IDs unstable — stored, never hashed (parquet-service side) |

Directories must be emitted as their own `ParquetItem` rows (`file_type=DIRECTORY`) so empty dirs are
captured. (Discovery already walks dirs; ensure dir entries are published, not just files.)

**Out:** no `readlink_target` (symlinks not migrated), no separate `sid` (owner folded into `acl_hash`),
no `acl_blob` (only the hash is stored; the real ACL is re-fetched from source at stamp time).

---

## 4. Stream key — per source/dest path

Today `RedisParquetItemCollection` uses `JobUtils.getRedisKey(jobRunId, 'parquet')` →
`${jobRunId}:parquet` (`job-utils.ts:2`), which collapses all paths into one stream and breaks multi-path
Merkle scoping. Add a path-scoped key:

```ts
// JobUtils — preferred: a dedicated helper (leaves getRedisKey untouched)
static getParquetStreamKey(jobRunId: string, pathId: string): string {
  return `${jobRunId}:${pathId}:parquet`;
}
```
Canonical forms (must match parquet-service SPEC §4): `${jobRunId}:${sourcePathId}:parquet` and
`${jobRunId}:${destPathId}:parquet`. `RedisParquetItemCollection` and `JobManagerContext.parquetStream` must
be constructed **per pathId** (a map keyed by pathId, or lazily in the activity that knows its path) instead
of once per jobRun.

---

## 5. Dual-stream producer wiring

At `discovery-scan.service.ts:141/155`, alongside each `publishToFileStream(Bulk)` call, build the
corresponding `ParquetItem`(s) from the same stat and publish to the per-path parquet stream **in bulk**
(per-entry publishing dominates scan wall-clock). This block is **gated on the activity input
`publishParquet`** (§11) — set true only when invoked by `ParquetChildScanWorkflow`, so the legacy scan path
is byte-for-byte unchanged.

**Ordering is load-bearing — files stream FIRST, parquet stream SECOND:**
```ts
await jobContext.publishToFileStreamBulk(items);                 // legacy (db-writer source of truth)
await jobContext.publishToParquetStreamBulk(pathId, parquetItems); // new (additive)
```
Rationale: the legacy `:files` stream is the back-compat source of truth and already back-pressured; the new
parquet stream is the path expected to lag during rollout. Writing files first preserves legacy semantics.

**Non-atomic:** the two awaits aren't atomic; a crash between them leaves `:files` ahead of parquet.
Recovery relies on existing subdir-batch idempotency (re-scan on restart) + merge-sort dedup on `filepath`
(keep latest by stream entry-id). No extra coordination; called out so reviewers don't assume atomicity.

---

## 6. `acl_hash` computation (net-new)

Computed **server-side on the worker**, in the same activity that produces the `ParquetItem`. (The
parquet-service receives it pre-computed and never recomputes it.)

- **SMB/NTFS:** PowerShell `Get-Acl` on the source share (the same retrieval the stamping pipeline already
  uses to write `inventory.source_meta.sid`).
- **NFSv4:** the existing NFSv4 ACL retrieval used by the NFS scan path.
- **Hash:** `BLAKE3-128` (truncated to 128 bits, hex) over a normalized canonical form of the **source-side**
  security descriptor, **owner SID folded in**. Needs a BLAKE3 lib on the TS side (e.g. `blake3` /
  `hash-wasm`).
- Destination-side / mapped SIDs are **out** of the hash; a SID-mapping change is a manual re-stamp trigger,
  not a hash change.

**OPEN (the one remaining producer blocker):** the exact canonical-form rules — ACE sort order, treatment
of inherited flags, owner/group inclusion, byte encoding — must be locked before implementation. Whatever is
chosen is the permanent definition of "metadata changed" for SMB.

---

## 7. `file_type` — send the native enum, parquet-service maps to a char

`FileTypeDetectionService` already produces the worker's 12-value `FileType` enum
(`services/worker/src/activities/types/tasks.ts:66`). The worker publishes that **string**; the
parquet-service maps it to the single-char code at ingest via its `TYPE_TO_CODE` (SPEC §3.1, D17). This keeps
the mapping in **one** place (Python) rather than duplicating `FILE_TYPE_CODES` across two languages.

---

## 8. NFC path normalization (producer side)

Normalize `filepath` to NFC (`path.normalize` is NOT this — use JS `String.prototype.normalize('NFC')`)
before publishing to the parquet stream, so the Python sorter can assume NFC (parquet-service D10). Apply it
consistently to both file and directory rows.

---

## 9. EOF sentinel

When the scan for a `(jobRunId, pathId)` completes, emit a final stream entry with `eof="1"` on that
parquet stream (the parquet-service terminates on `eof="1"` or payload `filePath="LAST_FILE"`). Emit it
**after** the final parquet `publishToParquetStreamBulk` **and** after the symmetric final `:files` write, so
the two streams agree on the scan boundary. The orchestrating activity (not leaf scan calls) owns it — it
must be written exactly once per `(jobRunId, pathId)`. **Not** emitted on pause; only on natural completion.

---

## 10. Backpressure

Extend the existing file-stream gate `validateFileStreamLength` (`workflow-utils.ts:169`; cap
`maxDiscoveryFileStreamLen=200000`, `app.config.ts:40`; called from `child-scan.workflow.ts:109` via
`isFileStreamLenValidActivity`). The gate must check `XLEN` of **both** the `:files` stream **and** the
specific `${jobRunId}:${pathId}:parquet` stream the current activity feeds, sleeping 30s if either exceeds
the cap (`max(xlenFiles, xlenParquet) > cap`). Check the **specific** per-path parquet stream, not a sum
across paths (an idle path must not throttle an active one).

> **Coupling risk:** one shared cap means a slow parquet-service consumer throttles the legacy db-writer path
> too. Acceptable for v1; revisit an independent/asymmetric cap if it bites during rollout.

---

## 11. New workflow family + jobs-service routing

The parquet path is a **separate, duplicated workflow family** — NOT a flag-branch inside the existing
`MigrationWorkflow`. The legacy workflows are left completely untouched (rollback = route back to them).

**jobs-service routes at start.** When starting a migration, jobs-service reads the global `enable_parquet`
flag and starts **either** the legacy `MigrationWorkflow` **or** the new `ParquetMigrationWorkflow`. There is
**no `enable_parquet` branch inside** the new workflow — being started *is* the flag being on, so the new
workflow always runs the parquet (dual-stream) path.

New files — duplicate-and-adapt the legacy ones:

| New workflow | Duplicated from | What changes |
|---|---|---|
| `ParquetMigrationWorkflow` (parent) | `migration-parent-workflow.ts` + `execute-migration-child-workflows.ts` | spawns the parquet children; adds the parquet-service trigger activity + completion wait (§13) |
| `ParquetChildScanWorkflow` | `child-scan.workflow.ts` | discovery **dual-streams** (files + parquet); **no** MigrateScanService command generation; backpressure on both streams (§10) |
| `ParquetChildSyncWorkflow` | `child-sync.workflow.ts` | duplicated for isolation (your call); logic identical today — drains `${jobRunId}:commands` |

**Shared activities are parameterized, not duplicated.** Duplicating workflow *orchestration* is cheap;
duplicating the heavy discovery scan *activity* (the file-walk) is not. So the discovery scan activity
(`discovery-scan.service.ts`) gains inputs `publishParquet: boolean` + `pathId`, set true by
`ParquetChildScanWorkflow`; the dual-stream publish (§5) is gated on that activity input, not a workflow
branch. **[ASSUMED — confirm vs. fully duplicating the activity body.]**

---

## 12. Run mode + scan structure

`run_mode` (`baseline` | `incremental`) comes from `jobContext.jobConfig.jobType` and is passed to the
parquet-service at start (parquet-service D5).

- **Incremental:** `ParquetMigrationWorkflow` spawns **one** `ParquetChildScanWorkflow` for the source →
  `${jobRunId}:${sourcePathId}:parquet`.
- **Baseline:** spawns **two** scan children (source + destination) → source and dest parquet streams.
  **[ASSUMED: two children vs. one child walking both sides — confirm.]**

`ParquetChildScanWorkflow` runs the discovery walk + dual-stream only; it does **not** run the
`MigrateScanService` command generation (`isContentUpdate`/`isMetaUpdated`, `migrate-scan.service.ts:282,298`)
— the parquet-service diff produces the commands.

---

## 13. Triggering the parquet-service + completion handshake

`ParquetMigrationWorkflow` triggers the parquet-service via a **dedicated activity** (workflows can't do IO),
e.g. `startParquetIngestionActivity`, started **concurrently with the scan** so it drains the stream as the
scan fills it. The activity uses the existing HTTP+auth pattern from `work-manager.service.ts`
(`authService.getAccessToken()` → `httpService.post(...Bearer...)` → `firstValueFrom`); the parquet-service
validates the same Bearer JWT (its D15 guard).

```
POST {parquetServiceUrl}/workflows/{jobRunId}/{sourcePathId}/start
body: { account_id, job_config_id, run_mode, dest_path_id?,
        callback_workflow_id: "<ParquetMigrationWorkflow id>",   # so it can signal back
        callback_signal: "parquetCompletion" }
```
Idempotent per `(jobRunId, sourcePathId)`. At baseline the dest leg is driven by the same call.

**Completion handshake — direct cross-SDK signal, decoupled (your decisions):**
- The parquet-service signals the **TS `ParquetMigrationWorkflow` id directly** via a Temporal client
  (chosen over an HTTP→jobs-service relay). ⚠️ This makes the **cross-SDK signal payload the highest-risk
  contract**: Python `temporalio` and the TS data converter must agree. Keep the payload a single
  string / minimal JSON, and pass the signal name + workflow id **in at start** (don't hard-code TS naming on
  the Python side). See open #5.
- **Decoupled (Phase 1):** the parquet-service fires completion when the **source stream is drained AND the
  diff is emitted** (commands on `${jobRunId}:commands`) — it does **not** wait for sync or error-stream EOF.
- The new parent completes only after **both**: (a) the `parquetCompletion` signal (diff done), **and**
  (b) `ParquetChildSyncWorkflow` finishing (commands drained). Awaited independently — no circular
  sync↔diff dependency.
- **Baseline / multi-path:** baseline has two ingest legs but a single src-vs-dst diff → **one** completion
  signal. A multi-source `jobConfig` (N source paths) → N parquet workflows → parent aggregates N signals.
  **[single source path assumed for v1; multi-source aggregation is open #5.]**

---

## 14. Pause / Stop / Resume forwarding

`ParquetMigrationWorkflow`'s `actionSignal` (duplicated from `execute-migration-child-workflows.ts:32`)
forwards `Running/Paused/Stopped` to **three** targets: `ParquetChildScanWorkflow` (`scanActionSignal`),
`ParquetChildSyncWorkflow` (`syncActionSignal`), **and** the parquet-service `ScanIngestionWorkflow` `action`
signal (single `JobRunStatus` string — parquet-service D16), targeting
`ScanIngestionWorkflow-{jobRunId}-{sourcePathId}-src` (and `-dst` at baseline) via a Temporal client /
`sendSignal`.

- **Pause:** parquet-service halts at the rotation boundary, resumes on `Running`.
- **Stop:** parquet-service seals/cleans partial `.tmp` and returns; the worker's stop path is unchanged.

---

## 15. What stays unchanged

**The entire legacy `MigrationWorkflow` family** (`migration-parent-workflow.ts`,
`execute-migration-child-workflows.ts`, `child-scan.workflow.ts`, `child-sync.workflow.ts`,
`MigrateScanService` command generation) is **left intact** — jobs-service simply routes elsewhere when the
flag is on. Also unchanged: `db-writer` → `inventory` / `operation_errors` · the `${jobRunId}:files` stream +
its `publishToFileStream` consumers · `RetryMigrationWorkflow` and `CutOverWorkFlow` (legacy-only for now —
no parquet variants yet) · `DeferredDirStampService` (`${jobRunId}:deferred-dir-stamps` ZSET) · the sync
executor / `OPS_CMD` set · `RedisCommandCollection` wire format (msgpack-lite+base64 under `obj`) · `CmdMeta`
shape (the diff sets `ctime=null`; full removal is a later follow-up).

---

## 16. Wire-format compatibility

The TS side encodes with **`msgpack-lite`**; the parquet-service decodes with Python **`msgpack`**. The
prototype already round-trips NDM payloads successfully, so they're compatible — but **verify** explicitly
for the expanded `ParquetItem` (esp. the int64-as-string fields) and for the `Cmd` shape the parquet-service
emits back onto `${jobRunId}:commands` (it must match `RedisCommandCollection`'s decode at
`redis-collections.ts:226`). This cross-language `Cmd` contract is the single highest-risk integration point.

---

## 17. Open items
1. **`acl_hash` canonical-form rules** (§6) — the one remaining blocker for the producer.
2. **int64-as-string** decision (§3 / §2.2) — confirm strings (vs. accepting ms precision) for ns
   timestamps + inode.
3. **Per-path `parquetStream` construction** (§4) — map-by-pathId vs lazy-in-activity.
4. **Flag storage** on jobs-service (global, DB-only, toggle scripts) + the routing point where it picks
   `MigrationWorkflow` vs `ParquetMigrationWorkflow` (§11).
5. **Cross-SDK completion signal** (§13) — chosen: parquet-service signals the TS workflow id **directly**.
   Lock the minimal payload + pass signal-name/workflow-id at start; decide multi-source aggregation (N signals).
6. **`Cmd` wire contract** verification (§16).
7. **Shared-activity parameterization** (§11) — confirm the discovery scan activity takes `publishParquet`/
   `pathId` (vs. fully duplicating the activity body).
8. **Baseline scan structure** (§12) — two scan children (source+dest) vs. one child walking both.

---

## 18. Acceptance criteria
- Foundation merged onto `ab/parquet-redesign`; `ParquetItem` expanded to 12 fields; per-path stream key.
- New `ParquetMigrationWorkflow` + `ParquetChildScanWorkflow` + `ParquetChildSyncWorkflow` exist; legacy
  `MigrationWorkflow` family untouched; jobs-service routes on `enable_parquet`.
- `ParquetChildScanWorkflow` dual-streams source (+dest at baseline) with correct ordering + NFC + bulk;
  dirs emitted as rows; `acl_hash` present; ns timestamps + inode carried without precision loss.
- EOF sentinel emitted once per `(jobRunId, pathId)`; backpressure gates on both streams.
- Parent triggers parquet-service via activity (Bearer JWT, run_mode, idempotent), waits on
  `parquetCompletion` signal **and** sync-child completion, and forwards pause/stop to both children + the
  parquet-service.
- Flag on → commands originate from parquet-service diff; flag off → legacy workflow runs, literally unchanged.
- `:files` → db-writer → inventory unchanged throughout.
