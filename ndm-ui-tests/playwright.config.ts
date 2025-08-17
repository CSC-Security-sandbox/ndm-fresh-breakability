import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: false,
  retries: 2,
  workers: 1,
  reporter: [["html"]],
  timeout: 30000,
  expect: { timeout: 10000 },

  use: {
    baseURL: "http://localhost:3111",
    headless: false,
    viewport: null,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ignoreHTTPSErrors: true,
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  projects: [
    // Setup project - creates auth states for all users
    { name: "setup", testMatch: /.*\.setup\.ts/ },

    // Main test project - tests use storageState directly via test.use()
    {
      name: "ndm",
      use: {
        ...devices["Desktop Firefox"],
        // No default storageState - tests specify their own
      },
      dependencies: ["setup"],
    },
  ],
});
