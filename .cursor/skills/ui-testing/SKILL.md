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
- **Allowed edits:** `ndm-ui-tests/tests/`, `pages/`, `fixtures/`, `config/`
- **Forbidden:** Product/service source changes to force tests to pass
- **Naming:** `Test<Feature>_<Scenario>` in `*_test.go` files

---

## Project Layout

```
ndm-ui-tests/
├── config/config.go       ← env-driven URLs, credentials, timeouts
├── fixtures/              ← browser + auth (auth.go, browser.go)
├── pages/                 ← Page Object Model (*.page.go)
└── tests/                 ← test flows (*_test.go)
```

**Page objects (current):** `login`, `file_server`, `discovery`, `projects`, `user_management` — extend or add `pages/<feature>.page.go` for new screens.

---

## Flow Catalog

Use this to pick existing tests to extend or identify gaps.

| Area | Test file | Examples |
|------|-----------|----------|
| **Discovery** | `tests/discovery_test.go` | NFS/SMB scan, bulk discover, exclude patterns, destination baseline, stopped job (no report), Isilon paths, consolidated/individual CSV reports |
| **User management** | `tests/user_management_test.go` | Create App Admin / Project Admin / Project Viewer; associate users to project with roles |
| **RBAC** | (extend via discovery + user flows) | Role boundaries — forbidden actions blocked, permitted actions succeed |
| **File servers** | via `pages/file_server.page.go` | Create NFS/SMB server, attach worker, wait for Active |
| **Projects** | via `pages/projects.page.go` | Create project, associate users |

Discovery tests use **fresh file servers per test** (timestamped names) to avoid stale errored runs.

---

## Before Writing

Confirm or infer:

- **Feature/scenario** (see flow catalog)
- **Protocol scope:** SMB, NFS, or both
- **Intent:** `enhance-existing` (default) or `create-new` (explicit request only)
- **UI steps:** pages, wizards, modals involved
- **Expected outcomes:** job status, resource state, reports, RBAC, errors
- **Env prerequisites:** which `NDM_*` / config vars must be set

---

## Rules

1. **Inspect existing tests** under `ndm-ui-tests/tests/` first.
2. **Prefer extending** existing files unless a new file is explicitly requested.
3. **Page Object Model** — all selectors and UI actions live in `pages/*.page.go`; tests call page methods only.
4. **API polling for job status** — do not rely on UI table row counts for lifecycle checks.
5. **Fresh resources per test** — new file servers/projects where isolation matters.
6. **Wait for readiness** — e.g. file server Active before Bulk Discover.
7. **Cover SMB and NFS** when protocol-agnostic.
8. **Validate job lifecycle** — READY → RUNNING → COMPLETED (or PAUSED, STOPPED, ERRORED).
9. **Validate reports** — discovery, CoC, error CSVs after completion where applicable.
10. **RBAC** — verify restricted roles cannot perform unauthorized actions.
11. **Skip gracefully** — `t.Skipf` with clear message when env vars missing (`requireEnv` pattern).
12. **Screenshots** at key steps for debugging.
13. **No hardcoded secrets or hosts** — use `config` / env vars only.
14. **Deterministic waits** — Playwright `Expect`/`WaitFor` with timeouts; avoid arbitrary long sleeps.
15. **Retain diagnostics** — screenshots/videos on failure (Playwright trace config).

---

## Test Structure

```go
package tests

import (
    "testing"
    "ndm-ui-tests/config"
    "ndm-ui-tests/fixtures"
    "ndm-ui-tests/pages"
    "github.com/stretchr/testify/require"
)

func requireEnv(t *testing.T, value, name string) {
    t.Helper()
    if value == "" {
        t.Skipf("skipping: %s is not set", name)
    }
}

func TestDiscovery_BasicNFS(t *testing.T) {
    f := fixtures.NewAdminFixture(t)
    defer f.Close()

    requireEnv(t, config.SourceHost, "NDM_SOURCE_HOST")
    dp := pages.NewDiscoveryPage(f.Page)
    // interact via page objects only
    require.NoError(t, err)
}
```

**Patterns from `discovery_test.go`:**

- Package-level comment documents test index (5.1, 5.2, …)
- `fixtures.NewAdminFixture(t)` for login + browser lifecycle
- `createFreshFileServer` helper — unique name, worker attach, wait for Active
- `lastDiscoveredFSID` shared only when a later test depends on a prior run in the same suite

---

## Page Object Guidelines

- One file per major screen: `pages/<feature>.page.go`
- Selectors: `GetByRole`, `GetByText`, `GetByPlaceholder`, `Locator` — avoid brittle CSS chains in tests
- Methods name user actions: `CreateNFSFileServer`, `SubmitBulkDiscover`, `WaitForJobCompleted`
- Import shared config from `ndm-ui-tests/config`

When adding a new screen, create the page object before writing the test.

---

## Workflow

1. **Coverage discovery** — search `tests/`; read `pages/` and `config/config.go`.
2. **Path decision** — extend existing test or new `*_test.go` (explicit request only).
3. **Page objects** — add/extend methods for new UI interactions.
4. **Scenario matrix** — NFS/SMB; `t.Skipf` only for real incompatibility or missing env.
5. **Assertions** — resource CRUD, job lifecycle (API poll), reports, RBAC, negative cases.
6. **Run** — `go test` with verbose output; fix compile errors (`go build ./...`).
7. **No product source changes.**

---

## Reusable Components

| Area | Path |
|------|------|
| Auth + browser | `ndm-ui-tests/fixtures/auth.go`, `browser.go` |
| Config | `ndm-ui-tests/config/config.go` |
| Page objects | `ndm-ui-tests/pages/*.page.go` |
| Helpers in tests | patterns in `tests/discovery_test.go`, `tests/user_management_test.go` |

---

## Environment Variables

Key vars (see `config/config.go` and `ndm-ui-tests/README.md`):

| Variable | Purpose |
|----------|---------|
| `NDM_BASE_URL` | Control plane URL |
| `NDM_USERNAME` / `NDM_PASSWORD` | App admin login |
| `NDM_SOURCE_HOST` | Storage host for file server creation |
| `NDM_HEADLESS` | `false` to debug visually |
| `NDM_SLOWMO` | Slow motion (ms) for debugging |
| `NDM_TIMEOUT` | Default element timeout (ms) |

Role-specific emails/passwords for RBAC tests are also config-driven.

---

## Running Tests

From `ndm-ui-tests/`:

```bash
# Install browsers (once)
go run github.com/playwright-community/playwright-go/cmd/playwright@latest install --with-deps chromium

# All tests
go test ./tests/... -v

# Single test
go test ./tests/... -v -run TestDiscovery_BasicNFS

# Visible browser
NDM_HEADLESS=false NDM_SLOWMO=500 go test ./tests/... -v -run TestDiscovery_BasicNFS

# Compile check
go build ./...
```

Artifacts: `test-results/screenshots/`, `test-results/videos/`.

---

## Definition of Done

- [ ] Tests in `ndm-ui-tests/tests/`; UI logic in `pages/`
- [ ] Existing coverage extended before new file (unless explicitly requested)
- [ ] Page Object Model — no raw selectors in test files
- [ ] API-based job status polling (not UI table counting)
- [ ] Fresh resources where isolation is required
- [ ] Job lifecycle, counts, reports, RBAC asserted as applicable
- [ ] `t.Skipf` for missing optional env vars
- [ ] Screenshots at key steps
- [ ] `go build ./...` succeeds; targeted `go test` run passes or diagnostics captured
- [ ] No product source code changed
