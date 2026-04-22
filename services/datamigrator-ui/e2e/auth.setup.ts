import { test as setup, expect } from "@playwright/test";

const STORAGE_STATE_PATH = "e2e/.auth/user.json";

/**
 * Performs a real Keycloak login against the deployed CP and saves the
 * authenticated browser state (cookies + sessionStorage + localStorage)
 * so all subsequent test specs can reuse it without logging in again.
 *
 * Required env vars:
 *   BASE_URL          – CP URL, e.g. https://172.30.205.240
 *   NDM_TEST_USER     – Keycloak username
 *   NDM_TEST_PASSWORD – Keycloak password
 */
setup("authenticate via Keycloak", async ({ page }) => {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) throw new Error("BASE_URL env var is required for live mode");

  await page.goto(baseUrl);

  // Keycloak redirects to its login form
  await page.waitForSelector("#username", { timeout: 30_000 });

  await page.fill("#username", process.env.NDM_TEST_USER || "admin");
  await page.fill("#password", process.env.NDM_TEST_PASSWORD || "admin123");
  await page.click("#kc-login");

  // Wait for the app to fully load after successful auth
  await page.waitForURL("**/home", { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible({ timeout: 15_000 });

  // Save the authenticated state for all test specs to reuse
  await page.context().storageState({ path: STORAGE_STATE_PATH });
});
