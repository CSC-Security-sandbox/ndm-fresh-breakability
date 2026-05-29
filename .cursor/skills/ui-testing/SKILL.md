---
name: ndm-ui-testing
description: Write Playwright UI end-to-end tests for the NDM control plane in ndm-ui-tests using Go, testify, and playwright-go. Use when the user asks for UI tests, page objects, discovery/migration/RBAC flows through the browser, job lifecycle validation via the UI, or Playwright test authoring for NDM.
---

# NDM UI E2E Testing

## Overview

UI E2E tests drive the NDM control plane through a real browser via [playwright-go](https://github.com/playwright-community/playwright-go). They live in `ndm-ui-tests/` and validate full user flows (wizards, forms, job runs, reports, RBAC).

| Level | Location | Stack | Infra |
|-------|----------|-------|-------|
| Unit / component | `services/*/src/` | TypeScript, Jest | None |
| API E2E | `ndm-api-tests/tests/e2e/` | Go, Ginkgo | Live APIs |
| **UI E2E** | `ndm-ui-tests/tests/` | Go, Playwright | Live control plane + env config |

Requires reachable NDM URL, credentials, and (for storage flows) source host/worker configuration.

---

## Hard Scope Boundaries

- **Language:** Go only
- **Framework:** `testing` + `testify/require` + `playwright-community/playwright-go`
- **Allowed edits:** `ndm-ui-tests/tests/`, `pages/`, `fixtures/`, `config/`, `utils/`, `validators/`, `scripts/`
- **Forbidden:** Product/service source changes to force tests to pass
- **Naming:** `Test<Feature>_<Scenario>` in `*_test.go` files

---

## Project Layout

```
ndm-ui-tests/
├── config/config.go       ← env-driven URLs, credentials, timeouts
├── fixtures/              ← browser + auth (auth.go, browser.go)
├── pages/                 ← Page Object Model (*.page.go)
├── tests/                 ← test flows (*_test.go)
├── utils/                 ← validation utilities (report_validator, metadata validators, scanners)
├── validators/            ← static JSON specs for checksum validation
├── scripts/               ← shell/PowerShell scripts (nfs_metadata_compare.sh, smb_metadata_compare.sh, populate-smb-source.ps1)
├── cmd/get-secret/        ← CLI to fetch Keycloak client secret from CP
└── test-plan.yaml         ← controls which tests/suites run on the pipeline
```

**Page objects (current):** `login`, `file_server`, `discovery`, `migration`, `projects`, `user_management` — extend or add `pages/<feature>.page.go` for new screens.

---

## Flow Catalog

| Area | Test file | Examples |
|------|-----------|----------|
| **Discovery** | `tests/discovery_test.go` | NFS/SMB scan, bulk discover, exclude patterns, destination baseline, stopped job (no report), Isilon paths, consolidated/individual CSV reports |
| **Migration (NFS)** | `tests/migration_test.go` | Full Bulk Migrate NFS→NFS, CoC report download + validation, direct src↔dst comparison via nfs_metadata_compare.sh, static checksum verification |
| **Migration (SMB)** | `tests/migration_test.go` | Full Bulk Migrate SMB→SMB, CoC report validation, direct src↔dst comparison via PowerShell on Windows worker, static checksum verification |
| **Incremental Sync** | `tests/incremental_test.go` | Cron-based incremental sync, second job run wait |
| **User management** | `tests/user_management_test.go` | Create App Admin / Project Admin / Project Viewer; associate users to project with roles |
| **RBAC** | (extend via discovery + user flows) | Role boundaries — forbidden actions blocked, permitted actions succeed |
| **File servers** | via `pages/file_server.page.go` | Create NFS/SMB server, attach worker, wait for Active |
| **Projects** | via `pages/projects.page.go` | Create project, associate users |

---

## Post-Migration Validation Chain

After a migration job completes, the test performs 3 levels of validation:

### Step 13 — CoC Report vs Live Destination (sampled, 100 files)

Mounts the destination volume and validates a sample of files from the CoC CSV:
- **NFS:** size, UID, GID, Unix permissions, checksum (source vs dest in report)
- **SMB:** size, Owner SID, ACE details, checksum (source vs dest in report)
- **File count:** CSV file rows == destination file count

### Step 13b — Static Checksum Validation

Compares the CoC CSV against a pre-computed JSON spec (`validators/nfs_migration_checksums.json` or `validators/smb_migration_checksums.json`):
- Every file's `Destination Checksum` must match the known pre-computed hash
- `ChecksumMatchStatus` must be `yes`

Proves file content integrity — since source is static, checksums never change.

### Step 14 — Direct Source vs Destination (all files)

- **NFS:** Runs `nfs_metadata_compare.sh` locally with 8 parallel workers — compares uid, gid, permissions, size, mtime, atime for every file
- **SMB:** Runs `CompareSMBMetadata` via SSH to the Windows worker — compares type, size, mtime, owner, ACL for every file

Writes diff TSV to `test-results/downloads/` for artifact upload on failure.

### Coverage Summary

| Failure scenario | Caught by |
|---|---|
| File not copied | Step 14 (missing on dst) |
| File content corrupted | Step 13b (static checksum) |
| Metadata wrong (uid/gid/perms/owner/ACL) | Step 13 (sample) + Step 14 (all) |
| NDM reports wrong checksum | Step 13b (known hashes) |
| Report omits files | Step 13 (file count check) |
| Report shows wrong size | Step 13 (sample against live) |

---

## Utility Functions

| Function | File | What it does |
|----------|------|-------------|
| `ValidateReport` | `utils/report_validator.go` | Dispatcher — routes to NFS/SMB validator based on type + protocol |
| `ValidateNFSMigrationReport` | `utils/report_validator.go` | Mounts dst NFS, samples 100 files, checks size/uid/gid/perms/checksum + file count |
| `ValidateSMBMigrationReport` | `utils/report_validator.go` | SSHes to Windows worker, scans dst share, samples 100 files: size/owner/ACE/checksum + file count |
| `ValidateCoCStaticChecksums` | `utils/report_validator.go` | Validates CoC CSV checksums against pre-computed JSON spec |
| `CompareNFSViaScript` | `utils/nfs_script_validator.go` | Runs `nfs_metadata_compare.sh` locally, returns structured diffs |
| `CompareSMBMetadata` | `utils/smb_metadata_validator.go` | SSHes to Windows worker, runs PowerShell Get-ChildItem + Get-Acl, compares src vs dst |
| `CompareSMBMetadataWithEntries` | `utils/smb_metadata_validator.go` | Same as above but also returns raw entries for TSV dump |
| `CompareNFSMetadata` | `utils/nfs_metadata_validator.go` | Local Go-based NFS comparison (sequential, for small volumes) |
| `ScanSMBSharesRaw` | `utils/smb_metadata_validator.go` | Scans both shares, returns raw entries without comparing |
| `ClearNFSVolume` | `utils/volume_scanner.go` | Mounts NFS volume read-write and deletes all contents |

---

## Static Checksum Specs

Located in `validators/`:

| File | Purpose | How to generate |
|------|---------|----------------|
| `nfs_migration_checksums.json` | Known checksums for NFS source files | Extract from CoC ZIP: `unzip -p <coc.zip> \| awk ...` |
| `smb_migration_checksums.json` | Known checksums for SMB source files | Same extraction from SMB CoC ZIP |

Format:
```json
[
  {"Source Path": "/vol/Dir/file.txt", "Destination Checksum": "abc123...", "ChecksumMatchStatus": "yes"},
  ...
]
```

These files are committed to git. Since source volumes are static, checksums stay valid forever.

---

## Scripts

| Script | Location | Purpose |
|--------|----------|---------|
| `nfs_metadata_compare.sh` | `scripts/` | Parallel NFS src↔dst metadata comparison (uid/gid/perms/size/mtime/atime) |
| `smb_metadata_compare.sh` | `scripts/` | CIFS-based SMB src↔dst comparison (mtime/atime/ACL) — requires Linux with cifs-utils |
| `populate-smb-source.ps1` | `scripts/` | PowerShell script to populate an SMB share with ~21,000 test files |
| `run-ui-suite.sh` | `scripts/` | Reads test-plan.yaml and runs a test suite with parallel/timeout control |
| `generate-test-report.sh` | `scripts/` | Generates Teams notification JSON from test output |

---

## Environment Variables

Key vars (see `config/config.go` and `.env.example`):

| Variable | Purpose |
|----------|---------|
| `NDM_BASE_URL` | Control plane URL |
| `NDM_USERNAME` / `NDM_PASSWORD` | App admin login |
| `NDM_HEADLESS` | `false` to debug visually |
| `NDM_SLOWMO` | Slow motion (ms) for debugging |
| `NDM_CHROME_PATH` | System Chrome path (for VPN/proxy access) |
| `NDM_NFS_SOURCE_HOST` | NFS source server IP |
| `NDM_NFS_SOURCE_EXPORT_PATH` | NFS source export |
| `NDM_NFS_DESTINATION_HOST` | NFS destination server IP |
| `NDM_NFS_DESTINATION_EXPORT_PATH` | NFS destination export |
| `NDM_SMB_MIG_SOURCE_HOST` | SMB source host (FQDN) |
| `NDM_SMB_MIG_SOURCE_SHARE` | SMB source share name |
| `NDM_SMB_MIG_DEST_HOST` | SMB destination host (FQDN) |
| `NDM_SMB_MIG_DEST_SHARE` | SMB destination share name |
| `NDM_WORKER_HOST` | Linux worker IP (SSH) |
| `NDM_SMB_WORKER_HOST` | Windows worker IP (SSH) |
| `NDM_KEYCLOAK_CLIENT_SECRET` | Bypass OpenBao SSH for local dev |
| `NDM_MIGRATION_TIMEOUT_MS` | Max wait for migration (default 600000) |

---

## Running Tests

From `ndm-ui-tests/`:

```bash
# Install browsers (once)
go run github.com/playwright-community/playwright-go/cmd/playwright@latest install --with-deps chromium

# Run a specific test
go test ./tests/... -v -run TestMigration_BasicNFS -timeout 30m

# Run a suite via test-plan.yaml
bash scripts/run-ui-suite.sh migration

# Visible browser (local dev)
NDM_HEADLESS=false NDM_SLOWMO=500 go test ./tests/... -v -run TestMigration_BasicNFS -timeout 30m

# On pipeline (headless, triggered by run_ui_tests=true)
# Actions → Run E2E API Automation Tests → run_ui_tests=true
```

### Running on pipeline

1. Go to Actions → **Run E2E API Automation Tests for NDM on Azure**
2. Set `run_ui_tests` = **true**
3. Disable other test types to save time (`run_smoke_tests`/`run_e2e_tests`/`run_regression_tests` = false)
4. The `run-ui-tests` job runs all enabled suites from `test-plan.yaml`

### Test plan control

Edit `test-plan.yaml` to enable/disable tests:
```yaml
migration:
  enabled: true
  timeout: 60m
  tests:
    TestMigration_BasicNFS: true
    TestMigration_BasicSMB: true
```

Artifacts: `test-results/screenshots/`, `test-results/videos/`, `test-results/downloads/`.

---

## Definition of Done

- [ ] Tests in `ndm-ui-tests/tests/`; UI logic in `pages/`
- [ ] Existing coverage extended before new file (unless explicitly requested)
- [ ] Page Object Model — no raw selectors in test files
- [ ] Fresh resources where isolation is required
- [ ] Job lifecycle validated (READY → RUNNING → COMPLETED)
- [ ] Post-migration validation: CoC report + static checksums + direct src↔dst comparison
- [ ] Diff files written to `test-results/` on failure for artifact upload
- [ ] `t.Skipf` for missing optional env vars
- [ ] Screenshots at key steps
- [ ] `go build ./...` succeeds
- [ ] No product source code changed
