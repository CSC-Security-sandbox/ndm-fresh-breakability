# Worker (Producer) Changes — NDM Parquet Redesign

> **Status:** Draft v0.3 · **Owner:** Abhishek Buragadda · **Last updated:** 2026-06-09
> The producer half of the Parquet metadata redesign. Pairs with
> [`services/parquet-service/SPEC.md`](../parquet-service/SPEC.md) (the consumer).
> Touches `services/worker` and `lib/jobs-lib`. All file:line refs are on branch `ab/parquet-redesign`
> unless noted as `ab/parquet-changes`.
> **v0.2:** the parquet path is a **separate duplicated workflow family** (`ParquetMigrationWorkflow` +
> `ParquetChildScanWorkflow` + `ParquetChildSyncWorkflow`), selected by jobs-service routing on
> `enable_parquet` — the legacy `MigrationWorkflow` is untouched. See §11–§14.
> **v0.3 (2026-06-09):** `acl_hash` decisions locked (§6) — **SMB/NTFS-only** (NFS → `null`); fetched via
> **async-koffi `GetNamedSecurityInfo`** fired in fixed-size logical batches (no native addon); hash = the
> **stamp-comparator projection** (not raw SD bytes), **BLAKE2b-128**. The producer scan is rewritten as a
> **threshold-chunked walk with a positional resume cursor** (§5) so a single **>1M-file directory** stays
> memory-bounded and crash-resilient.

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
| `acl_hash` | string \| null | **computed (net-new, §6)** | **SMB/NTFS only** — BLAKE2b-128 hex (`v1:`-prefixed); **`null` on NFS** (POSIX perms already in `mode`/`uid`/`gid`) |
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

## 5. Dual-stream producer wiring — threshold-chunked walk

`ParquetChildScanWorkflow`'s discovery scan replaces the legacy "publish per directory" walk with a
**threshold-chunked walk**, because a single directory may hold **>1M files** — too large to be the atomic
unit of work, of memory, or of crash recovery. The whole block is **gated on the activity input
`publishParquet`** (§11), set true only by `ParquetChildScanWorkflow`, so the legacy scan path is
byte-for-byte unchanged.

`scanDirectory` (`discovery-scan.service.ts`) streams entries via the `fs.Dir` async iterator (bounded
memory — it never materializes all entries) and accumulates them into a **chunk of `THRESHOLD`** raw entries
(config, ~2000). Per chunk:

1. `fs.stat(path, { bigint: true })` — **one** stat, reused for `ItemInfo`, the ns timestamps + `inode_num`,
   and the ACL fetch — plus `FileTypeDetectionService.detectFileType` and **`acl_hash` (§6)**. The chunk's
   ACL reads are fired concurrently and bounded by a semaphore (§6.1).
2. Build `ItemInfo[]` (legacy) and `ParquetItem[]` (new) from the same stats.
3. Publish in the **load-bearing order — files stream FIRST, parquet stream SECOND**:
   ```ts
   await jobContext.publishToFileStreamBulk(items);                   // legacy (db-writer source of truth)
   await jobContext.publishToParquetStreamBulk(pathId, parquetItems); // new (additive)
   ```
   The `:files` stream is the back-compat source of truth and already back-pressured; the parquet stream is
   the one expected to lag during rollout, so writing files first preserves legacy semantics.
4. Check backpressure (§10) and the activity `cancellationSignal` at the chunk boundary.
5. **Advance and persist the positional cursor** (below).

Everything per chunk is **O(THRESHOLD)** — memory, publish-payload size, backpressure granularity, and
worst-case re-work are all flat regardless of whether the directory holds 10 files or 10M.

**Crash resilience — positional cursor.** Today the atomic retry unit is one directory command
(`buildOrGetValidScanTask`, `common-task.service.ts:124`, reloads the Redis task on retry and skips
`COMPLETED` commands; persisted via `setTask`, `scan-activity.service.ts:149`) — too coarse for a 1M-file
directory. Extend it with a **within-command cursor**: `command.scanCursor` = the count of **raw enumeration
entries consumed** at the last **fully-published** chunk, persisted on the same Redis task **after** that
chunk's files+parquet writes land. On retry, restore the cursor, re-open the directory, **skip that many raw
entries**, and continue. Correctness:

- The cursor counts **raw** entries (not published items), so the skip maps exactly onto re-iteration;
  `shouldExcludeOrSkip` is deterministic, so filtered-out entries re-evaluate identically on resume.
- The cursor advances **only after a chunk is fully published**, so it always denotes a fully-published
  prefix. The chunk in flight at crash time re-publishes wholesale → ingest dedup (parquet-service by
  `filepath`, latest entry-id; db-writer upsert by path) absorbs the overlap → **no file is ever permanently
  skipped, and re-work is ≤ one chunk.**
- Relies on NTFS/ONTAP returning an **unchanged** directory in stable order (the `$I30` name-ordered B-tree
  — it does). Under concurrent mutation it degrades to ordinary single-pass-`readdir` consistency (which NDM
  already has, and which incremental scans converge), never worse.

**Non-atomic, by design:** the two `publish…Bulk` awaits aren't atomic; a crash between them leaves `:files`
ahead of parquet for the in-flight chunk. The not-yet-advanced cursor + wholesale re-publish + dedup is the
recovery path — no cross-stream coordination. Called out so reviewers don't assume atomicity.

> **Invariants** that make this safe: (1) duplicates are **free** — the contract is at-least-once, never
> exactly-once; (2) the only hard requirement is *never permanently skip an in-scope file*; (3) the EOF
> sentinel (§9) is emitted exactly once, only after the cursor reaches end-of-directory for **every**
> directory of the `pathId`.

---

## 6. `acl_hash` — fetch + canonical form (SMB/NTFS only)

Computed **server-side on the worker**, inside the chunk pipeline (§5) that produces the `ParquetItem`. The
parquet-service receives it pre-computed and **never recomputes** it — so there is **no cross-language parity
requirement**, which frees the algorithm choice (§6.3).

**Scope: SMB/NTFS only.** NFSv4 is **not supported by NDM**, and plain NFS has no ACLs — POSIX permissions
are already fully captured by the `mode` / `uid` / `gid` columns, which the parquet-service diff compares
directly. So on the NFS (Linux) worker the ACL path is a **no-op and `acl_hash` is `null`**; the whole §6
block runs only when `process.platform === 'win32'`. (There is no "existing NFSv4 ACL retrieval" — earlier
drafts assumed one; it never existed.)

### 6.1 Fetch mechanism — async-koffi `GetNamedSecurityInfo`, logically batched

The SD is read with **`GetNamedSecurityInfo(SE_FILE_OBJECT, OWNER|GROUP|DACL)`** called **directly from Node
via koffi** — the same P/Invoke surface the stamping pipeline's `Get-FileSecurityFast` uses, and the same
pattern discovery already uses for `FindFirstStreamW` (ADS) and `GetFileAttributesW` (reparse) in
`win-operation.service.ts`. No PowerShell on the hot path.

- **Async, not sync.** The existing koffi calls are *synchronous* and block the event loop; the ACL fetch
  **must** use koffi `.async` so each `GetNamedSecurityInfo` runs on the libuv threadpool and never stalls
  the scan. Concurrency is then `UV_THREADPOOL_SIZE` (raise it — currently unset, libuv default 4) instead
  of the 10-wide PowerShell shell pool.
- **"Batched" = logical, not a native addon.** There is **no Win32 bulk-ACL syscall** — `GetNamedSecurityInfo`
  is strictly per-object, so N files = N calls regardless. We exploit the chunk (§5): fire a chunk's ACL
  reads with `Promise.all` over the async-koffi call, bounded by a **semaphore (~16–32 in flight)**. A custom
  native batch addon was **rejected**: for an SMB-latency-bound workload it has the *same* in-flight ceiling
  as async-single (both = the threadpool) while adding a node-gyp dependency and intra-batch head-of-line
  blocking. (Perf model: koffi-async ≈ **10–15×** PowerShell-per-file; koffi-batch ≈ koffi-async ≈ 1×; the
  win is concurrency + dropping PowerShell's redundant `Test-Path` and interpreter/JSON overhead, not
  batching.)
- **`LocalFree` the SD.** Unlike `Get-FileSecurityFast` (which leaks the SD pointer), the koffi path **must**
  `LocalFree(ppSecurityDescriptor)` per call — at scan volume the leak is not tolerable.
- **Fallback:** a PowerShell `Get-FileSecurityFast` loop over the chunk (one command per chunk, **not** per
  file) is the zero-native-risk fallback for hosts where the FFI path fails. It feeds the identical canonical
  hash function (§6.2), so the hash is **independent of the fetch mechanism**.
- **Skip where it can't matter:** symlinks / reparse / junction / volume-mount points and excluded/skipped
  entries get `acl_hash = null` (no fetch). ADS rows share the host file's SD → carry the host's hash. A
  fetch failure on one entry → `acl_hash = null` + a soft error, never a failed directory.

### 6.2 Canonical form — the stamp-comparator projection (NOT raw SD bytes)

The hash must change **iff** the stamp gate `securityDescriptorEquals` (`win-operation.service.ts:483`) would
consider the source SD changed — that makes it a faithful, cheap proxy for "a re-stamp would do something."
So the hash is over a normalized **projection**, **not** the raw self-relative SD bytes. (Hashing raw bytes
is wrong: they carry `DaclAutoInherit` and CREATOR-OWNER mask/flag values the OS rewrites on its own →
spurious drift on every incremental → restamp loops — the exact class of bug in the `ndm-acl-stamping`
catalog.)

Canonical form (`v1`):
- **Include:** `Owner` SID, `Group` SID, `DaclPresent`, `DaclProtected`, the **stampable** `Attributes`
  subset (`parseStampableAttributes` — excludes Compressed/Encrypted/Sparse), and the DACL ACE list.
- **Per ACE:** `(AceType, AccessMask, AceFlags)` + `Sid`. (`IsInherited` is redundant with `AceFlags & 0x10`
  — do not double-count.)
- **ACE order: preserved as read** (the comparator is positional; sorting would diverge from the gate).
- **`S-1-3-0` (CREATOR OWNER):** lenient — `(AceType, count)` only, mask/flags excluded (the kernel rewrites
  them).
- **Excluded:** `DaclAutoInherit` (the OS flickers it) and the SACL (not in the pipeline).
- **Three-state DACL → distinct values:** NULL DACL (`DaclPresent=false`) → a `NULL_DACL` sentinel; empty
  present DACL → `[]`; populated → the ACE list. (NULL = allow-all and empty = deny-all are opposites and
  must never collide.)
- **Owner SID folded in** (it is a field). **Source SIDs only** — mapped/destination SIDs are out; a
  SID-mapping change is a manual re-stamp trigger, not a hash change.
- **Deterministic encoding:** fixed field order, hex masks, lowercased SID strings, an unambiguous delimiter,
  and a **`v1:` version prefix** so the definition can evolve (a bump intentionally forces a re-baseline).

The PowerShell `Get-FileSecurityFast` JSON **is already exactly this projection** (`Owner` / `Group` /
`DaclAces` / `DaclPresent` / `DaclProtected` / `Attributes`), so both the koffi path and the PS fallback feed
**one** pure TS `canonicalize()` + hash function.

### 6.3 Algorithm

**BLAKE2b-128** (truncate `crypto.createHash('blake2b512')` to 128 bits, hex) via Node's **built-in
`crypto`** — zero fragile native dependency. BLAKE3 is **dropped**: it was specified for cross-language
parity, but the parquet-service never recomputes the hash, so parity is moot. The canonical string is a few
hundred bytes, so hashing is negligible next to the SD fetch — algorithm is not a performance lever.

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
must be written exactly once per `(jobRunId, pathId)`. **Not** emitted on pause, **nor on a crash / partial
walk** — only after every directory's chunked walk for that `pathId` has fully drained (every positional
cursor, §5, reached end-of-directory). On a resumed scan the sentinel is therefore emitted only on the
attempt that actually finishes the walk.

---

## 10. Backpressure

Extend the existing file-stream gate `validateFileStreamLength` (`workflow-utils.ts:169`; cap
`maxDiscoveryFileStreamLen=200000`, `app.config.ts:40`; called from `child-scan.workflow.ts:109` via
`isFileStreamLenValidActivity`). The gate must check `XLEN` of **both** the `:files` stream **and** the
specific `${jobRunId}:${pathId}:parquet` stream the current activity feeds, sleeping 30s if either exceeds
the cap (`max(xlenFiles, xlenParquet) > cap`). Check the **specific** per-path parquet stream, not a sum
across paths (an idle path must not throttle an active one). The gate is evaluated **once per published
chunk** (§5), at the chunk boundary — the natural yield point of the chunked walk — not per file.

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

## 15. Sync-error enrichment → error-Parquet replay (producer side)

When `ParquetChildSyncWorkflow`'s executor fails an op, it must record **enough to replay the exact command**
— because in the parquet world commands come from the parquet-service **diff**, which is gone by retry time.
(The legacy `RetryMigrationWorkflow` re-derives commands by **re-scanning** source-vs-target via
`processItems`; that path does not exist here.) So the parquet sync executor **enriches** the error it
publishes.

**Producer change — the only worker-side change for retries.** Extend `OperationError`
(`lib/jobs-lib/src/types/metadata-types.ts:256`) with three **optional, additive** fields, populated **only**
by the parquet sync executor (the legacy executor and db-writer ignore them):

| Field | Source | Purpose |
|---|---|---|
| `opKind?: OPS_CMD` | the failing op (`cc`\|`sm`\|`sa`\|`cf`\|`cd`\|`rd`\|`rf`\|`cs`) | which op to retry |
| `command?: Cmd` | the `Cmd` being executed | full replay payload (path, `isDir`, `ops`+params, `metadata`) |
| `attempt?: number` | `command.attempt ?? 0` | retry-cap counter |

Also add an optional **`attempt?: number` to `Cmd`** (`stream-datatypes.ts:79`) so a re-failure echoes
`attempt+1` and the retry cap actually holds. Today's `DMError` carries neither `op_kind` nor a replayable
command, so without this the error Parquet cannot be turned back into commands.

The error still flows to the **single per-jobRun** `${jobRunId}:errors` stream (msgpack+base64,
`RedisErrorCollection`); the parquet-service `consume_errors` activity writes it to `<jobRunId>/errors/`
(parquet-service SPEC §3.3), and the **error→command replay runs in the parquet-service** (parquet-service
SPEC, Phase 2) — it owns the error Parquet, the `Cmd` msgpack encoder, and is already the command emitter.
Replay rebuilds the `Cmd` (new `id`, `originalCmdId` = `operation_id`, `attempt+1`, **only the failed op set
`READY`**, succeeded ops left `COMPLETED`) and bulk-XADDs to `${jobRunId}:commands`.

**Scope:** only **sync/operation** failures carry `opKind`/`command` and are replayable. **Scan/discovery**
errors (e.g. `READ_DIR`) leave them unset — recorded, but retried by re-running discovery for that subtree,
not via this path.

---

## 16. What stays unchanged

**The entire legacy `MigrationWorkflow` family** (`migration-parent-workflow.ts`,
`execute-migration-child-workflows.ts`, `child-scan.workflow.ts`, `child-sync.workflow.ts`,
`MigrateScanService` command generation) is **left intact** — jobs-service simply routes elsewhere when the
flag is on. Also unchanged: `db-writer` → `inventory` / `operation_errors` · the `${jobRunId}:files` stream +
its `publishToFileStream` consumers · `RetryMigrationWorkflow` and `CutOverWorkFlow` (legacy-only for now —
no parquet variants yet) · `DeferredDirStampService` (`${jobRunId}:deferred-dir-stamps` ZSET) · the
`OPS_CMD` set · `RedisCommandCollection` wire format (msgpack-lite+base64 under `obj`) · `CmdMeta` shape (the
diff sets `ctime=null`; full removal is a later follow-up). **Exception:** the parquet
`ParquetChildSyncWorkflow` executor additionally enriches `OperationError` for retry replay (§15); the legacy
sync executor is untouched.

---

## 17. Wire-format compatibility

The TS side encodes with **`msgpack-lite`**; the parquet-service decodes with Python **`msgpack`**. The
prototype already round-trips NDM payloads successfully, so they're compatible — but **verify** explicitly
for the expanded `ParquetItem` (esp. the int64-as-string fields) and for the `Cmd` shape the parquet-service
emits back onto `${jobRunId}:commands` (it must match `RedisCommandCollection`'s decode at
`redis-collections.ts:226`). This cross-language `Cmd` contract is the single highest-risk integration point.

---

## 18. Open items
1. ~~**`acl_hash` canonical-form rules** (§6)~~ — **RESOLVED (v0.3, §6):** SMB-only (NFS → `null`);
   async-koffi `GetNamedSecurityInfo` fired in logical batches (no native addon); canonical form = the
   stamp-comparator projection with preserved ACE order; BLAKE2b-128 (`v1:`). *Remaining sub-item:* tune
   `THRESHOLD`, `UV_THREADPOOL_SIZE`, and the ACL semaphore by benchmark on the real cluster (§5/§6.1).
2. **int64-as-string** decision (§3 / §2.2) — confirm strings (vs. accepting ms precision) for ns
   timestamps + inode.
3. **Per-path `parquetStream` construction** (§4) — map-by-pathId vs lazy-in-activity.
4. **Flag storage** on jobs-service (global, DB-only, toggle scripts) + the routing point where it picks
   `MigrationWorkflow` vs `ParquetMigrationWorkflow` (§11).
5. **Cross-SDK completion signal** (§13) — chosen: parquet-service signals the TS workflow id **directly**.
   Lock the minimal payload + pass signal-name/workflow-id at start; decide multi-source aggregation (N signals).
6. **`Cmd` wire contract** verification (§17).
7. **Shared-activity parameterization** (§11) — confirm the discovery scan activity takes `publishParquet`/
   `pathId` (vs. fully duplicating the activity body).
8. **Baseline scan structure** (§12) — two scan children (source+dest) vs. one child walking both.
9. **Retry-replay tuning** (§15) — `MAX_RETRY` default (~3) and whether `METADATA_UPDATE_CONFLICT` is
   replayable alongside `TRANSIENT`/`RECOVERABLE` (FATAL never replays).

---

## 19. Acceptance criteria
- Foundation merged onto `ab/parquet-redesign`; `ParquetItem` expanded to 12 fields; per-path stream key.
- New `ParquetMigrationWorkflow` + `ParquetChildScanWorkflow` + `ParquetChildSyncWorkflow` exist; legacy
  `MigrationWorkflow` family untouched; jobs-service routes on `enable_parquet`.
- `ParquetChildScanWorkflow` dual-streams source (+dest at baseline) with correct ordering + NFC + bulk;
  dirs emitted as rows; `acl_hash` present; ns timestamps + inode carried without precision loss.
- The per-directory walk is **chunked at a fixed `THRESHOLD`** (memory + publish size flat regardless of dir
  size); a >1M-file directory is processed without materializing all entries, and a worker crash mid-directory
  resumes from the persisted positional cursor (§5) with ≤ one chunk of (deduped) re-publish — no file
  permanently skipped, EOF only on the attempt that finishes the walk.
- `acl_hash` is computed only on SMB/NTFS via **async-koffi `GetNamedSecurityInfo`** (semaphore-bounded,
  `LocalFree`'d), is `null` on NFS, equals the **stamp-comparator projection** (not raw SD bytes), and is
  **stable across re-scans of an unchanged file** (no restamp loop).
- EOF sentinel emitted once per `(jobRunId, pathId)`; backpressure gates on both streams.
- Parent triggers parquet-service via activity (Bearer JWT, run_mode, idempotent), waits on
  `parquetCompletion` signal **and** sync-child completion, and forwards pause/stop to both children + the
  parquet-service.
- Flag on → commands originate from parquet-service diff; flag off → legacy workflow runs, literally unchanged.
- `:files` → db-writer → inventory unchanged throughout.
- Sync op-failures publish an enriched `OperationError` (`opKind` + `command` + `attempt`); the parquet-service
  writes them to `<jobRunId>/errors/` and (Phase 2) replays retryable rows as **failed-op-only** commands onto
  `${jobRunId}:commands` (FATAL excluded, capped at `MAX_RETRY`, deduped by `(path, op_kind)`).
