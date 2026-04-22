import { defineConfig, devices } from "@playwright/test";

/**
 * Live-mode Playwright config — runs tests against a real deployed CP
 * with real Keycloak auth and real backend APIs (no mocks).
 *
 * Usage:
 *   BASE_URL=https://172.30.205.240 \
 *   NDM_TEST_USER=admin \
 *   NDM_TEST_PASSWORD=admin123 \
 *   npx playwright test --config=playwright.live.config.ts
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],

  use: {
    baseURL: process.env.BASE_URL || "https://172.30.205.240",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { storageState: undefined },
    },
    {
      name: "chromium",
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
});
