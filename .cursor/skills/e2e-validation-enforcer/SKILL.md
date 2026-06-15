---
name: e2e-validation-enforcer
description: Audits NDM API E2E tests in ndm-api-tests/ for robust report validation and enforces 14 specific rules covering CoC/cutover/discovery report fixtures, deletion-sync, incremental delta counts, pause/resume, custom migration options, rate-limiting smoke, support bundle, DLM focus markers, file/directory operation parity, and file/directory metadata-change parity. Use when the user asks to audit/review/enforce E2E test validation, when fixing CoC/cutover/discovery report coverage, when re-enabling cutover or rate-limiting tests, when checking directory coverage parity with files, when checking E2E robustness, or when working in ndm-api-tests/.
disable-model-invocation: true
---

# E2E Validation Enforcer

Audits and (on confirmation) fixes NDM API E2E tests in [ndm-api-tests/](../../../ndm-api-tests/) so that report validation is robust and the 12 rules below are enforced. Defers to [go-tests.mdc](../../rules/go-tests.mdc) for Go/Ginkgo conventions and to [e2e-testing/SKILL.md](../e2e-testing/SKILL.md) for the broader E2E test structure.

## Behaviour

1. **Audit first** — emit a findings checklist grouped by rule, with `file:line` citations and severity. Never edit before showing findings.
2. **Fix on confirmation** — apply targeted fixes per rule recipe.
3. **Re-audit + build** — run `go build ./...` from `ndm-api-tests/` and re-run the audit to confirm zero open findings.

## Hard scope

- Edit only under `ndm-api-tests/` (tests + `validators/`).
- Never touch product source under `services/`. Fixtures must match what the service actually emits (see [reference.md](reference.md)).
- Treat `disable-model-invocation: true`: only run when explicitly invoked.

## The 14 rules

Each rule = Issue → Change → Outcome. Severity is `blocker` unless noted.

| # | Rule | Detection signal | Severity |
|---|------|------------------|----------|
| 1 | CoC migration report fixtures assert all 16 columns (protocol-specific) | JSON fixtures under `ndm-api-tests/validators/**/*migration*.json` containing fewer than 16 unique keys across rows | blocker |
| 2 | Every test that runs cutover MUST validate the cutover CoC report | `CreateBulkCutoverJob` / `cutover` in a `_test.go` with no corresponding `ValidateReport(..., JobTypeCutover, ...)` call (or only a commented-out block) | blocker |
| 3 | Cutover fixtures use only real cutover CSV columns | JSON fixtures referenced as `JobTypeCutover` containing keys not in the cutover column set (notably `Target Checksum`) | blocker |
| 4 | Discovery report fixtures assert all 20+ stable columns | JSON fixtures under `ndm-api-tests/validators/**/*discovery*.json` containing fewer than 20 unique keys | blocker |
| 5 | Deletion-sync incremental runs assert the deleted-files report | Test triggers deletion-sync without calling `CountDeletedReportRows(...)` or validating `deleted-report.csv` | blocker |
| 6 | Incremental runs assert exact delta count, not `>= N` | `BeNumerically(">", ...)` / `BeNumerically(">=", ...)` on incremental file counts; should be `Equal(expected)` | blocker |
| 7 | Pause/resume waits for `PAUSED` before `RESUME` | A `"PAUSE"` signal followed by `"RESUME"` without an intervening `WaitForJobState(..., "PAUSED")` | blocker |
| 8 | Custom migration options are verified on destination | `MigrationJobParams.Options` sets `excludeFilePatterns` / `preserveAccessTime: false` / `preservePermissions: false` without a corresponding destination-side check on excluded files, atime, or perms | major |
| 9 | Rate-limiting smoke test is enabled in CI | `XIt(`, `PIt(`, or `Pending(` on rate-limiting / 429 tests in `ndm-api-tests/tests/smoke/` | blocker |
| 10 | Support bundle tests validate migration + cutover reports | `TC-SUPPORT-BUNDLE_test.go` (or any bundle test) runs migration/cutover without `ValidateReport` or `CountMigrationReportRows` | blocker |
| 11 | DLM and integration-branch scenarios contain no focus markers | `FIt(`, `FDescribe(`, `FContext(`, `FSpecify(`, `FWhen(` anywhere under `ndm-api-tests/` | blocker |
| 12 | Cutover fixtures actually fail when content is wrong | A cutover fixture with no rows, or with rows whose checksum/path values are stale placeholders. Covered by rules 2 and 3. | blocker |
| 13 | File add/change/delete operations have a matching directory operation | A test that adds, changes, or deletes **files** (`AddDataToVolume`, `ModifyDataOnVolume`, `RemoveDeltaFromVolume`, or any helper that only touches files) without a corresponding directory add/change/delete in the same scenario | major |
| 14 | File metadata-change steps have a matching directory metadata-change step | A step that changes **file** metadata (atime, mtime, permissions/mode, owner/group, SID/ACL, stamp) without a corresponding **directory** metadata change | major |

## Canonical column sets

Source of truth: [`services/reports-service/src/csv/csv_export.service.ts`](../../../services/reports-service/src/csv/csv_export.service.ts). Full list in [reference.md](reference.md).

- **Migration CoC (16 columns):** `Source Path`, `Destination Path`, `Source Checksum`, `Destination Checksum`, `ChecksumMatchStatus`, `Checksum Generated Timestamp (UTC)`, `CopyContentStatus`, `StampMetaDataStatus`, `Type`, `Size in Bytes`, plus 6 protocol-specific columns (SMB: 6 SID/ACE columns; NFS: UID/GID/permission columns).
- **Cutover CoC (8 columns):** `Source Path`, `Destination Path`, `Source Checksum`, `Destination Checksum`, `ChecksumMatchStatus`, `Checksum Generated Timestamp (UTC)`, `Type`. (Cutover query in `getCutoverInventoryDataQuery` does **not** emit `CopyContentStatus`, `StampMetaDataStatus`, SID/ACE/UID/GID/permissions.) Notable: there is no `Target Checksum` column anywhere — the correct name is `Destination Checksum`.
- **Deleted report (1 column):** `Source Path`.
- **Discovery report (20+ stable sub_category keys):** `Total Count`, `Regular Files Count`, `Symbolic Links Count`, `Hard Links Count`, `Junctions Count`, `Volume Mount Points Count`, `Shortcuts Count`, `Total Space for Regular Files`, `Total Space for Directories`, `Total Space Used`, `max_file_size`, `max_depth`, `max_name_length`, `avg_file_size`, `avg_depth`, `avg_name_length`, `total_directories`, `total_files`, `Path`, `Config Name`, `Protocol`, `Status`, `Total Time`, `Total Number of Directories`, `Directories with more than 1 Million Files`. Plus dynamic sub_categories per workload (extension distributions, time distributions, top-5 lists).

## Audit workflow

Copy this checklist into your reply at the end of the audit:

```
E2E Validation Enforcer — Findings

- [ ] R1 CoC migration column coverage:   <count> file(s)
- [ ] R2 Cutover validation enabled:      <count> test(s)
- [ ] R3 Cutover fixture columns valid:   <count> file(s)
- [ ] R4 Discovery column coverage:       <count> file(s)
- [ ] R5 Deletion-sync report assertions: <count> test(s)
- [ ] R6 Exact delta counts (no >=):      <count> assertion(s)
- [ ] R7 Pause waits for PAUSED:          <count> test(s)
- [ ] R8 Custom options verified on dest: <count> test(s)
- [ ] R9 Rate-limiting smoke enabled:     <count> test(s)
- [ ] R10 Support-bundle report checks:   <count> test(s)
- [ ] R11 No focus markers (FIt/etc.):    <count> file(s)
- [ ] R12 Cutover fixtures non-vacuous:   <count> file(s)
- [ ] R13 File ops have directory ops:    <count> test(s)
- [ ] R14 File meta has directory meta:   <count> step(s)
```

Under each rule, list `path/to/file.go:LINE — short description`.

### Step 1 — Discover

Run these searches (use the `Grep`/`Glob` tools, not shell):

| Rule | Pattern | Glob |
|------|---------|------|
| R1, R3 | n/a — load each JSON fixture and count unique keys | `ndm-api-tests/validators/**/*migration*.json`, `**/*cutover*.json` |
| R2 | `CreateBulkCutoverJob\|JobTypeCutover\|cutoverRunID` | `ndm-api-tests/tests/**/*_test.go` |
| R3 | `"Target Checksum"` | `ndm-api-tests/validators/**/*.json` |
| R4 | n/a — load each JSON fixture and count unique keys | `ndm-api-tests/validators/**/*discovery*.json` |
| R5 | `deletion.?sync\|DeletionSync\|deleted-report` | `ndm-api-tests/tests/**/*_test.go` |
| R6 | `BeNumerically\("(>=?\|>)"` near `incremental\|delta\|sync\|CoC` | `ndm-api-tests/tests/**/*_test.go` |
| R7 | `HandleJobRunStateChange\(.*"PAUSE"` and absence of `WaitForJobState\(.*"PAUSED"` before next `"RESUME"` | `ndm-api-tests/tests/**/*_test.go` |
| R8 | `excludeFilePatterns\|preserveAccessTime\|preservePermissions` | `ndm-api-tests/tests/**/*_test.go` |
| R9 | `XIt\(\|PIt\(\|Pending\(` | `ndm-api-tests/tests/smoke/**/*_test.go` |
| R10 | files that call `cutover` / `migration` but not `ValidateReport\|CountMigrationReportRows\|CountCocFileOnlyRows` | `ndm-api-tests/tests/e2e/TC-SUPPORT-BUNDLE*_test.go` (and other bundle tests) |
| R11 | `\bFIt\(\|\bFDescribe\(\|\bFContext\(\|\bFSpecify\(\|\bFWhen\(` | `ndm-api-tests/**/*_test.go` |
| R12 | JSON cutover fixture with `[]` or only stale `Target Checksum` keys | `ndm-api-tests/validators/**/*cutover*.json` |
| R13 | `AddDataToVolume\|ModifyDataOnVolume\|RemoveDeltaFromVolume\|AddData\|ModifyData\|RemoveData\|createnew\|fsutil file\|dd if=` (file ops) — then confirm the same scenario also has a directory op (`mkdir`/`rmdir`/`AddDir`/`RemoveDir`/rename of a directory) | `ndm-api-tests/tests/**/*_test.go` |
| R14 | `preserveAccessTime\|preservePermissions\|atime\|mtime\|chmod\|chown\|Chmod\|Chown\|SetPermissions\|StampMetaData\|ModifyMetadata\|touch -` (file metadata change) — then confirm a matching directory metadata change exists | `ndm-api-tests/tests/**/*_test.go` |

### Step 2 — Cite each finding

Format: `- ndm-api-tests/tests/e2e/<file>_test.go:<line> — <one-line description>`.

Example findings produced against the current tree:

- `ndm-api-tests/validators/TC-002-JSON/SMB/src_to_dest_vol_migration.json:1 — R1 fixture asserts 2 columns (Destination Checksum, Source Path); expected 16 for SMB migration CoC.`
- `ndm-api-tests/tests/e2e/TC-002_test.go:344 — R2 cutover validation block commented out; cutover_validators path TC-009-JSON does not exist.`
- `ndm-api-tests/validators/SMB/cutover_validation.json:1 — R3 references Target Checksum (not a real cutover column); use Destination Checksum.`
- `ndm-api-tests/validators/TC-002-JSON/SMB/src_vol_discovery.json:1 — R4 fixture asserts 2 sub_category keys; expected 20+ stable discovery sub_categories.`
- `ndm-api-tests/tests/smoke/ratelimiting_test.go:22 — R9 XIt disables the only HTTP-429 regression check.`
- `ndm-api-tests/tests/e2e/TC-SUPPORT-BUNDLE_test.go — R10 runs migration + cutover with no ValidateReport / CountMigrationReportRows calls.`
- `ndm-api-tests/tests/e2e/TC-004_test.go:293 — R13 AddDataToVolume / RemoveDeltaFromVolume act on files only; no matching directory add/delete in the scenario.`
- `ndm-api-tests/tests/e2e/TC-002_test.go:220 — R14 preserveAccessTime/preservePermissions exercise file metadata only; no directory metadata change step.`

### Step 3 — Confirm

After the checklist, ask: *"Apply fixes for which rules? (e.g. all blocker, R2+R3 only, none)"*. Do not edit until the user confirms.

## Fix recipes

Apply only the recipes the user confirmed. After every recipe, re-run the matching detection.

### R1 — Expand migration CoC fixture to all 16 columns

For each migration fixture row, add the missing column keys. Use values from a real CSV (`fetchCocCSV`) when available, otherwise leave the existing 2 keys and add the remaining keys with stable, easily-asserted values (e.g. `"ChecksumMatchStatus": "yes"`, `"Type": "file"`).

```json
{
  "Source Path": "<existing>",
  "Destination Path": "<existing>",
  "Source Checksum": "<existing>",
  "Destination Checksum": "<existing>",
  "ChecksumMatchStatus": "yes",
  "Checksum Generated Timestamp (UTC)": "<UTC string>",
  "CopyContentStatus": "SUCCESS",
  "StampMetaDataStatus": "SUCCESS",
  "Type": "file",
  "Size in Bytes": "<bytes>",
  "Source Owner SID": "<SID>", "Source Group SID": "<SID>", "Source ACE Details": "<acl>",
  "Target Owner SID": "<SID>", "Target Group SID": "<SID>", "Target ACE Details": "<acl>"
}
```

NFS variant: replace the last 6 keys with `Source UID`, `Destination UID`, `Source GID`, `Destination GID`, `Source Unix Permissions`, `Destination Unix Permissions`. Directory rows: `Type: "directory"`, empty checksums.

### R2 — Re-enable cutover CoC validation

In every `_test.go` that runs cutover, after `WaitForJobState(cutoverRunID, APPROVED_JOBRUN)`, add:

```go
By("Validating cutover CoC report")
cutoverValidator := fmt.Sprintf("../../validators/%s/cutover_validation.json", PROTOCOL_TYPE)
result, err := ValidateReport(
    cutoverRunID,
    JobTypeCutover,
    cutoverValidator,
    volumeReplacementMaps[i],
)
Expect(err).NotTo(HaveOccurred(), "Cutover report validation failed for run %s", cutoverRunID)
By(fmt.Sprintf("Cutover validation result: %v", result))
```

Delete the old commented `// By("Validating cutover reports") ...` block. Do not reintroduce a path under `TC-009-JSON` — it does not exist.

### R3 — Replace invalid cutover columns

In each `*cutover*.json`:

- Rename `Target Checksum` → `Destination Checksum`.
- Keys must be a subset of: `Source Path`, `Destination Path`, `Source Checksum`, `Destination Checksum`, `ChecksumMatchStatus`, `Checksum Generated Timestamp (UTC)`, `Type`.
- Remove any other keys (cutover CoC does not emit them; the validator silently passes when keys are absent from the CSV).

### R4 — Expand discovery fixture to all 20+ sub_categories

Replace the 2-key fixture with at least the 25 stable `sub_category` headers in [reference.md](reference.md). Use exact counts/sizes from a real run when available; otherwise include the keys with realistic placeholder values so the validator fails when the columns disappear from the CSV.

### R5 — Assert deleted-files report on deletion-sync runs

After the deletion-sync job completes:

```go
deletedCount, err := CountDeletedReportRows(jobRunID)
Expect(err).NotTo(HaveOccurred(), "Error reading deleted-report.csv for %s", jobRunID)
Expect(deletedCount).To(Equal(expectedDeletedCount),
    "deleted-report.csv should list %d removed files but got %d", expectedDeletedCount, deletedCount)
```

`CountDeletedReportRows` lives in [`utils/report_validator.go`](../../../ndm-api-tests/utils/report_validator.go).

### R6 — Exact delta count

Replace:

```go
Expect(rowCount).To(BeNumerically(">", expected))
```

with:

```go
Expect(rowCount).To(Equal(expected),
    "incremental sync expected exactly %d changed files but got %d", expected, rowCount)
```

Reference: `CountCocFileOnlyRows` for file-only counts, `CountMigrationReportRows` for total rows.

### R7 — Wait for PAUSED before RESUME

Reference (correct) pattern: [`TC-003_test.go`](../../../ndm-api-tests/tests/e2e/TC-003_test.go) lines 195-201. Apply the same shape:

```go
err = HandleJobRunStateChange(jobRunID, "PAUSE", list)
Expect(err).NotTo(HaveOccurred(), "Error pausing job %s", jobRunID)
err = WaitForJobState(jobRunID, "PAUSED")
Expect(err).NotTo(HaveOccurred(), "Job %s did not reach PAUSED", jobRunID)
err = HandleJobRunStateChange(jobRunID, "RESUME", list)
Expect(err).NotTo(HaveOccurred(), "Error resuming job %s", jobRunID)
```

Never send `RESUME` without an intervening `WaitForJobState(..., "PAUSED")`.

### R8 — Verify custom options on destination

After migration completes, assert the destination reflects each option. Use the existing `fileServer`/`ontap_client` helpers; do not invent new product behaviour.

- `excludeFilePatterns`: list destination directory and assert excluded files are absent.
- `preserveAccessTime: false`: assert destination atime is newer than source atime (or simply not equal).
- `preservePermissions: false`: assert destination permission mode differs from source default (or matches the destination volume default).

Example shape:

```go
By("Verifying excludeFilePatterns took effect on destination")
destFiles, err := ListDestinationFiles(destinationPathID1, headers)
Expect(err).NotTo(HaveOccurred())
for _, pattern := range []string{"*.mp4", "*.mp3", "*.pdf"} {
    Expect(destFiles).NotTo(ContainElement(MatchRegexp(pattern)),
        "exclude pattern %q failed: destination contains matching files", pattern)
}
```

### R9 — Enable rate-limiting smoke

In [`ratelimiting_test.go`](../../../ndm-api-tests/tests/smoke/ratelimiting_test.go) change `XIt(` → `It(`. Do not add a new `Skip(...)` unless an environment prerequisite genuinely cannot be met (document the prerequisite in a comment if you do).

### R10 — Support-bundle report checks

In [`TC-SUPPORT-BUNDLE_test.go`](../../../ndm-api-tests/tests/e2e/TC-SUPPORT-BUNDLE_test.go) (and any other bundle test that runs jobs), after the migration job completes add `ValidateReport(migrationJobRunID, JobTypeMigration, ...)`; after the cutover job completes add `ValidateReport(cutoverRunID, JobTypeCutover, ...)`. Reuse the same fixtures introduced for R1 and R2 — do not create bundle-specific copies.

### R11 — Remove focus markers

Replace `FIt(` → `It(`, `FDescribe(` → `Describe(`, `FContext(` → `Context(`, `FSpecify(` → `Specify(`, `FWhen(` → `When(`. Confirm no stragglers via the R11 search.

### R12 — Non-vacuous cutover fixtures

Confirmed by R2 + R3: re-enabled validation with valid columns and at least one row whose `Destination Checksum` matches a real migrated file. An empty array `[]` passes vacuously and is a violation.

### R13 — Directory operation parity with file operations

Principle: **anytime files are added, changed, or deleted, there must be a corresponding action for directories** in the same scenario, and that directory action must be validated the same way the file action is.

For each file operation in the test, add the matching directory operation immediately alongside it:

| File operation in test | Add the directory counterpart |
|------------------------|-------------------------------|
| Add files (`AddDataToVolume`, `fsutil file createnew`, `dd if=`) | Create one or more directories in the same delta path (`mkdir`/`AddDirToVolume`) |
| Change files (`ModifyDataOnVolume`) | Change a directory (rename, move, or re-create a subdirectory) |
| Delete files (`RemoveDeltaFromVolume`) | Delete a directory (`rmdir`/`RemoveDirFromVolume`) |

Then assert the directory change reaches the destination and appears in the report. Directory rows in the CoC report have `Type: "directory"` and an empty `Destination Checksum`; in discovery they roll into `Total Number of Directories` / `total_directories`. Example shape:

```go
By("Adding files AND directories to the source (R13 parity)")
deltaFolder, err := AddDataToVolume(sourceVolumePath1) // files
Expect(err).NotTo(HaveOccurred())
err = AddDirToVolume(sourceVolumePath1, deltaFolder)    // directories — parity
Expect(err).NotTo(HaveOccurred())

// ...after migration...
By("Validating directory rows reached destination (R13)")
dirRows, err := CountCocDirectoryRows(migrationJobRunID) // directory-only rows
Expect(err).NotTo(HaveOccurred())
Expect(dirRows).To(Equal(expectedDirCount),
    "expected %d directory rows in CoC but got %d", expectedDirCount, dirRows)
```

If a directory-specific helper (e.g. `AddDirToVolume`, `RemoveDirFromVolume`, `CountCocDirectoryRows`) does not exist yet, add it under `ndm-api-tests/utils/` mirroring the existing file helpers in [`file_server.go`](../../../ndm-api-tests/utils/file_server.go) — do not change product source.

### R14 — Directory metadata-change parity with file metadata changes

Principle: **anytime there is a step to change metadata for files, a metadata change for directories must be added.** Metadata = atime, mtime, permissions/mode, owner/group, SID/ACL, and stamp options.

For each file metadata step, add the directory equivalent and assert it on the destination:

| File metadata step | Add the directory counterpart |
|--------------------|-------------------------------|
| `preserveAccessTime` / atime change on files | Same atime change/assertion on a directory |
| `preservePermissions` / `chmod` on files | `chmod` + assertion on a directory |
| `chown` / owner/group on files | `chown` + assertion on a directory |
| SID / ACL stamp on files | SID/ACL stamp + assertion on a directory |

Example shape:

```go
By("Changing permissions on files AND directories (R14 parity)")
err = SetPermissionsOnFile(sourceVolumePath1, fileRelPath, 0640)
Expect(err).NotTo(HaveOccurred())
err = SetPermissionsOnDir(sourceVolumePath1, dirRelPath, 0750) // parity
Expect(err).NotTo(HaveOccurred())

// ...after migration...
By("Verifying directory permissions on destination (R14)")
destDirPerm, err := GetDirPermissions(destinationVolumePath1, dirRelPath)
Expect(err).NotTo(HaveOccurred())
Expect(destDirPerm).To(Equal(expectedDirPerm))
```

Tie directory metadata into the report assertions too: for SMB confirm `Source/Target ACE Details` and SID columns on directory rows; for NFS confirm `Source/Destination Unix Permissions`, UID, and GID on directory rows.

## Verification after fixes

```bash
cd ndm-api-tests
go build ./...
ginkgo -v --trace --dry-run ./tests/e2e/...
```

For targeted re-runs: `ginkgo -v --trace --focus="TC-002"`.

Re-run the audit. The findings checklist must be all-zero before declaring done.

## Additional resources

- Column source of truth: [reference.md](reference.md)
- E2E test conventions: [`.cursor/skills/e2e-testing/SKILL.md`](../e2e-testing/SKILL.md)
- Go/Ginkgo review rules: [`.cursor/rules/go-tests.mdc`](../../rules/go-tests.mdc)
- Always-on guardrails for the same 14 rules: [`.cursor/rules/e2e-validation-enforcer.mdc`](../../rules/e2e-validation-enforcer.mdc)
