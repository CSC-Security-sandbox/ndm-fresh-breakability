# Playwright E2E Testing for NDM UI

## Overview

This document describes how to set up and write Playwright end-to-end tests for the **Data Migrator UI** (`datamigrator-ui`). The UI is a React 18 + Vite 6 application with Keycloak-based OIDC authentication, Redux Toolkit state management, and RTK Query for API calls.

---

## 1. Prerequisites

| Tool | Version |
|------|---------|
| Node.js | >= 18 |
| npm | >= 9 |
| Playwright | Latest (`@playwright/test`) |
| Running NDM CP | Local or deployed (Keycloak + backend services) |

---

## 2. Installation

From the `datamigrator-ui` service root:

```bash
cd ndm/services/datamigrator-ui
npm install --save-dev @playwright/test
npx playwright install           # downloads Chromium, Firefox, WebKit browsers
```

---

## 3. Configuration

Create `playwright.config.ts` in the service root (`services/datamigrator-ui/`):

```typescript
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
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        storageState: "e2e/.auth/user.json",
      },
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

### Key design decisions

- **`testDir: "./e2e"`** — keeps E2E tests separate from source code.
- **`webServer`** — auto-starts the Vite dev server on port 3111 (matches `package.json` `local` script).
- **`storageState`** — reuses authenticated browser state across tests (avoids logging in for every test).
- **`setup` project** — runs the authentication flow once and saves session state.

---

## 4. Directory Structure

```
services/datamigrator-ui/
├── e2e/
│   ├── .auth/
│   │   └── user.json              # saved auth state (gitignored)
│   ├── fixtures/
│   │   └── base.fixture.ts        # custom test fixtures
│   ├── pages/                     # page object models
│   │   ├── login.page.ts
│   │   ├── home.page.ts
│   │   ├── jobs-list.page.ts
│   │   ├── file-server.page.ts
│   │   └── discovery-preview.page.ts
│   ├── auth.setup.ts              # one-time Keycloak login
│   ├── home.spec.ts
│   ├── jobs-list.spec.ts
│   ├── file-server.spec.ts
│   └── discovery-preview.spec.ts
├── playwright.config.ts
└── ...
```

Add to `.gitignore`:

```
e2e/.auth/
test-results/
playwright-report/
```

---

## 5. Handling Keycloak Authentication

The NDM UI uses **Keycloak OIDC** via `react-oidc-context`. On page load, `AuthGuard` checks `auth.isAuthenticated` and calls `signinRedirect()` if not authenticated, redirecting to:

```
http://<KEYCLOAK_HOST>/keycloak/realms/datamigrator/protocol/openid-connect/auth
```

### 5.1 Auth Setup (run once before all tests)

Create `e2e/auth.setup.ts`:

```typescript
import { test as setup, expect } from "@playwright/test";

const KEYCLOAK_USER = process.env.NDM_TEST_USER || "admin";
const KEYCLOAK_PASS = process.env.NDM_TEST_PASSWORD || "admin";
const AUTH_FILE = "e2e/.auth/user.json";

setup("authenticate via Keycloak", async ({ page }) => {
  // Navigate to the app — AuthGuard will redirect to Keycloak
  await page.goto("/");

  // Wait for Keycloak login form
  await page.waitForSelector("#username", { timeout: 15_000 });

  // Fill Keycloak credentials
  await page.fill("#username", KEYCLOAK_USER);
  await page.fill("#password", KEYCLOAK_PASS);
  await page.click("#kc-login");

  // Wait for redirect back to the app and AuthGuard to finish loading
  await page.waitForURL("**/home", { timeout: 30_000 });

  // Verify the app loaded (sidebar or top nav visible)
  await expect(
    page.locator("text=Data Migrator").first()
  ).toBeVisible({ timeout: 15_000 });

  // Save authenticated browser state (cookies, localStorage, sessionStorage)
  await page.context().storageState({ path: AUTH_FILE });
});
```

### 5.2 Environment Variables

Pass credentials securely:

```bash
NDM_TEST_USER=admin NDM_TEST_PASSWORD=admin123 npx playwright test
```

Or create an `e2e/.env` file (gitignored):

```
NDM_TEST_USER=admin
NDM_TEST_PASSWORD=admin123
BASE_URL=http://localhost:3111
```

---

## 6. Page Object Models

Page objects encapsulate selectors and actions for each page, making tests readable and maintainable.

### 6.1 Discovery Preview Page Object

File: `e2e/pages/discovery-preview.page.ts`

```typescript
import { type Page, type Locator, expect } from "@playwright/test";

export class DiscoveryPreviewPage {
  readonly page: Page;
  readonly downloadButton: Locator;
  readonly downloadCsvOption: Locator;
  readonly downloadPdfOption: Locator;
  readonly reportHeader: Locator;
  readonly fileServerField: Locator;
  readonly pathField: Locator;
  readonly scanProtocolField: Locator;
  readonly overviewChart: Locator;
  readonly fileCountToggle: Locator;
  readonly spaceUsedToggle: Locator;

  constructor(page: Page) {
    this.page = page;
    this.downloadButton = page.getByRole("button", {
      name: "Download Discovery Report",
    });
    this.downloadCsvOption = page.getByRole("button", {
      name: "Download as CSV",
    });
    this.downloadPdfOption = page.getByRole("button", {
      name: "Download as PDF",
    });
    this.reportHeader = page.locator(".mb-4").first();
    this.fileServerField = page.getByText("File Server").first();
    this.pathField = page.getByText("Path").first();
    this.scanProtocolField = page.getByText("Scan Protocol").first();
    this.overviewChart = page.locator("canvas").first();
    this.fileCountToggle = page.getByText("File Count");
    this.spaceUsedToggle = page.getByText("Space Used");
  }

  async goto(jobRunId: string) {
    await this.page.goto(`/job-discovery-preview/${jobRunId}`);
    await this.page.waitForLoadState("networkidle");
  }

  async expectHeaderVisible() {
    await expect(this.fileServerField).toBeVisible();
    await expect(this.pathField).toBeVisible();
    await expect(this.scanProtocolField).toBeVisible();
  }

  async expectFileServerName(expectedName: string) {
    await expect(
      this.page.getByText(expectedName).first()
    ).toBeVisible();
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

  async expectNoUndefinedInCharts() {
    const chartLabels = this.page.locator("text=/undefined/i");
    await expect(chartLabels).toHaveCount(0);
  }

  async toggleChartToFileCount() {
    await this.fileCountToggle.first().click();
  }

  async toggleChartToSpaceUsed() {
    await this.spaceUsedToggle.first().click();
  }
}
```

### 6.2 Jobs List Page Object

File: `e2e/pages/jobs-list.page.ts`

```typescript
import { type Page, type Locator, expect } from "@playwright/test";

export class JobsListPage {
  readonly page: Page;
  readonly table: Locator;
  readonly searchInput: Locator;

  constructor(page: Page) {
    this.page = page;
    this.table = page.locator("table");
    this.searchInput = page.getByPlaceholder("Search");
  }

  async goto() {
    await this.page.goto("/jobs-list");
    await this.page.waitForLoadState("networkidle");
  }

  async expectTableVisible() {
    await expect(this.table).toBeVisible({ timeout: 10_000 });
  }

  async getRowCount(): Promise<number> {
    return this.table.locator("tbody tr").count();
  }

  async clickJobRow(index: number) {
    await this.table.locator("tbody tr").nth(index).click();
  }

  async search(term: string) {
    await this.searchInput.fill(term);
    await this.page.waitForTimeout(500);
  }
}
```

### 6.3 File Server Page Object

File: `e2e/pages/file-server.page.ts`

```typescript
import { type Page, type Locator, expect } from "@playwright/test";

export class FileServerPage {
  readonly page: Page;
  readonly addButton: Locator;
  readonly table: Locator;

  constructor(page: Page) {
    this.page = page;
    this.addButton = page.getByRole("button", { name: /add|new|create/i });
    this.table = page.locator("table");
  }

  async goto() {
    await this.page.goto("/file-server");
    await this.page.waitForLoadState("networkidle");
  }

  async expectPageLoaded() {
    await expect(this.table).toBeVisible({ timeout: 10_000 });
  }

  async getFileServerCount(): Promise<number> {
    return this.table.locator("tbody tr").count();
  }
}
```

---

## 7. Writing Tests

### 7.1 Discovery Preview Test

File: `e2e/discovery-preview.spec.ts`

```typescript
import { test, expect } from "@playwright/test";
import { DiscoveryPreviewPage } from "./pages/discovery-preview.page";

// Replace with a real jobRunId from your environment
const TEST_JOB_RUN_ID = "e54e8d28-0554-4334-a649-f9fe411c502c";

test.describe("Discovery Preview Page", () => {
  let discoveryPage: DiscoveryPreviewPage;

  test.beforeEach(async ({ page }) => {
    discoveryPage = new DiscoveryPreviewPage(page);
    await discoveryPage.goto(TEST_JOB_RUN_ID);
  });

  test("should display report header with file server info", async () => {
    await discoveryPage.expectHeaderVisible();
  });

  test("should show file server name (not empty)", async ({ page }) => {
    // The File Server field should not be empty
    const headerCards = page.locator(".mb-4").first();
    const fileServerValue = headerCards.locator("text=File Server").locator("..");
    await expect(fileServerValue).not.toHaveText("File Server");
  });

  test("should show overview metrics (directories, files, space)", async () => {
    await discoveryPage.expectOverviewMetrics();
  });

  test("should not show 'undefined' in any chart Y-axis labels", async () => {
    await discoveryPage.expectNoUndefinedInCharts();
  });

  test("should toggle between File Count and Space Used views", async () => {
    await discoveryPage.toggleChartToSpaceUsed();
    await expect(
      discoveryPage.page.getByText(/KiB|MiB|GiB|TiB/).first()
    ).toBeVisible();

    await discoveryPage.toggleChartToFileCount();
  });

  test("should download CSV report", async () => {
    const download = await discoveryPage.downloadCsv();
    expect(download.suggestedFilename()).toContain(".csv");
  });

  test("should show charts section", async ({ page }) => {
    // Verify chart sections exist
    await expect(page.getByText("File Count and Space Used")).toBeVisible();
    await expect(page.getByText("Files and Directories Depth")).toBeVisible();
    await expect(page.getByText("Modified")).toBeVisible();
  });
});
```

### 7.2 Jobs List Test

File: `e2e/jobs-list.spec.ts`

```typescript
import { test, expect } from "@playwright/test";
import { JobsListPage } from "./pages/jobs-list.page";

test.describe("Jobs List Page", () => {
  let jobsPage: JobsListPage;

  test.beforeEach(async ({ page }) => {
    jobsPage = new JobsListPage(page);
    await jobsPage.goto();
  });

  test("should load the jobs list table", async () => {
    await jobsPage.expectTableVisible();
  });

  test("should display at least one job", async () => {
    const rowCount = await jobsPage.getRowCount();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("should navigate to job details on row click", async ({ page }) => {
    await jobsPage.clickJobRow(0);
    await page.waitForURL("**/job-details/**");
    expect(page.url()).toContain("job-details");
  });
});
```

### 7.3 Navigation and Auth Test

File: `e2e/home.spec.ts`

```typescript
import { test, expect } from "@playwright/test";

test.describe("Home Page and Navigation", () => {
  test("should load the home page after authentication", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Data Migrator").first()).toBeVisible();
  });

  test("should navigate to File Servers via sidebar", async ({ page }) => {
    await page.goto("/");
    await page.getByText("File Servers").first().click();
    await page.waitForURL("**/file-server");
    expect(page.url()).toContain("file-server");
  });

  test("should navigate to Jobs List via sidebar", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Jobs").first().click();
    await page.waitForURL("**/jobs-list");
    expect(page.url()).toContain("jobs-list");
  });

  test("should show 404 for unknown routes", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await expect(page.getByText(/not found/i)).toBeVisible();
  });
});
```

---

## 8. API Mocking (Optional)

For isolated tests that don't depend on a running backend, use Playwright's `route` API to intercept RTK Query requests:

```typescript
import { test, expect } from "@playwright/test";

test("should render discovery preview with mocked data", async ({ page }) => {
  // Intercept the report data API call
  await page.route("**/api/v1/report/data**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          value: "/nfs/LargeEDA",
          category: "File Server Info",
          valueType: "string",
          sub_category: "Path",
        },
        {
          value: "my-config",
          category: "File Server Info",
          valueType: "string",
          sub_category: "Config Name",
        },
        {
          value: "NFS",
          category: "File Server Info",
          valueType: "string",
          sub_category: "Protocol",
        },
        {
          value: 93278,
          category: "File System Stats",
          valueType: "count",
          sub_category: "Total Count",
        },
        {
          value: 80000,
          category: "File System Stats",
          valueType: "count",
          sub_category: "Regular Files Count",
        },
        {
          value: 500000000,
          category: "File System Stats",
          valueType: "size",
          sub_category: "Total Space Used",
        },
      ]),
    });
  });

  await page.goto("/job-discovery-preview/fake-job-run-id");

  // Verify the mocked data renders correctly
  await expect(page.getByText("my-config")).toBeVisible();
  await expect(page.getByText("/nfs/LargeEDA")).toBeVisible();
  await expect(page.getByText("NFS")).toBeVisible();
});
```

### API base URLs used by RTK Query

| API Service | Env Variable | Default Target |
|---|---|---|
| Jobs | `VITE_JOBS_SERVICE_URL` | Jobs service |
| Reports | `VITE_REPORTS_SERVICE_URL` | Reports service |
| Config | `VITE_CONFIG_SERVICE_URL` | Config service |
| Admin/Users | `VITE_ADMIN_SERVICE_URL` | Admin service |
| Workers | `VITE_WORKERS_SERVICE_URL` | Workers service |

Use `page.route()` patterns like `**/api/v1/report/**` to intercept these.

---

## 9. package.json Scripts

Add these scripts to `package.json`:

```json
{
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

## 10. Running Tests

```bash
# Run all tests (headless)
npm run test:e2e

# Run with Playwright UI mode (interactive)
npm run test:e2e:ui

# Run a specific test file
npx playwright test e2e/discovery-preview.spec.ts

# Run in headed mode (see the browser)
npm run test:e2e:headed

# Debug a single test
npx playwright test e2e/discovery-preview.spec.ts --debug

# View HTML report after run
npm run test:e2e:report
```

### Against a deployed CP

```bash
BASE_URL=https://172.30.205.240 \
NDM_TEST_USER=admin \
NDM_TEST_PASSWORD=admin123 \
npx playwright test
```

---

## 11. CI/CD Integration

Add to `.github/workflows/` a new job or extend an existing one:

```yaml
  playwright-e2e:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: services/datamigrator-ui
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run Playwright tests
        run: npx playwright test --project=chromium
        env:
          BASE_URL: ${{ secrets.NDM_BASE_URL }}
          NDM_TEST_USER: ${{ secrets.NDM_TEST_USER }}
          NDM_TEST_PASSWORD: ${{ secrets.NDM_TEST_PASSWORD }}

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: services/datamigrator-ui/playwright-report/
          retention-days: 14
```

---

## 12. NDM-Specific Testing Patterns

### 12.1 Protected Routes

Routes like `/new-file-server` and `/file-server/:id/bulk-discover` require specific permissions (`ManageConfig`, `ManageJob`). Ensure your test user has the appropriate Keycloak roles, or mock the permissions API:

```typescript
await page.route("**/api/v1/admin/user-permissions**", async (route) => {
  await route.fulfill({
    status: 200,
    body: JSON.stringify({
      id: "test-user-id",
      data: {
        roles: ["ManageConfig", "ManageJob", "ViewJob", "ViewConfig"],
      },
    }),
  });
});
```

### 12.2 Waiting for RTK Query Loading States

The app uses `AuthGuard` which shows "Authenticated, checking permissions, kindly wait..." before rendering the app. Always wait for the actual content:

```typescript
await page.goto("/jobs-list");
// Wait for loading states to resolve
await page.waitForSelector("table", { timeout: 15_000 });
```

### 12.3 Testing Chart Components

Charts render on `<canvas>` elements and cannot be queried for text content inside them. Test charts by:
- Verifying the chart container/wrapper is visible
- Checking chart legend text
- Checking toggle buttons function
- Using screenshot comparison for visual regression

```typescript
test("chart visual regression", async ({ page }) => {
  await page.goto(`/job-discovery-preview/${JOB_RUN_ID}`);
  await page.waitForLoadState("networkidle");

  const chartSection = page.locator(".mb-4").nth(3);
  await expect(chartSection).toHaveScreenshot("file-count-chart.png", {
    maxDiffPixelRatio: 0.05,
  });
});
```

---

## 13. Quick Start Summary

1. `npm install --save-dev @playwright/test`
2. `npx playwright install`
3. Create `playwright.config.ts` (Section 3)
4. Create `e2e/auth.setup.ts` (Section 5.1)
5. Create page objects in `e2e/pages/` (Section 6)
6. Write tests in `e2e/*.spec.ts` (Section 7)
7. Run: `npx playwright test`
