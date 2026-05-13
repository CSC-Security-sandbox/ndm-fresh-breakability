## Why

Migrate scan today emits **no command** when source and destination agree on **content** (size, mtime) and **metadata** (ctime within tolerance), so **access-time drift** between source and destination is never repaired. Incremental passes and cutover reconciliations can leave the destination with a stale `atime` even when the file is otherwise aligned. Operators expect access time on the destination to match the source when nothing else changed.

The first iteration of this change added a 3rd branch in `buildCommand` that reuses `OPS_CMD.STAMP_META` to fix the drift. That reuse is correct but heavy: every atime-only restamp also redoes chmod, chown, and (on Windows/SMB) ACL stamping. This iteration introduces a dedicated atime-only op so the path is cheap, and extends coverage to SMB, symlinks, and the full Ginkgo E2E lifecycle.

## What Changes

- Introduce **`OPS_CMD.STAMP_ATIME`** in `lib/jobs-lib/src/types/enums.ts` — a new operation that sets access time (and the already-aligned mtime) on the destination only, without touching permissions, ownership, or ACL.
- Refactor the **migrate scan 3rd branch** in `command-generation.service.ts` to emit `STAMP_ATIME` (instead of `STAMP_META`) when neither a content update nor a metadata update is required AND `source.atimeMs !== destination.atimeMs` AND the job is not discovery.
- Add **`StampAtimeService`** in `services/worker/src/activities/core/migrate/command-execution/` that calls `fs.promises.utimes` (or `lutimes` for symlinks) and performs a defensive `lstat`-based re-check before the syscall to skip the work when the destination is already aligned.
- Run **`preserveAccessAndModifiedTime`** in parallel inside `StampAtimeService` when `jobConfig.options.preserveAccessTime` is true, so the new path stays orthogonal to source preservation.
- Wire `STAMP_ATIME` into `CommandExecService.executeCommand` and map results to the existing `ItemInfo.stampMetaDataStatus` column (no DB migration).
- Apply consistently to **non-discovery migration job types** (migration, incremental, cutover) on both **NFS** (Linux worker) and **SMB** (Windows worker, UNC paths) for **files**, **directories**, and **symlinks**.
- **Discovery** jobs MUST NOT run this branch and MUST NOT emit `STAMP_ATIME` commands.
- Behavior is **explicitly independent** of the **`preserveAccessTime`** job flag for gating.

## Capabilities

### New Capabilities

- `migrate-scan-atime-reconcile`: Scan-time detection of atime-only drift when content and metadata already match, and emission of a dedicated atime-only stamp command (with execution semantics provided by the new `StampAtimeService`).

### Modified Capabilities

- _(none — no existing `openspec/specs/` baselines in repo)_

## Impact

- **Primary:** `services/worker` — `CommandGenerationService.buildCommand`, new `StampAtimeService`, `CommandExecService` routing, metrics.
- **Secondary:** `lib/jobs-lib` (`OPS_CMD` enum), worker NestJS command-execution module wiring.
- **Tests:** Jest unit + component (tmpdir-static) specs in `services/worker`; Ginkgo E2E + new `ndm-api-tests/utils/atime_manager.go` in `ndm-api-tests`.
- **No** `db-writer` schema change, **no** `jobs-service` API contract change, **no** UI changes.

## Non-goals

- Changing the meaning or implementation of **`preserveAccessTime`** (source preservation / existing stamp ordering).
- New operator-facing job options or UI toggles for this behavior.
- Protocol-specific semantics beyond what existing `lstat` / `utimes` / `lutimes` paths already support (document Windows/SMB caveats in design only).
- Fixing clock skew or cross-filesystem timestamp precision beyond comparing numeric `atimeMs` as reported by the worker environment.
- Implementing the Go SMB worker prototype in `go-smb-worker/` (README-only, out of scope).
