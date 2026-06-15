# E2E Validation Enforcer — Canonical Column Reference

Source of truth for every list below: [`services/reports-service/src/csv/csv_export.service.ts`](../../../services/reports-service/src/csv/csv_export.service.ts) and [`services/reports-service/src/activities/discovery-report/query/discovery-report.query-mapper.ts`](../../../services/reports-service/src/activities/discovery-report/query/discovery-report.query-mapper.ts). If the service changes, update this file before changing fixtures.

---

## Migration CoC report (`coc-report.csv`) — 16 columns

Produced by `getInventoryDataQuery` + `getMigrationCoCColumns(protocol, includeCocStatusColumns=true)` when the job type is `MIGRATE`.

Protocol-agnostic columns (10):

1. `Source Path`
2. `Destination Path`
3. `Source Checksum`
4. `Destination Checksum`
5. `ChecksumMatchStatus` — `"yes"` or `"no"` (directories are always `"yes"`)
6. `Checksum Generated Timestamp (UTC)` — `Dy Mon DD YYYY HH24:MI:SS`
7. `CopyContentStatus` — populated only for migration runs (`isMigrate=true`)
8. `StampMetaDataStatus` — populated only for migration runs (`isMigrate=true`)
9. `Type` — `file`, `directory`, or `softlink`
10. `Size in Bytes`

SMB protocol-specific (6):

11. `Source Owner SID`
12. `Source Group SID`
13. `Source ACE Details`
14. `Target Owner SID`
15. `Target Group SID`
16. `Target ACE Details`

NFS protocol-specific (6):

11. `Source UID`
12. `Destination UID`
13. `Source GID`
14. `Destination GID`
15. `Source Unix Permissions`
16. `Destination Unix Permissions`

Total: 16 columns regardless of protocol. A fixture with fewer than 16 unique keys violates R1.

---

## Cutover CoC report (`coc-report.csv` for `JobTypeCutover`) — 8 columns

Produced by `getCutoverInventoryDataQuery`. **Strict subset** of the migration columns — cutover does **not** emit `CopyContentStatus`, `StampMetaDataStatus`, `Size in Bytes`, or any of the SID/ACE/UID/GID/permission columns.

1. `Source Path`
2. `Destination Path`
3. `Source Checksum`
4. `Destination Checksum`
5. `ChecksumMatchStatus`
6. `Checksum Generated Timestamp (UTC)`
7. `Type`
8. (no eighth — total is 7 stable columns; left numbered for emphasis that anything beyond row 7 is invalid)

> **There is no `Target Checksum` column anywhere in the codebase.** The canonical name is `Destination Checksum`. Any fixture referencing `Target Checksum` violates R3 and silently passes validation (the validator skips unknown keys).

---

## Deleted-files report (`deleted-report.csv`) — 1 column

Produced by `getListEntriesQuery(jobRunId, ..., 'deleted', ...)`.

1. `Source Path`

Use `CountDeletedReportRows(jobRunID)` from [`utils/report_validator.go`](../../../ndm-api-tests/utils/report_validator.go) to assert the exact deleted count for R5.

---

## Excluded / Skipped lists — single column each

Currently disabled in `COC_BUNDLE_ENTRIES` (`excluded-report.csv` and `skipped-report.csv` are commented out), but the schema is the same:

1. `Source Path`

If the service re-enables them, the same R5-style assertion pattern applies (`countCocBundleCSVRows(jobRunID, "excluded-report.csv")` / `"skipped-report.csv"`).

---

## Discovery report — 20+ stable `sub_category` keys

The discovery CSV is produced by `DiscoveryReportService.generateCsvReport` which dynamically derives headers from the `sub_category` field of each row. The following sub_categories are emitted on every successful discovery run and form the stable contract (25+):

### File System Stats (10)

1. `Total Count`
2. `Regular Files Count`
3. `Symbolic Links Count`
4. `Hard Links Count`
5. `Junctions Count`
6. `Volume Mount Points Count`
7. `Shortcuts Count`
8. `Total Space for Regular Files`
9. `Total Space for Directories`
10. `Total Space Used`

### Maximum / Average Values (8)

11. `max_file_size`
12. `max_depth`
13. `max_name_length`
14. `avg_file_size`
15. `avg_depth`
16. `avg_name_length`
17. `total_directories`
18. `total_files`

### File Server Info (3, plus optional `File Server Name`)

19. `Path`
20. `Config Name`
21. `Protocol`

### Job Run Stats (2)

22. `Status`
23. `Total Time`

### Directory (2)

24. `Total Number of Directories`
25. `Directories with more than 1 Million Files`

### Dynamic sub_categories (vary per workload)

These appear when the workload has matching data. Include the ones your test scenario guarantees:

- `Number of Files` — `File Count with <size_group>` / `Capacity with <size_group>`
- `Modified` — `File Count with Modification Time <group>` / `Capacity With Modification Time <group>`
- `Created` — `File Count with Creation Time <group>` / `Capacity with Creation Time <group>`
- `Access Time` — `File Count with Access Time <group>` / `Capacity with Access Time <group>`
- `Depth` — `Files and Directory with depth: <group>` / `Capacity with depth: <group>`
- `Top 5 File Extensions (with file Capacity and Count)` — `<extension>`
- `Top File Extensions Summary` — `Top 5 Extensions Total`
- `Biggest` — `Top 5 Longest File Names`, `Top 5 Longest Directory Names`, `Top 5 Biggest Directory With Capacity`, `Top 5 Biggest Directory With Count`, `Top 5 Longest Directory Path`, `Top 5 Longest File Path`, `Top 5 Biggest File Names`
- `Redirects` — `Symbolic Links`, `Junctions`, `Volume Mount Points`, `Shortcuts`
- `Case Sensitivity Conflicts` — `<parent_path>` (dynamic)
- `Files without extensions and trailing spaces` — `<parent_path>` (dynamic)
- `Alternative Data Streams` — `Files`, `Directories`

A discovery fixture asserting fewer than 20 sub_category keys violates R4. Asserting the 25 stable keys above (with values that match the workload) is the minimum bar.

---

## Helpers to reuse

From [`ndm-api-tests/utils/report_validator.go`](../../../ndm-api-tests/utils/report_validator.go):

| Helper | What it returns | Use for |
|--------|-----------------|---------|
| `ValidateReport(jobRunID, jobType, spec, volumeReplacements...)` | per-format errors map | R1, R2, R3, R4, R10 |
| `CountMigrationReportRows(jobRunID)` | total row count in `coc-report.csv` | R6, R10 |
| `CountCocFileOnlyRows(jobRunID)` | file-only rows (non-empty `Destination Checksum`) | R6 |
| `CountDeletedReportRows(jobRunID)` | row count in `deleted-report.csv` | R5 |

From [`ndm-api-tests/utils/jobs.go`](../../../ndm-api-tests/utils/jobs.go) (and friends):

- `WaitForJobState(jobRunID, state, timeoutOpt...)` — required for R7 between `PAUSE` and `RESUME`.
- `HandleJobRunStateChange(jobRunID, "PAUSE" | "RESUME" | "STOP", list)` — never call `"RESUME"` without an intervening `WaitForJobState(..., "PAUSED")`.

---

## Job type / report layout cheatsheet

| Job type | CSV filename(s) | Validator job type constant | Notes |
|----------|-----------------|-----------------------------|-------|
| Discovery | `<jobRunId>-discover-report.csv` | `JobTypeDiscovery` | also PDF; dynamic headers |
| Migration | `coc-report.csv`, `deleted-report.csv` (in CoC ZIP) | `JobTypeMigration` | 16 columns in `coc-report.csv` |
| Cutover | `coc-report.csv` (in CoC ZIP) | `JobTypeCutover` | 7 columns, **no** `Target Checksum` |
