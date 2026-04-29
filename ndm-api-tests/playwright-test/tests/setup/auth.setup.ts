import { test as setup, expect } from "@playwright/test";

const STORAGE_STATE_PATH = "tests/.auth/user.json";

/**
 * Performs a real Keycloak login against the deployed CP and saves the
 * authenticated browser state (cookies + sessionStorage + localStorage)
 * so all subsequent test specs can reuse it without logging in again.
 *
 * Required env vars:
 *   BASE_URL          – CP URL, e.g. https://172.30.205.220
 *   NDM_TEST_USER     – Keycloak username
 *   NDM_TEST_PASSWORD – Keycloak password
 */
setup("authenticate via Keycloak", async ({ page }) => {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) throw new Error("BASE_URL env var is required for live mode");

  await page.goto(baseUrl);

  await page.waitForSelector("#username", { timeout: 30_000 });

  await page.fill("#username", process.env.NDM_TEST_USER || "admin");
  await page.fill("#password", process.env.NDM_TEST_PASSWORD || "admin123");
  await page.click("#kc-login");

  await page.waitForURL("**/home", { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Home" })
  ).toBeVisible({ timeout: 15_000 });

  await page.context().storageState({ path: STORAGE_STATE_PATH });
});
