import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

// Load .env from the playwright-test directory (does not override existing env vars)
dotenv.config({ path: path.resolve(__dirname, ".env") });

/**
 * Live-mode Playwright config — runs tests against an NDM instance.
 *
 * Defaults to local Docker Compose setup (http://localhost:3111).
 * Override BASE_URL to target a remote CP instead.
 *
 * Setup:
 *   cp .env.example .env   # defaults work for local Docker
 *   npm run test:live:headed
 *
 * Environment variables can also be passed inline (they override .env):
 *   BASE_URL=https://172.30.205.220 npm run test:live:headed
 *
 * Required:
 *   BASE_URL          — CP URL (default: http://localhost:3111)
 *   NDM_TEST_USER     — Keycloak username (default: admin@datamigrator.local)
 *   NDM_TEST_PASSWORD — Keycloak password (default: welcome)
 *
 * For file server / discovery tests:
 *   SOURCE_HOST         — Source filer IP
 *   PROTOCOL            — NFS or SMB (default NFS)
 *   PROTOCOL_USERNAME   — Filer credentials
 *   PROTOCOL_PASSWORD   — Filer credentials (optional for NFS)
 *   EXPORT_PATHS        — Comma-separated export paths (optional)
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3111",
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
        storageState: "tests/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
});
