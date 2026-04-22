# Design Proposal: Playwright E2E Testing for NDM UI

**Author:** Jeevitha  
**Date:** April 2026  
**Status:** Proposed  
**Component:** `datamigrator-ui`

---

## 1. Executive Summary

The NDM Data Migrator UI currently has **zero automated UI tests**. There are no unit tests, no integration tests, and no end-to-end tests for the React frontend. The only quality gates are ESLint linting and TypeScript type checking (`tsc --noEmit`).

This proposal introduces **Playwright** as the E2E testing framework for the NDM UI. Playwright enables browser-based testing against the real application, covering authentication flows, page rendering, API integration, navigation, and visual regression — catching bugs like the recent "empty File Server field" and "undefined chart labels" issues before they reach production.

### Why Playwright over alternatives?

| Criteria | Playwright | Cypress | Selenium |
|---|---|---|---|
| Multi-browser (Chromium, Firefox, WebKit) | Yes (built-in) | Partial (Chrome/Firefox only) | Yes (requires drivers) |
| Auth state reuse (Keycloak OIDC) | Native `storageState` | Manual cookie injection | Manual |
| API mocking / interception | Built-in `page.route()` | `cy.intercept()` | No native support |
| Parallel execution | Built-in | Paid (Dashboard) | Requires Grid |
| Auto-wait / reliability | Smart auto-wait | Automatic | Manual waits |
| TypeScript support | First-class | First-class | Limited |
| CI/CD integration | GitHub Actions built-in | Requires Docker | Requires Grid |
| Trace / debug tooling | Trace viewer, UI mode, codegen | Time-travel debug | Screenshots only |
| Speed | Fast (browser contexts) | Moderate | Slow |

---

## 2. Current State Analysis

### 2.1 NDM UI Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 |
| Build | Vite 6.4 |
| Language | TypeScript 5.7 |
| State Management | Redux Toolkit + RTK Query |
| Routing | react-router-dom v7 |
| Authentication | Keycloak OIDC via `react-oidc-context` |
| UI Libraries | MUI v7, NetApp BXP Design System, Tailwind CSS |
| Forms | Formik + Yup |

### 2.2 Testing Gaps

| Area | Current Coverage | Risk |
|---|---|---|
| Unit tests (components) | None | High — UI logic bugs undetected |
| Integration tests (API + UI) | None | High — data mapping mismatches (e.g., `sub_category` key issues) |
| E2E tests (full flows) | None | Critical — authentication, navigation, report rendering untested |
| Visual regression | None | Medium — chart rendering, layout breaks |

### 2.3 Recent Bugs That E2E Tests Would Have Caught

| Bug | Root Cause | Playwright Test That Catches It |
|---|---|---|
| Empty "File Server" field on discovery preview | Backend emitted `sub_category: "Server Profile"` but UI looks for `"Config Name"` | Assert `fileServerName` field is non-empty |
| "800undefined" on chart Y-axis labels | `formatLargeNumber` computed negative array index for values < 1 | Assert no text matching `/undefined/i` on the page |
| Blank white page for small discovery reports | JS runtime error crashing React tree | Assert page renders without error boundary |

---

## 3. Proposed Architecture

### 3.1 Directory Structure

```
services/datamigrator-ui/
├── e2e/
│   ├── .auth/                        # Saved browser state (gitignored)
│   │   └── user.json
│   ├── fixtures/                     # Shared test fixtures
│   │   └── base.fixture.ts
│   ├── pages/                        # Page Object Models
│   │   ├── login.page.ts
│   │   ├── home.page.ts
│   │   ├── file-server.page.ts
│   │   ├── file-server-overview.page.ts
│   │   ├── jobs-list.page.ts
│   │   ├── job-details.page.ts
│   │   ├── job-run-details.page.ts
│   │   ├── discovery-preview.page.ts
│   │   ├── bulk-discover.page.ts
│   │   └── workers.page.ts
│   ├── mocks/                        # API response fixtures
│   │   ├── report-data.json
│   │   ├── jobs-list.json
│   │   └── file-servers.json
│   ├── auth.setup.ts                 # One-time Keycloak login
│   ├── home.spec.ts                  # Navigation tests
│   ├── file-server.spec.ts           # File server CRUD tests
│   ├── jobs-list.spec.ts             # Jobs listing tests
│   ├── discovery-preview.spec.ts     # Discovery report tests
│   ├── bulk-operations.spec.ts       # Bulk discover/migrate/cutover
│   └── permissions.spec.ts           # Role-based access tests
├── playwright.config.ts
└── package.json
```

### 3.2 Test Layers

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: Smoke Tests (fast, run on every PR)       │
│  - App loads after auth                             │
│  - Sidebar navigation works                         │
│  - Each page renders without crash                  │
├─────────────────────────────────────────────────────┤
│  Layer 2: Functional Tests (per-feature)            │
│  - Discovery preview: header, charts, download      │
│  - Jobs list: table, search, navigation             │
│  - File servers: list, create, edit, overview       │
│  - Permissions: protected routes, role enforcement  │
├─────────────────────────────────────────────────────┤
│  Layer 3: Visual Regression (scheduled nightly)     │
│  - Chart screenshots comparison                     │
│  - Layout consistency across browsers               │
│  - Responsive breakpoints                           │
└─────────────────────────────────────────────────────┘
```

---

## 4. Authentication Strategy

The NDM UI uses Keycloak OIDC. When unauthenticated, `AuthGuard` redirects to:

```
http://<KEYCLOAK_HOST>/keycloak/realms/datamigrator/protocol/openid-connect/auth
```

### Approach: One-time login with `storageState` reuse

Playwright's `setup` project runs **once** before all tests, authenticates via the Keycloak login form, and saves the browser state (cookies + localStorage + sessionStorage) to a JSON file. All subsequent test projects load this state, skipping the login entirely.

**Auth Setup Flow:**

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌────────────┐
│  Navigate    │────>│  Keycloak    │────>│  Fill username   │────>│  App loads │
│  to /        │     │  login page  │     │  + password      │     │  (home)    │
└─────────────┘     └──────────────┘     │  + click login   │     └─────┬──────┘
                                          └─────────────────┘           │
                                                                         v
                                                                  ┌──────────────┐
                                                                  │  Save state  │
                                                                  │  to user.json│
                                                                  └──────────────┘
```

```typescript
// e2e/auth.setup.ts
import { test as setup, expect } from "@playwright/test";

const AUTH_FILE = "e2e/.auth/user.json";

setup("authenticate via Keycloak", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#username", { timeout: 15_000 });
  await page.fill("#username", process.env.NDM_TEST_USER || "admin");
  await page.fill("#password", process.env.NDM_TEST_PASSWORD || "admin");
  await page.click("#kc-login");
  await page.waitForURL("**/home", { timeout: 30_000 });
  await expect(page.locator("text=Data Migrator").first()).toBeVisible();
  await page.context().storageState({ path: AUTH_FILE });
});
```

### Environment Variables (secrets — never committed)

| Variable | Purpose | Example |
|---|---|---|
| `BASE_URL` | App URL | `http://localhost:3111` or `https://172.30.205.240` |
| `NDM_TEST_USER` | Keycloak username | `admin` |
| `NDM_TEST_PASSWORD` | Keycloak password | `admin123` |

---

## 5. Page Object Model Pattern

Each page in the app gets a corresponding Page Object class that encapsulates selectors and actions. This isolates selector changes to one file and keeps tests readable.

### Example: Discovery Preview Page Object

```typescript
// e2e/pages/discovery-preview.page.ts
import { type Page, type Locator, expect } from "@playwright/test";

export class DiscoveryPreviewPage {
  readonly page: Page;
  readonly downloadButton: Locator;
  readonly downloadCsvOption: Locator;
  readonly fileServerField: Locator;
  readonly pathField: Locator;
  readonly protocolField: Locator;

  constructor(page: Page) {
    this.page = page;
    this.downloadButton = page.getByRole("button", {
      name: "Download Discovery Report",
    });
    this.downloadCsvOption = page.getByRole("button", {
      name: "Download as CSV",
    });
    this.fileServerField = page.getByText("File Server").first();
    this.pathField = page.getByText("Path").first();
    this.protocolField = page.getByText("Scan Protocol").first();
  }

  async goto(jobRunId: string) {
    await this.page.goto(`/job-discovery-preview/${jobRunId}`);
    await this.page.waitForLoadState("networkidle");
  }

  async expectHeaderVisible() {
    await expect(this.fileServerField).toBeVisible();
    await expect(this.pathField).toBeVisible();
    await expect(this.protocolField).toBeVisible();
  }

  async expectNoUndefinedInCharts() {
    const undefinedText = this.page.locator("text=/undefined/i");
    await expect(undefinedText).toHaveCount(0);
  }

  async expectOverviewMetrics() {
    await expect(this.page.getByText("Directories")).toBeVisible();
    await expect(this.page.getByText("Files")).toBeVisible();
    await expect(this.page.getByText("Total Space Used")).toBeVisible();
  }

  async downloadCsv() {
    await this.downloadButton.click();
    const [download] = await Promise.all([
      this.page.waitForEvent("download"),
      this.downloadCsvOption.click(),
    ]);
    return download;
  }
}
```

### Test using the Page Object

```typescript
// e2e/discovery-preview.spec.ts
import { test, expect } from "@playwright/test";
import { DiscoveryPreviewPage } from "./pages/discovery-preview.page";

const JOB_RUN_ID = "e54e8d28-0554-4334-a649-f9fe411c502c";

test.describe("Discovery Preview Page", () => {
  let preview: DiscoveryPreviewPage;

  test.beforeEach(async ({ page }) => {
    preview = new DiscoveryPreviewPage(page);
    await preview.goto(JOB_RUN_ID);
  });

  test("should display report header with file server info", async () => {
    await preview.expectHeaderVisible();
  });

  test("should show file server name (not empty)", async ({ page }) => {
    // Catches the "Server Profile" vs "Config Name" bug
    const header = page.locator(".mb-4").first();
    const texts = await header.allInnerTexts();
    const joined = texts.join(" ");
    expect(joined).not.toBe("");
    expect(joined).toContain("File Server");
  });

  test("should not show 'undefined' in chart labels", async () => {
    // Catches the formatLargeNumber negative index bug
    await preview.expectNoUndefinedInCharts();
  });

  test("should show overview metrics", async () => {
    await preview.expectOverviewMetrics();
  });

  test("should download CSV report", async () => {
    const download = await preview.downloadCsv();
    expect(download.suggestedFilename()).toContain(".csv");
  });

  test("should render chart sections", async ({ page }) => {
    await expect(page.getByText("File Count and Space Used")).toBeVisible();
    await expect(page.getByText("Modified")).toBeVisible();
    await expect(page.getByText("Files and Directories Depth")).toBeVisible();
  });
});
```

---

## 6. API Mocking Strategy

Playwright's `page.route()` intercepts network requests, enabling tests that run **without a live backend**.

### NDM API Services (RTK Query)

| API | Service URL Env Var | Example Route Pattern |
|---|---|---|
| Reports | `VITE_REPORTS_SERVICE_URL` | `**/api/v1/report/**` |
| Jobs | `VITE_JOBS_SERVICE_URL` | `**/api/v1/job/**` |
| Config | `VITE_CONFIG_SERVICE_URL` | `**/api/v1/config/**` |
| Admin | `VITE_ADMIN_SERVICE_URL` | `**/api/v1/admin/**` |
| Workers | `VITE_WORKERS_SERVICE_URL` | `**/api/v1/worker/**` |

### Example: Mocked Discovery Preview Test

```typescript
test("renders discovery preview with mocked API data", async ({ page }) => {
  await page.route("**/api/v1/report/data**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { value: "/nfs/data", category: "File Server Info",
          valueType: "string", sub_category: "Path" },
        { value: "my-config", category: "File Server Info",
          valueType: "string", sub_category: "Config Name" },
        { value: "NFS", category: "File Server Info",
          valueType: "string", sub_category: "Protocol" },
        { value: 93278, category: "File System Stats",
          valueType: "count", sub_category: "Total Count" },
        { value: 80000, category: "File System Stats",
          valueType: "count", sub_category: "Regular Files Count" },
        { value: 500000000, category: "File System Stats",
          valueType: "size", sub_category: "Total Space Used" },
      ]),
    });
  });

  await page.goto("/job-discovery-preview/mock-run-id");
  await expect(page.getByText("my-config")).toBeVisible();
  await expect(page.getByText("/nfs/data")).toBeVisible();
});
```

### When to use mocks vs live backend

| Scenario | Approach |
|---|---|
| PR checks (CI) — no backend available | Mocked API responses |
| Nightly regression on staging CP | Live backend |
| Local development | Either (developer choice) |
| Smoke tests after deployment | Live backend |

---

## 7. Test Coverage Plan

### Phase 1 — Foundation (Week 1-2)

| Task | Priority |
|---|---|
| Install Playwright, create config | P0 |
| Implement Keycloak auth setup | P0 |
| Smoke tests: app loads, sidebar navigation, each page renders | P0 |
| Add `test:e2e` scripts to `package.json` | P0 |

### Phase 2 — Core Flows (Week 3-4)

| Test Suite | Tests | Priority |
|---|---|---|
| Discovery Preview | Header renders, file server name visible, charts load, no "undefined", CSV/PDF download | P0 |
| Jobs List | Table loads, row click navigates, pagination | P1 |
| File Servers | List loads, create flow, edit flow, overview page | P1 |
| Job Run Details | Status display, error count, task navigation | P1 |

### Phase 3 — Advanced (Week 5-6)

| Test Suite | Tests | Priority |
|---|---|---|
| Permissions | Protected routes block unauthorized users, role-based UI elements | P1 |
| Bulk Operations | Bulk discover, migrate, cutover flows | P2 |
| API Mocking | Full mocked test suite for CI without backend | P1 |
| Visual Regression | Chart screenshots, layout comparisons | P2 |

### Phase 4 — CI/CD Integration (Week 7)

| Task | Priority |
|---|---|
| GitHub Actions workflow for PR checks (mocked) | P0 |
| Nightly regression against staging CP (live) | P1 |
| Report artifact upload + Slack notification | P2 |

---

## 8. Playwright Configuration

```typescript
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3111",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],

  webServer: {
    command: "npm run local",
    url: "http://localhost:3111",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
```

---

## 9. CI/CD Integration

### GitHub Actions Workflow

```yaml
name: Playwright E2E Tests

on:
  pull_request:
    paths:
      - 'services/datamigrator-ui/**'
  schedule:
    - cron: '0 2 * * *'  # Nightly at 2 AM UTC

jobs:
  playwright-e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    defaults:
      run:
        working-directory: services/datamigrator-ui
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: services/datamigrator-ui/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run Playwright tests
        run: npx playwright test --project=chromium
        env:
          BASE_URL: ${{ secrets.NDM_STAGING_URL }}
          NDM_TEST_USER: ${{ secrets.NDM_TEST_USER }}
          NDM_TEST_PASSWORD: ${{ secrets.NDM_TEST_PASSWORD }}

      - name: Upload HTML report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: services/datamigrator-ui/playwright-report/
          retention-days: 14

      - name: Upload test results
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: services/datamigrator-ui/test-results/
          retention-days: 7
```

### Pipeline Flow

```
PR Created/Updated
       │
       v
┌──────────────┐    ┌───────────────┐    ┌────────────────┐
│  npm ci       │───>│  Install      │───>│  Run Playwright│
│  (cached)     │    │  Chromium     │    │  tests         │
└──────────────┘    └───────────────┘    └───────┬────────┘
                                                  │
                                    ┌─────────────┴─────────────┐
                                    v                           v
                              ┌──────────┐              ┌──────────────┐
                              │  Pass    │              │  Fail        │
                              │  ✓ Merge │              │  Upload:     │
                              └──────────┘              │  - Report    │
                                                        │  - Screenshots│
                                                        │  - Traces    │
                                                        └──────────────┘
```

---

## 10. NDM-Specific Considerations

### 10.1 AuthGuard Loading States

`AuthGuard` renders intermediate states before showing the app:

```
"Loading...." → "Signing you in..." → "Authenticated, checking permissions, kindly wait..." → App Content
```

Tests must wait past these states:

```typescript
await page.goto("/jobs-list");
await page.waitForSelector("table", { timeout: 15_000 });
```

### 10.2 Protected Routes

| Route | Required Permission |
|---|---|
| `/new-file-server` | `ManageConfig` |
| `/edit-file-server/:id` | `ManageConfig` |
| `/file-server/:id/bulk-discover` | `ManageJob` |
| `/file-server/:id/bulk-migrate` | `ManageJob` |
| `/file-server/:id/bulk-cutover` | `ManageJob` |
| `/speed-test/config` | `ManageJob` |

Test with a user that has all roles, or mock the permissions API for role-specific tests.

### 10.3 Canvas Charts

Chart components render on HTML `<canvas>`, making text inside them invisible to DOM queries. Testing strategies:

| Strategy | Use Case |
|---|---|
| Assert chart container is visible | Basic rendering check |
| Assert legend text / toggle buttons | Functional check |
| `page.locator("text=/undefined/i").count() === 0` | Bug regression |
| `toHaveScreenshot()` | Visual regression |

### 10.4 Lazy-Loaded Pages

All pages use React `lazy()` imports. Playwright's auto-wait handles this, but set appropriate timeouts:

```typescript
await page.goto("/job-discovery-preview/" + jobRunId);
await page.waitForLoadState("networkidle");
```

---

## 11. Running Tests

### Local Development

```bash
# All tests headless
npm run test:e2e

# Interactive UI mode (recommended for development)
npm run test:e2e:ui

# Single file with browser visible
npx playwright test e2e/discovery-preview.spec.ts --headed

# Debug mode (step through with inspector)
npx playwright test e2e/discovery-preview.spec.ts --debug

# Generate test code by recording browser actions
npx playwright codegen http://localhost:3111
```

### Against Deployed CP

```bash
BASE_URL=https://172.30.205.240 \
NDM_TEST_USER=admin \
NDM_TEST_PASSWORD=admin123 \
npx playwright test
```

### View Report

```bash
npm run test:e2e:report    # opens HTML report in browser
```

---

## 12. package.json Changes

```json
{
  "devDependencies": {
    "@playwright/test": "^1.52.0"
  },
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:debug": "playwright test --debug",
    "test:e2e:report": "playwright show-report"
  }
}
```

---

## 13. .gitignore Additions

```
# Playwright
e2e/.auth/
test-results/
playwright-report/
blob-report/
```

---

## 14. Effort Estimate

| Phase | Scope | Effort |
|---|---|---|
| Phase 1: Foundation | Config, auth, smoke tests | 3-4 days |
| Phase 2: Core Flows | Discovery, Jobs, File Servers | 5-7 days |
| Phase 3: Advanced | Permissions, mocking, visual regression | 4-5 days |
| Phase 4: CI/CD | GitHub Actions, nightly runs | 2-3 days |
| **Total** | | **14-19 days** |

---

## 15. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Keycloak token expiry during long test runs | Tests fail mid-suite | Auth setup saves fresh state; configure Keycloak session timeout > test suite duration |
| Flaky tests due to network latency | False failures | Use `networkidle` waits, retries in CI, increase timeouts |
| No `data-testid` attributes on components | Brittle selectors | Incrementally add `data-testid` to key elements; use role-based selectors where possible |
| Chart canvas cannot be text-queried | Limited chart testing | Use visual regression screenshots + legend/toggle assertions |
| CI environment needs Keycloak access | Pipeline fails | Option A: mock all APIs in CI; Option B: deploy test Keycloak in CI |

---

## 16. Decision Points for Discussion

1. **Test environment**: Should CI tests run against mocked APIs (faster, isolated) or a live staging CP (more realistic)?
2. **Browser scope**: Start with Chromium only, or include Firefox/WebKit from day one?
3. **`data-testid` adoption**: Should we add `data-testid` attributes to components incrementally as we write tests?
4. **Nightly vs PR-only**: Should visual regression run on every PR or only nightly?
5. **Test data**: Use a dedicated test project/account in Keycloak, or create test data programmatically?

---

## 17. Appendix: NDM UI Route Map

```
/                                    → HomePage
/home                                → HomePage
/file-server                         → FileServerPage
/file-server/:fileServerId           → FileServerOverViewPage
/new-file-server                     → CreateNewFileServer      [ManageConfig]
/edit-file-server/:fileServerId      → EditFileServerPage       [ManageConfig]
/file-server/:id/bulk-discover       → BulkDiscoveryPage        [ManageJob]
/file-server/:id/bulk-migrate        → BulkMigratePage          [ManageJob]
/file-server/:id/bulk-cutover        → BulkCutOverPage          [ManageJob]
/workers/:jobRunId?                  → WorkersPage
/jobs-list                           → JobListPage
/job-details/:jobId                  → JobDetailsPage
/job-details/:jobId/run/:jobRunId    → JobRunDetailsPage
/job-details/:jobId/run/:runId/tasks → JobTasksPage
/job-details/:jobId/run/:runId/errors→ JobTaskErrorsPage
/job-details/:id/run/:id/migration-activity → MigrationActivityPage
/jobs-run-list                       → JobRunListPage
/job-discovery-preview/:jobRunId     → DiscoveryPreviewPage
/speed-test/config                   → SpeedTestConfigPage      [ManageJob]
/speed-test/:jobRunId                → SpeedTestDetailsPage
/no-access                           → NoAccess (403)
/*                                   → NotFound (404)
```
