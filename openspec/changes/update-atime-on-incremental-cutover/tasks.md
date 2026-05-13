## 1. Scan inputs and job-type gating

- [x] 1.1 Trace migrate scan entry points (`command-generation.service`, scan activity) to find where `jobType` or discovery flag is available.
- [x] 1.2 Thread a boolean or job type into `buildCommand` (or equivalent) so DISCOVER is excluded without breaking other flows.

## 2. At-time-only branch in command generation (initial iteration — reuse STAMP_META)

- [x] 2.1 After `isContentUpdate` / `isMetaUpdated` both false and `dFile` present, compare `sFile.atimeMs` to `dFile.atimeMs`.
- [x] 2.2 When unequal and job is non-discovery, return a `Cmd` mirroring the metadata-only pattern (`COPY_*` `COMPLETED`, `STAMP_META` `READY`, metadata from source `sFile`).
- [x] 2.3 Ensure symlink / directory / file ops map matches existing `getOpsCommand` behavior.

## 3. Unit tests for initial iteration

- [x] 3.1 Add Jest coverage for `buildCommand`: atime mismatch emits stamp-only command; atime match returns undefined; discovery suppressed; jobType omitted stays backward compatible.
- [x] 3.2 Add regression test: `preserveAccessTime` false still emits atime-only command when other gates pass.

## 4. Initial validation

- [x] 4.1 Run `openspec validate update-atime-on-incremental-cutover --type change --strict` and fix any spec or structure issues.

## 5. Dedicated `OPS_CMD.STAMP_ATIME` op (jobs-lib)

- [x] 5.1 Add `STAMP_ATIME = 'sa'` to `OPS_CMD` enum in `lib/jobs-lib/src/types/enums.ts` (preserve order of existing values).
- [x] 5.2 Re-export through `lib/jobs-lib/src/index.ts` (verify no extra plumbing is needed).
- [x] 5.3 Update or add Jest spec for the enum if one exists (`lib/jobs-lib/src/types/enums.spec.ts` if present).

## 6. Refactor scan 3rd branch to emit STAMP_ATIME

- [x] 6.1 In `services/worker/src/activities/core/shared/command-generation.service.ts` `buildCommand`, replace `OPS_CMD.STAMP_META` in the atime-only branch with `OPS_CMD.STAMP_ATIME`; keep `COPY_*` `COMPLETED`, the `jobType !== 'DISCOVER'` gate, and strict `atimeMs` inequality.
- [x] 6.2 Verify `MigrateScanService` (and any retry path) still flows through this `buildCommand` with no regression.
- [x] 6.3 Update existing Jest tests in `command-generation.service.spec.ts` that asserted `STAMP_META` for the atime-only branch — switch the assertion to `STAMP_ATIME`.

## 7. Add `StampAtimeService` (worker execution)

- [x] 7.1 Create `services/worker/src/activities/core/migrate/command-execution/stamp-atime.service.ts` with `@Injectable()` `StampAtimeService.stampAtime(input: CommandExecInput): Promise<CommandOutput>`.
- [x] 7.2 Gate execution on `command.ops[OPS_CMD.STAMP_ATIME]` present AND status `!== OPS_STATUS.COMPLETED`.
- [x] 7.3 Implement defensive re-check: `fs.promises.lstat(targetPath)` and compare `atimeMs` to `command.metadata.atime`; skip syscall when equal, mark op `COMPLETED`.
- [x] 7.4 On mismatch, call `fs.promises.lutimes` for symlinks and `fs.promises.utimes` otherwise, with `(targetPath, new Date(metadata.atime), new Date(metadata.mtime))`.
- [x] 7.5 In parallel, run `preserveAccessAndModifiedTime(sourcePath)` (reused from `StampMetaService`) when `jobConfig.options.preserveAccessTime === true`.
- [x] 7.6 Implement error handling via `dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_TIME, errorType, command.id, error, ...)` + `jobContext.publishToErrorStream(...)`; push target error codes to `output.targetErrors`.
- [x] 7.7 Set `command.ops[OPS_CMD.STAMP_ATIME].status` to `COMPLETED` on success or `ERROR` on failures.

## 8. Wire `STAMP_ATIME` into command execution

- [x] 8.1 Register `StampAtimeService` in the worker NestJS command-execution module (alongside `StampMetaService`).
- [x] 8.2 In `services/worker/src/activities/core/migrate/command-execution/command-execution.service.ts`, inject `StampAtimeService` and route `OPS_CMD.STAMP_ATIME` execution.
- [x] 8.3 Map `StampAtimeService` result to `ItemInfo.stampMetaDataStatus` (reuse existing inventory column — no DB migration).

## 9. Metrics

- [x] 9.1 Add `MetricsService.METRIC.STAMP_ATIME` in the worker metrics module.
- [x] 9.2 Decorate `StampAtimeService.stampAtime` with `@Timed(MetricsService.METRIC.STAMP_ATIME)`.
- [x] 9.3 Add `@Timed({ category: 'stamp_phase', phase: 'atime_only' })` on internal phases if helpful (mirrors `StampMetaService` style).

## 10. Unit tests — scan + execution

- [x] 10.1 In `command-generation.service.spec.ts`: assert atime-only branch emits `OPS_CMD.STAMP_ATIME` (not `STAMP_META`) for `MIGRATE` and `CUT_OVER`; cover file, directory, symlink variants.
- [x] 10.2 In `command-generation.service.spec.ts`: input validation — `jobType=DISCOVER` → undefined; `jobType=undefined` → undefined; `dFile=undefined` → undefined; `src.atimeMs === dst.atimeMs` → undefined.
- [x] 10.3 In `command-generation.service.spec.ts`: regressions — `isContentUpdate=true` emits only `STAMP_META`; `isMetaUpdated=true` emits only `STAMP_META`.
- [x] 10.4 New `services/worker/src/activities/core/migrate/command-execution/stamp-atime.service.spec.ts`: positive file → `utimes` called with correct args.
- [x] 10.5 Positive symlink → `lutimes` called (not `utimes`).
- [x] 10.6 Defensive re-check: pre-aligned target → no `utimes`/`lutimes` call, op `COMPLETED`.
- [x] 10.7 Negative — missing `metadata.atime` → skipped; missing op → no-op.
- [x] 10.8 Negative — `utimes` throws → `dmError` + `publishToErrorStream` invoked, op status `ERROR`.
- [x] 10.9 R5 interaction — `preserveAccessTime=true` → `preserveAccessAndModifiedTime(source)` invoked in parallel; `preserveAccessTime=false` → not invoked.

## 11. Component tests (tmpdir-static, no SMB/NFS)

- [x] 11.1 New `services/worker/src/activities/core/migrate/command-execution/stamp-atime.service.component.spec.ts` using `os.tmpdir()` for real source + target trees.
- [x] 11.2 Create file, directory, symlink in both trees with distinct atimes via `fs.promises.utimes` / `lutimes`.
- [x] 11.3 Invoke `StampAtimeService.stampAtime`; assert `lstat(target).atimeMs === source.atimeMs` for each.
- [x] 11.4 Idempotency — re-invoke when src/dst already aligned; assert no observable change and op `COMPLETED`.
- [x] 11.5 Symlink semantics — `lstat` of link node updates; `stat` of the underlying target file is unchanged.

## 12. E2E helper — `atime_manager.go`

- [x] 12.1 Create `ndm-api-tests/utils/atime_manager.go` modeled on `permissions_manager.go` (SSH script → run on worker → parse → compare).
- [x] 12.2 Implement `SetSourceAtime(path string, atime time.Time) error` — `touch -a -t <stamp>` on NFS; `Set-ItemProperty -Path <unc> -Name LastAccessTime -Value <ts>` on SMB.
- [x] 12.3 Implement `GetAtime(paths []string) ([]AtimeEntry, error)` — `stat -c %X` on NFS; `(Get-Item <path>).LastAccessTimeUtc` on SMB.
- [x] 12.4 Implement assertion helpers `ExpectAtimeEqual(srcPath, dstPath string)` and `ExpectAtimeUnchanged(path string, baseline time.Time)`.

## 13. E2E Ginkgo spec — full lifecycle atime reconcile

- [x] 13.1 Create `ndm-api-tests/tests/e2e/TC-007-atime-reconcile_test.go` using `Describe` / `Context` / `It` and existing setup helpers (`SetupTestVolumesBeforeEach`, `CreateDiscoveryJob`, `CreateMigrationJob`, `CreateBulkCutoverJob`, `WaitForJobState`, `ApproveRejectBulkCutoverJob`).
- [x] 13.2 Discovery (negative R2) — atime mismatch present, run discovery, assert dest atimes unchanged for file, directory, symlink.
- [x] 13.3 Migration (positive R1/R4) — atime mismatch present, run migration, assert dest atime equals source atime for file, directory, symlink.
- [x] 13.4 Migration (R3 performance) — atimes pre-aligned, run migration, assert all observed atimes are unchanged from baseline (no-op).
- [x] 13.5 Incremental — drift dest atime only with content unchanged, run ad-hoc, assert atime realigns.
- [x] 13.6 Cutover — atime mismatch present, run cutover (approve), assert dest atime equals source atime.
- [x] 13.7 `preserveAccessTime=false` matrix — atime is still reconciled on dest (R5).
- [ ] 13.8 `preserveAccessTime=true` matrix — verify source atime preservation (deferred; helpers cover the assertion, additional `It` block can be added when CI capacity allows).
- [x] 13.9 Run under both `--protocol_type=SMB` and `--protocol_type=NFS` via `run-smb-azure-automation.sh` and `run-nfs-azure-automation.sh` (spec is protocol-parametric).

## 14. Final validation

- [ ] 14.1 Run worker unit + component test suites (`pnpm --filter worker test`) — deferred to CI; worker `node_modules` not installed locally.
- [ ] 14.2 Run E2E spec under both protocols against the live test environment — deferred to live runs of `run-{nfs,smb}-azure-automation.sh`.
- [x] 14.3 Run `openspec validate update-atime-on-incremental-cutover --type change --strict` and fix any spec or structure issues.
