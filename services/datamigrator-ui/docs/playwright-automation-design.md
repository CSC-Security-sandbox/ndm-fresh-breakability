# Design Proposal: Playwright E2E Test Automation for NDM UI

By Jeevitha Venkatesh
April 2026

---

| Field | Value |
|---|---|
| Author | @Jeevitha Venkatesh |
| Reviewers | _(To be filled)_ |
| PM | _(To be filled)_ |
| Last Updated | 20.04.2026 |
| Ticket | NDM-2309 |
| Status | **Proposed** |

---

## 1. Requirements

The NDM Data Migrator UI currently has **no automated UI test coverage**. The only quality gates are ESLint linting and TypeScript type checking. Several production bugs — including empty report fields, `undefined` chart labels, and blank pages — have reached users that automated tests would have caught.

This proposal introduces **Playwright** as the E2E testing framework for the NDM UI. The initial scope is **local test execution only** — developers would run tests on their machines against a local dev server or a deployed Control Plane. CI/CD integration (GitHub Actions, PR gates, nightly regression) is a future consideration and is **out of scope** for this proposal.

The framework must:

- Work with the existing React 18 / Vite / TypeScript / RTK Query stack.
- Handle Keycloak OIDC authentication without manual intervention.
- Support two modes: **mocked APIs** (no backend needed) and **live** (against a running CP).
- Cover navigation, core workflows (File Servers, Discovery, Migration, Cutover), report rendering, role-based access, and known regression scenarios.

---

## 2. Success Criteria

- Developers can run the full E2E suite locally with a single command.
- Tests can run in **mocked mode** (no backend required) for fast, isolated feedback.
- Tests can run in **live mode** against a deployed Control Plane for integration validation.
- All critical user journeys (listed in the Coverage Matrix below) have at least one automated test.
- Known historical bugs are covered by regression tests.
- The full mocked suite completes in under 5 minutes locally.

---

## 3. Current State

### 3.1 Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | React | 18.x |
| Build Tool | Vite | 6.4 |
| Language | TypeScript | 5.7 |
| State Management | Redux Toolkit + RTK Query | 2.6 |
| Routing | react-router-dom | 7.5 |
| Authentication | Keycloak OIDC via react-oidc-context | 3.2 |
| UI Libraries | MUI v7, NetApp BXP Design System, Tailwind CSS | — |
| Forms | Formik + Yup | — |
| Charts | Canvas-based custom components | — |

### 3.2 Testing Gaps

| Area | Current Coverage | Risk |
|---|---|---|
| Unit tests | None | High |
| Integration tests (API + UI) | None | High |
| E2E tests | None | Critical |
| Visual regression | None | Medium |

### 3.3 Bugs That Would Have Been Caught

| Bug | Root Cause | How E2E Tests Would Catch It |
|---|---|---|
| Empty "File Server" field on discovery preview | Backend emits `sub_category: "Server Profile"` but UI expects `"Config Name"` | Assert field is non-empty |
| "800undefined" on chart Y-axis | `formatLargeNumber` computed negative array index for values < 1 | Assert no `undefined` text on page |
| Blank white page for small discovery reports | JS runtime error crashes React tree | Assert page renders without error boundary |

---

## 4. Why Playwright

| Criteria | Playwright | Cypress | Selenium |
|---|---|---|---|
| Multi-browser | Chromium, Firefox, WebKit built-in | Chrome/Firefox only | Requires separate drivers |
| Keycloak auth reuse | Native storageState | Manual cookie injection | Manual |
| API mocking | Built-in route interception | cy.intercept | No native support |
| Parallel execution | Built-in | Paid feature | Requires Grid |
| TypeScript | First-class | First-class | Limited |
| Debug tooling | Trace viewer, UI mode, codegen | Time-travel debug | Screenshots only |
| Test generation | Record interactions with codegen | Limited (Cypress Studio) | Selenium IDE |

**Recommendation:** Playwright is the best fit because:
- Built-in route interception lets us mock all 5 backend services without running them.
- Native storageState makes Keycloak OIDC session reuse trivial.
- The codegen tool (`npx playwright codegen <url>`) can record interactions against a live CP to scaffold tests quickly — developer opens a browser, interacts with the app, and gets test code generated automatically.

---

## 5. Key Challenges

- **Keycloak OIDC authentication.** The AuthGuard component redirects unauthenticated users to Keycloak and renders multiple loading states before the app shell appears. Tests must either bypass this entirely (mock mode) or automate the login flow (live mode).

- **Five backend services to mock.** The UI calls admin-service, config-service, jobs-service, reports-service, and workers endpoints via RTK Query. Every page load triggers at minimum the permissions, accounts, projects, and ASUP settings APIs. All must be intercepted for mocked tests to work.

- **Canvas-based charts.** Discovery preview and dashboard charts render on HTML canvas, making their content invisible to DOM queries. We cannot assert on chart data directly — only on surrounding labels, legends, and visual regression screenshots.

- **No `data-testid` attributes.** Components currently lack test-specific attributes. Selectors must rely on roles, text content, and CSS until test IDs are added incrementally.

- **Lazy-loaded pages.** All routes use React.lazy, so tests must account for code-splitting load times.

---

## 6. Proposed Approach

### 6.1 How Tests Would Be Run

All test execution would be **local** — developers run tests from their machine:

| Command | What It Does |
|---|---|
| `npm run test:e2e` | Run all tests headless (default, mocked APIs) |
| `npm run test:e2e:ui` | Open Playwright UI mode — interactive test runner with time-travel debug |
| `npm run test:e2e:headed` | Run tests with a visible browser |
| `npm run test:e2e:debug` | Step through tests with the Playwright inspector |
| `npm run test:e2e:codegen` | Open the codegen recorder to generate test code by interacting with the app |

For **mocked mode**, the Vite dev server would start automatically via the Playwright config. No backend services would need to be running.

For **live mode**, the developer would point tests at a running CP by setting environment variables:

| Variable | Purpose | Example |
|---|---|---|
| `BASE_URL` | Target app URL (defaults to `http://localhost:3111`) | `https://172.30.205.240` |
| `NDM_TEST_USER` | Keycloak username for live mode | `admin` |
| `NDM_TEST_PASSWORD` | Keycloak password for live mode | `admin123` |

### 6.2 Dual-Mode Authentication

We propose supporting two authentication strategies:

| Mode | When | How |
|---|---|---|
| Mock Auth (default) | Local development with mocked APIs | Inject a fake OIDC session into sessionStorage, intercept all Keycloak discovery and token endpoints via route interception, mock the permissions/accounts/projects APIs |
| Live Auth | Running against a deployed CP | A setup step would navigate to the Keycloak login form, fill credentials from environment variables, and save the browser state to a JSON file. All subsequent tests would reuse this saved state. |

### 6.3 API Mocking Strategy

The UI consumes 12 RTK Query API modules across 5 backend services. We propose organizing mocks in two layers:

**Layer 1 — Bootstrap mocks** (needed for every test): Keycloak OIDC endpoints, user permissions, accounts, projects, ASUP settings, and overview. These are called by AuthGuard and the Layout component on every page load.

**Layer 2 — Feature mocks** (per spec file): File server list, job configs, job runs, report data, workers, etc. Each test file would call only the mock functions it needs.

Mock response data would be stored as static JSON fixtures organized by backend service (admin, config, jobs, reports, workers).

### 6.4 Backend Services That Would Need Mocking

| RTK Query Module | Backend Service | Key Endpoints to Mock |
|---|---|---|
| permissionApi | admin-service | GET /user-permissions |
| accountApi | admin-service | GET /accounts |
| projectApi | admin-service | GET /projects/accounts/*/projects |
| usersApi | admin-service | GET /users, POST /users |
| upgradeApi | admin-service | GET /upgrade/status |
| aboutApi | admin-service | GET /about-ndm |
| configApi | config-service | GET/POST /servers, GET /servers/:id |
| workerManagerApi | config-service | POST /work-manager/validate-connection |
| jobsApi | jobs-service | GET /jobs, GET /job-run, POST /jobs/bulk-discover |
| workersApi | jobs-service | GET /workers |
| reportApi | reports-service | GET /overview, GET /inventory/*, GET /report/data |
| asupApi | reports-service | GET /asup/settings |

### 6.5 Page Object Model

Each page in the app would have a corresponding Page Object class that encapsulates selectors and actions. This pattern:
- Isolates selectors to one file per page — when the UI changes, only the page object needs updating
- Keeps test files focused on behavior, not DOM structure
- Makes tests resilient to refactoring

We would create page objects for all major pages:

| Page Object | UI Module | Route(s) |
|---|---|---|
| Home | modules/home | `/`, `/home` |
| File Server List | modules/storage-servers | `/file-server` |
| File Server Overview | modules/storage-servers | `/file-server/:id` |
| Create File Server | modules/storage-servers | `/new-file-server` |
| Jobs List | modules/jobs/jobs-list | `/jobs-list` |
| Job Details | modules/jobs | `/job-details/:jobId` |
| Job Run Details | modules/jobs | `/job-details/:jobId/run/:runId` |
| Discovery Preview | modules/jobs/discovery-preview | `/job-discovery-preview/:runId` |
| Bulk Discover | modules/storage-servers/bulk-discover | `/file-server/:id/bulk-discover` |
| Bulk Migrate | modules/storage-servers/bulk-migrate | `/file-server/:id/bulk-migrate` |
| Bulk Cutover | modules/storage-servers/bulk-cutover | `/file-server/:id/bulk-cutover` |
| Workers | direct page | `/workers` |
| Settings | src/components/setting | Drawer (not a route) |

### 6.6 Selector Strategy

A "selector" is how a test finds an element on the page. Choosing the wrong selector means tests break when someone changes a CSS class or rearranges the HTML, even though the feature still works fine.

Our components currently lack `data-testid` attributes, so we use a priority order — try the top option first, fall through to the next if it doesn't work:

**Priority 1 — Role-based selectors** (best, most stable)

Ask for an element by what it *is* (button, heading, link), not how it looks.

```typescript
// Find the heading that says "Home" — ignores the sidebar's "Home" text
page.getByRole("heading", { name: "Home" })

// Find the button labeled "Add File Server"
page.getByRole("button", { name: "Add File Server" })
```

Survives CSS changes, component library upgrades, HTML restructuring. Only breaks if the element's role or label actually changes.

**Priority 2 — Visible text content** (good, but can be ambiguous)

Search for the text the user sees on screen.

```typescript
page.getByText("Notice Board")
page.getByText("File Servers")
```

Works well when the text is unique on the page. Fails when the same text appears in multiple places (e.g. "Jobs" appears in sidebar, chart header, and chart labels — this happened in our Home page tests).

**Priority 3 — Placeholder text** (for form inputs)

```typescript
page.getByPlaceholder("Enter server name")
page.getByPlaceholder("Search")
```

Useful for input fields where there's no visible label.

**Priority 4 — `data-testid` attributes** (reliable, requires a small code change)

When options 1–3 don't work cleanly, we add a `data-testid` attribute to the component. This is a one-line code change with zero visual impact:

```html
<!-- Before -->
<div class="chart-section">Jobs</div>

<!-- After — no UI change, just an anchor for tests -->
<div class="chart-section" data-testid="jobs-chart">Jobs</div>
```

Then the test uses:

```typescript
page.getByTestId("jobs-chart")    // always finds exactly one element
```

We would add `data-testid` attributes incrementally in three phases, starting with the most-tested components:

| Phase | Components | Why first |
|-------|-----------|-----------|
| Phase 1 | Tables, buttons, nav items | Most commonly tested, most ambiguous selectors |
| Phase 2 | Form inputs, wizard steps | Job creation and file server config workflows |
| Phase 3 | Chart containers, modals | Hardest to target (canvas elements, overlays) |

**Priority 5 — CSS class selectors** (last resort, most fragile)

```typescript
page.locator(".p-6")       // Tailwind padding class — could change anytime
page.locator(".text-sm")   // font size class — breaks on any style tweak
```

CSS classes describe *how things look*, not *what things are*. A developer changing `p-6` to `p-8` for spacing breaks the test even though the feature is identical. Only use this when nothing else works.

### 6.7 Chart Testing Strategy

Since canvas elements are not DOM-queryable, we would use complementary strategies:

| Strategy | Use Case |
|---|---|
| Assert chart container is visible | Basic rendering check |
| Assert legend/toggle text around the chart | Functional check |
| Assert no `undefined` text on the page | Known bug regression |
| Screenshot comparison (visual regression) | Pixel-level check (future scope) |

---

## 7. Route Map and Test Priorities

All routes from the UI's RouteConfig.tsx, with proposed test priorities:

| Route | Page | Protected | Permission | Priority |
|---|---|---|---|---|
| `/`, `/home` | Home | No | — | P0 |
| `/file-server` | File Server List | No | — | P0 |
| `/file-server/:id` | File Server Overview | No | — | P0 |
| `/new-file-server` | Create File Server | Yes | ManageConfig | P1 |
| `/edit-file-server/:id` | Edit File Server | Yes | ManageConfig | P1 |
| `/file-server/:id/bulk-discover` | Bulk Discovery | Yes | ManageJob | P1 |
| `/file-server/:id/bulk-migrate` | Bulk Migration | Yes | ManageJob | P1 |
| `/file-server/:id/bulk-cutover` | Bulk Cutover | Yes | ManageJob | P2 |
| `/workers` | Workers | No | — | P1 |
| `/jobs-list` | Job Config List | No | — | P0 |
| `/job-details/:jobId` | Job Details | No | — | P0 |
| `/job-details/:jobId/run/:runId` | Job Run Details | No | — | P0 |
| `/job-details/:jobId/run/:runId/tasks` | Job Tasks | No | — | P1 |
| `/job-details/:jobId/run/:runId/errors` | Job Task Errors | No | — | P1 |
| `/job-details/:jobId/run/:runId/migration-activity` | Migration Activity | No | — | P2 |
| `/jobs-run-list` | Job Run List | No | — | P1 |
| `/job-discovery-preview/:runId` | Discovery Preview | No | — | P0 |
| `/speed-test/config` | Speed Test Config | Yes | ManageJob | P2 |
| `/speed-test/:runId` | Speed Test Details | No | — | P2 |
| `/no-access` | 403 Page | No | — | P1 |
| `/*` | 404 Page | No | — | P1 |

---

## 8. Proposed Test Coverage

### Layer 1 — Smoke Tests

Ensure the app loads and every page renders without crashing.

| ID | Test | What It Validates |
|---|---|---|
| SM-01 | App loads after authentication | AuthGuard completes, sidebar visible |
| SM-02 | Home page renders | Dashboard charts and notice board sections appear |
| SM-03 | File Server list renders | Table element appears |
| SM-04 | Jobs list renders | Table element appears |
| SM-05 | Job run list renders | Table element appears |
| SM-06 | Workers page renders | Page content appears |
| SM-07 | Discovery preview renders | Report header fields appear |
| SM-08 | Unknown route shows 404 | "Not Found" text visible |
| SM-09 | No-access route shows 403 | Access denied content visible |

### Layer 2 — Functional Tests (per feature)

| Area | Tests | What They Validate |
|---|---|---|
| Home / Dashboard | Sidebar nav to Storage Servers, Jobs, Workers; chart sections display | Navigation and dashboard rendering |
| File Servers | Table loads with data; row click navigates to overview; search filters; overview shows export paths tab; "Add" button visible for admin | File server list and overview workflows |
| File Server CRUD | Create wizard steps (server type, credentials, validate connection); edit flow | Server management workflow |
| Jobs | Config table loads; row click navigates to details; details header shows job info; run list shows runs; run click navigates to run details; tasks and errors pages render | Full job lifecycle navigation |
| Discovery Preview | Header shows File Server/Path/Protocol (non-empty); overview metrics display; no `undefined` text; chart sections render; toggle between views; CSV and PDF download | Report rendering and known bug regressions |
| Bulk Operations | Bulk discover page loads; migrate wizard steps (Mapping, Options, Review); cutover page loads | Bulk workflow rendering |
| Workers | Table loads; status indicators display | Worker management |

### Layer 3 — Role-Based Access Tests

| ID | Test | What It Validates |
|---|---|---|
| PERM-01 | User without ManageConfig accessing /new-file-server | Redirected to /no-access |
| PERM-02 | User without ManageJob accessing bulk-discover | Redirected to /no-access |
| PERM-03 | Admin user accessing all protected routes | Pages render normally |
| PERM-04 | Viewer role on home page | "Add File Server" button hidden |

---

## 9. Proposed Directory Structure

All items below would be newly created as part of this effort:

| Directory / File | Purpose |
|---|---|
| `e2e/helpers/mock-auth.ts` | Keycloak OIDC session injection + bootstrap API mocks |
| `e2e/helpers/mock-apis.ts` | Per-feature API mocks (file servers, jobs, reports, workers) |
| `e2e/helpers/test-data.ts` | Shared constants (mock IDs, names, URLs) |
| `e2e/helpers/wait-helpers.ts` | Structured waits for AuthGuard, table loads, etc. |
| `e2e/mocks/admin/*.json` | Static fixtures for permissions, accounts, projects |
| `e2e/mocks/config/*.json` | Static fixtures for file servers, export paths |
| `e2e/mocks/jobs/*.json` | Static fixtures for job configs, runs, tasks |
| `e2e/mocks/reports/*.json` | Static fixtures for overview, discovery data, ASUP |
| `e2e/mocks/workers/*.json` | Static fixtures for worker list |
| `e2e/pages/*.page.ts` | Page Object Models (13 files, one per major page) |
| `e2e/fixtures/base.fixture.ts` | Custom Playwright fixtures |
| `e2e/auth.setup.ts` | One-time Keycloak login for live mode |
| `e2e/smoke.spec.ts` | All pages render without crash |
| `e2e/home.spec.ts` | Home page and navigation tests |
| `e2e/*.spec.ts` (10 more) | Feature-specific test suites (file-server, jobs-list, job-details, etc.) |
| `playwright.config.ts` | Playwright test runner configuration |

---

## 10. What Would Change in the Existing Codebase

| File / Area | What Would Change | Why |
|---|---|---|
| `package.json` | Add `@playwright/test` to devDependencies | Playwright needs to be installed at the service level |
| `package.json` | Add new npm scripts (`test:e2e:debug`, `test:e2e:report`, `test:e2e:codegen`) | Convenience commands for developers |
| `playwright.config.ts` | New file — test directory, browser projects, webServer config, timeouts, baseURL from env | Central Playwright configuration |
| `.gitignore` | Add entries for `e2e/.auth/`, `test-results/`, `playwright-report/`, `playwright/.cache/` | Exclude generated artifacts from version control |
| UI components (incremental) | Add `data-testid` attributes to key elements | More resilient selectors for tests |

---

## 11. Implementation Plan

### Phase 1 — Foundation (Week 1–2)

| Task | Effort | Deliverable |
|---|---|---|
| Install Playwright, configure `playwright.config.ts` | 0.5d | Working config with Chromium, webServer, baseURL |
| Install browser binaries (`npx playwright install`) | — | Chromium/Firefox/WebKit available locally |
| Implement mock-auth helper (Keycloak OIDC session injection + bootstrap API mocks) | 1d | Mock auth module |
| Implement auth.setup.ts for live mode (Keycloak login + storageState save) | 0.5d | Live auth setup |
| Create JSON fixtures for all bootstrap APIs (permissions, accounts, projects, overview, ASUP) | 0.5d | Mock data layer |
| Create wait-helpers and test-data modules | 0.5d | Shared helpers |
| Write smoke tests — every route renders without crash | 1d | 9 smoke tests |

### Phase 2 — Core Flows (Week 3–4)

| Task | Effort | Deliverable |
|---|---|---|
| Create page objects for Home, File Server, Jobs List, Discovery Preview, File Server Overview | 2d | 5 page objects |
| Home tests — dashboard charts, sidebar navigation | 0.5d | 5 tests |
| File server tests — list, search, overview navigation | 1d | 4 tests |
| Jobs tests — table, search, detail navigation | 1d | 4 tests |
| Job details + run details tests — detail views, run navigation, tasks, errors | 1.5d | 8 tests |
| Discovery preview tests — header, metrics, charts, download, `undefined` regression | 1.5d | 7 tests |
| Workers tests — table, status display | 0.5d | 2 tests |
| Add data-testid attributes to key components (tables, primary buttons, sidebar) | 1d | Tagged components |

### Phase 3 — Advanced (Week 5–6)

| Task | Effort | Deliverable |
|---|---|---|
| Permissions tests — protected route enforcement, PermissionAuth element hiding | 1.5d | 4 tests |
| File server CRUD tests — create wizard, edit, validate connection | 2d | 8 tests |
| Bulk operations tests — discover, migrate wizard, cutover | 2d | 5 tests |
| Error handling tests — 404, 403, API error states, error boundary | 1d | 4 tests |

---

## 12. Effort Summary

| Phase | Scope | Effort | Tests |
|---|---|---|---|
| Phase 1: Foundation | Setup, config, mocks, smoke tests | 4 days | ~9 |
| Phase 2: Core Flows | Home, File Servers, Jobs, Discovery, Workers | 8.5 days | ~30 |
| Phase 3: Advanced | Permissions, CRUD, Bulk Ops, Error handling | 6.5 days | ~21 |
| **Total** | | **~19 days (~4 weeks)** | **~60 tests** |

**Future scope** (not included in this estimate): CI/CD integration (GitHub Actions PR gate, nightly regression against staging, Slack notifications, sharding), visual regression testing.

---

## 13. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Keycloak token expiry during test runs against live CP | Tests fail mid-suite | Medium | Mock auth avoids this; for live mode, configure Keycloak session timeout > suite duration |
| Flaky tests due to timing | Erodes developer trust in the suite | High | Structured wait helpers, 15s timeouts for lazy-loaded content, retries configurable |
| No data-testid attributes | Brittle selectors tied to text/CSS | High | Incremental data-testid adoption; prefer role-based and text selectors meanwhile |
| Canvas charts not DOM-queryable | Cannot assert chart data content | Medium | Surrounding label/toggle assertions + `undefined` regex checks |
| Mock maintenance burden | Mocks drift from real API contracts over time | Medium | Typed mock factories matching backend DTOs; periodic validation against live CP |

---

## 14. Decision Points for Discussion

| # | Question | Options | Recommendation |
|---|---|---|---|
| 1 | Start Chromium-only or multi-browser? | A: Chromium only / B: Chromium + Firefox from day 1 | A: Chromium only initially; add Firefox once suite is stable |
| 2 | Add data-testid incrementally or all at once? | A: Incremental / B: Big-bang | A: Incremental — lower risk, reviewable in small PRs |
| 3 | Dedicated Keycloak test user or shared? | A: Dedicated / B: Shared admin | A: Dedicated — avoids polluting real user data |
| 4 | Playwright dependency at service level or repo root? | A: Service-level / B: Both | A: Service-level — keeps it scoped to datamigrator-ui |
| 5 | When to introduce CI/CD integration? | A: After Phase 3 / B: In parallel with Phase 2 | A: After Phase 3 — stabilize the suite locally first |
