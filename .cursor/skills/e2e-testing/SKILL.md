---
name: ndm-e2e-testing
description: Write API end-to-end tests for NDM using Go, Ginkgo v2, and Gomega in ndm-api-tests. Use when the user asks for E2E tests, API regression tests, TC-* test cases, Ginkgo specs, worker/job validation against a live environment, support bundle or CoC/report checks, or SMB/NFS protocol coverage at the full-stack level. Enforces NDM E2E test data quality — files+dirs, file content+permissions, directory permissions — for migration/discovery storage scenarios.
---

# NDM API E2E Testing

## Overview

API E2E tests exercise NDM through real HTTP APIs against a deployed environment with workers, storage, and integration systems available. They live in `ndm-api-tests/` and complement in-process unit and component tests.

| Level | Location | Stack | Infra |
|-------|----------|-------|-------|
| Unit / component | `services/*/src/` | TypeScript, Jest | None |
| **API E2E** | `ndm-api-tests/tests/e2e/` | Go, Ginkgo, Gomega | Live NDM + workers + storage |
| UI E2E | `ndm-ui-tests/` | Go, Playwright | Live NDM control plane |

---

## Hard Scope Boundaries

- **Language:** Go only
- **Framework:** Ginkgo v2 + Gomega (see `.cursor/rules/go-tests.mdc` for review conventions)
- **Output location:** `ndm-api-tests/tests/e2e/`
- **Allowed edits:** E2E tests and utilities under `ndm-api-tests/`
- **Forbidden:** Product/service source changes to force tests to pass
- **Naming:** `TC-*_test.go` (e.g. `TC-001_test.go`, `TC-SMB-PERMISSIONS-001-004_test.go`)

Tests require a configured environment — not runnable without NDM dependencies.

---

## Before Writing

Confirm or infer:

- **Feature/scenario** under test
- **Protocol scope:** `SMB`, `NFS`, or both
- **Intent:** `enhance-existing` (default) or `create-new` (only when explicitly requested)
- **Expected outcomes:** file/directory counts, worker lifecycle states, reports, support bundles
- **Protocol constraints:** document real incompatibilities before `Skip(...)`

---

## Rules

1. **Search existing coverage first** — inspect `ndm-api-tests/tests/e2e` for similar `TC-*` files.
2. **Prefer extending** an existing test unless the user explicitly asks for a new file.
3. **Cover both protocols** when the scenario is protocol-agnostic (`SMB` and `NFS`).
4. **Validate file and directory counts** with explicit expected values (delta or final).
5. **Validate worker state** — health and lifecycle reach expected states.
6. **Include support bundle checks** where the scenario executes jobs that produce bundles.
7. **Include CoC/discovery report checks** where applicable.
8. **Deterministic assertions** — use `Eventually` with timeouts; avoid bare sleeps without polling.
9. **Clean up resources** — `DeferCleanup` for volumes/shares/jobs even on failure.
10. **Run with tracing** — `ginkgo -v --trace` for targeted runs; retain failure diagnostics.

### E2E test data quality (mandatory for migration / discovery storage scenarios)

Applies to API E2E only — **not** unit or component tests.

Every migration, cutover, or discovery E2E that copies or scans real storage must use **rich fixture data** and assert **all three dimensions**:

| Dimension | Requirement |
|-----------|-------------|
| **Files + directories** | Fixture includes **both**; job scope and asserts cover both |
| **File content + file permissions** | **Both** prepared on source and **both** validated on destination — never checksum-only or ACL-only when `preservePermissions: true` |
| **Directory permissions** | At least one directory (migrated root and/or nested) has explicit or verifiable ACL/mode asserted post-job |

**Assertion pairing:**

- **Content:** `ValidateReport`, checksum in validator JSON, `CompareNFS*`, file hash helpers
- **File permissions:** `GetSMB*` / `CompareSMB*`, NFS uid/gid/mode compare, CoC permission columns
- **Directory permissions:** recursive dir ACL helpers, inheritance validation on migrated tree

**Do not split** content validation into one spec and permission validation into another for the same topology unless each spec still satisfies all three dimensions — split specs that each cover only half are incomplete.

**Approved exceptions** (document in test comment):

- `preservePermissions: false` — content asserts only
- Pure API negatives (HTTP 400) with no job run
- Discovery-only where stamping is out of scope

---

## Test Structure

Suite entry: `ndm-api-tests/tests/e2e/e2e_suite_test.go`

```go
package tests

import (
    . "ndm-api-tests/utils"
    . "github.com/onsi/ginkgo/v2"
    . "github.com/onsi/gomega"
)

var _ = Describe("TC-NNN: <scenario title>", func() {
    Context("TC-NNN", func() {
        BeforeEach(func() {
            // setup: global env, volumes, headers
        })

        It("TC-NNN: <behavior description>", func() {
            By("step description for reports")
            // API calls + Expect assertions
        })
    })
})
```

**Patterns from existing tests:**

- Global project/workers from `InitTestEnv()` / `GetGlobalTestEnv()` in suite setup
- Per-test volume cloning via `SetupTestVolumesBeforeEach()` + `DeferCleanup(CleanupTestVolumesAfterEach)`
- `By("...")` for readable Ginkgo step output
- `Skip(...)` only when setup prerequisites fail (e.g. volume clone unavailable)
- Unique resource names with `uuid` suffixes to avoid parallel collisions

---

## Workflow

1. **Coverage discovery** — search `tests/e2e`; read reusable helpers in `ndm-api-tests/utils/`.
2. **Path decision** — extend existing `TC-*` or add new file (explicit request only).
3. **Design scenario matrix** — SMB/NFS variants; document justified skips.
4. **Design fixture data** — files **and** directories; file content **and** file permissions; directory permissions (see E2E test data quality above).
5. **Implement assertions:**
   - Job create + execution success
   - Worker status/health
   - File and directory count validations
   - File content integrity (checksum / `ValidateReport`)
   - File permissions when `preservePermissions: true`
   - Directory permissions on migrated tree
   - Support bundle generation/readiness
   - CoC/discovery report generation and content
6. **Run targeted tests** with verbose trace.
7. **Verify** no product source changes.

---

## Reusable Utilities (prefer first)

| Area | Path |
|------|------|
| Worker state, env setup | `ndm-api-tests/utils/worker.go`, `setup.go` |
| Job counts and validation | `ndm-api-tests/utils/jobs.go` |
| Support bundle flows | `ndm-api-tests/utils/support_bundle_utils.go` |
| Report validation | `ndm-api-tests/utils/report_validator.go` |

---

## Reference Implementations

| File | Focus |
|------|-------|
| `ndm-api-tests/tests/e2e/TC-001_test.go` | File server, discovery, scheduled migration, volume cloning |
| `ndm-api-tests/tests/e2e/TC-SUPPORT-BUNDLE_test.go` | Support bundle generation |
| `ndm-api-tests/tests/e2e/TC-SMB-PERMISSIONS-001-004_test.go` | SMB permission scenarios |
| `ndm-api-tests/tests/e2e/e2e_suite_test.go` | Suite flags (`protocol_type`, `environment`), parallel setup |

Read the closest existing `TC-*` file before adding or extending coverage.

---

## Running Tests

From `ndm-api-tests/`:

```bash
# Full e2e suite (verbose)
go test -v -count=1 ./tests/e2e/...

# Ginkgo directly (preferred for debugging)
cd tests/e2e
ginkgo -v --trace

# Target a specific spec
ginkgo -v --trace --focus="TC-001"
```

Suite flags (see `e2e_suite_test.go`): `-protocol_type` (`SMB` / `NFS`), `-environment` (`vSphere` / `Azure` / `GCP`).

---

## Definition of Done

- [ ] Code under `ndm-api-tests/tests/e2e/` in `TC-*_test.go` style
- [ ] Existing similar coverage reused or extended before creating new file
- [ ] New file only when explicitly requested
- [ ] **Files and directories** both in fixture and migration scope
- [ ] **File content** validated (checksum / `ValidateReport` / direct compare)
- [ ] **File permissions** validated when `preservePermissions: true`
- [ ] **Directory permissions** validated on at least one directory
- [ ] Content and permission asserts paired in same spec (or documented exception)
- [ ] File/directory count validations present where applicable
- [ ] Worker-state assertions present where applicable
- [ ] Support bundle and CoC/report checks included where applicable
- [ ] Deterministic async checks (`Eventually`, not flaky timing)
- [ ] Targeted `ginkgo -v --trace` run passes or failure diagnostics captured
- [ ] No product source code changed
