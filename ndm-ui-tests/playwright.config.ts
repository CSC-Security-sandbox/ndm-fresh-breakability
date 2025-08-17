import { defineConfig, devices } from "@playwright/test";

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./tests",
  /* Global setup for authentication */
  globalSetup: "./global-setup.ts",
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: false,
  /* Retry on CI only */
  retries: 2,
  /* Opt out of parallel tests on CI. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ["html"],
    ["json", { outputFile: "test-results/results.json" }],
    ["junit", { outputFile: "test-results/results.xml" }],
  ],

  /* Global test timeout */
  timeout: 30000,

  /* Expect timeout for assertions */
  expect: {
    timeout: 10000,
  },

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: "http://localhost:3111", // Fixed: was https but should be http based on your env

    /* Always run in headed mode (show browser window) */
    headless: false,

    /* Remove fixed viewport to let content use full browser window */
    viewport: null, // This allows content to use the full browser window size

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",

    /* Take screenshot only when test fails */
    screenshot: "only-on-failure",

    /* Disable global video recording - we'll enable it per test in browser context */
    video: "off",

    /* Use saved authentication state */
    storageState: "playwright/.auth/user.json",

    /* Ignore HTTPS errors */
    ignoreHTTPSErrors: true,

    /* Maximum time each action such as `click()` can take. Defaults to 0 (no limit). */
    actionTimeout: 10000,

    /* Navigation timeout */
    navigationTimeout: 30000,
  },

  /* Configure projects for Firefox browser */
  projects: [
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
  ],
});
