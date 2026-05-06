import { test as setup, expect } from "@playwright/test";

const STORAGE_STATE_PATH = "tests/.auth/user.json";

/**
 * Performs a real Keycloak login and saves the authenticated browser state
 * (cookies + sessionStorage + localStorage) so all subsequent test specs
 * can reuse it without logging in again.
 *
 * Defaults match the local Docker Compose Keycloak setup.
 * Override via .env or environment variables for remote CPs.
 *
 * Env vars:
 *   BASE_URL          – CP URL (default: http://localhost:3111)
 *   NDM_TEST_USER     – Keycloak username (default: admin@datamigrator.local)
 *   NDM_TEST_PASSWORD – Keycloak password (default: welcome)
 */
setup("authenticate via Keycloak", async ({ page }) => {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) throw new Error("BASE_URL env var is required for live mode");

  await page.goto(baseUrl);

  await page.waitForSelector("#username", { timeout: 30_000 });

  await page.fill("#username", process.env.NDM_TEST_USER || "admin@datamigrator.local");
  await page.fill("#password", process.env.NDM_TEST_PASSWORD || "welcome");
  await page.click("#kc-login");

  await page.waitForURL("**/home", { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Home" })
  ).toBeVisible({ timeout: 15_000 });

  await page.context().storageState({ path: STORAGE_STATE_PATH });
});
