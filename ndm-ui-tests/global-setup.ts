import { chromium, firefox, FullConfig, expect } from "@playwright/test";
import { BASE_URL, ADMIN_CREDENTIALS } from "./tests/config/env";

async function globalSetup(config: FullConfig) {
  console.log("🔐 Performing global authentication...");

  // Use Firefox to match our test configuration
  const browser = await firefox.launch();
  // Explicitly disable video recording for global setup to prevent empty videos
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,

    // No recordVideo property - ensures no empty videos during authentication
  });
  const page = await context.newPage();

  try {
    // Perform login once
    await page.goto(BASE_URL);
    console.log("� Navigated to:", BASE_URL);

    // Wait for page to load with a shorter timeout first
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
    console.log("✅ Page DOM loaded");

    // Try to wait for network idle, but don't fail if it times out
    try {
      await page.waitForLoadState("networkidle", { timeout: 15000 });
      console.log("✅ Network idle achieved");
    } catch (error) {
      console.log("⚠️ Network idle timeout - continuing anyway");
    }

    // Check if we're already on login page or need to navigate
    const currentUrl = page.url();
    console.log("🔍 Current URL:", currentUrl);

    // Look for username input - use attribute-based locator as fallback
    const usernameInput = page.locator('input[name="username"]');
    await usernameInput.waitFor({ state: "visible", timeout: 10000 });
    console.log("✅ Login form found");

    await page
      .locator('input[name="username"]')
      .fill(ADMIN_CREDENTIALS.username);
    await page
      .locator('input[name="password"]')
      .fill(ADMIN_CREDENTIALS.password);
    console.log("✅ Credentials filled");

    await page.locator('button[type="submit"]').click();
    console.log("✅ Login button clicked"); // Wait for navigation away from login
    await page.waitForURL((url) => !url.toString().includes("/login"), {
      timeout: 15000,
    });
    console.log("✅ Successfully logged in");

    // Save signed-in state first, then verify home page access
    await context.storageState({ path: "playwright/.auth/user.json" });
    console.log("✅ Authentication state saved");

    // Verify we can access the home page using modern locator
    try {
      await page.goto(BASE_URL);
      await expect(page.getByRole("heading", { name: "Home" })).toBeVisible({
        timeout: 10000,
      });
      console.log("✅ Home page accessible");
    } catch (error) {
      console.log(
        "⚠️ Home page verification failed, but auth is saved:",
        error.message
      );
    }
  } catch (error) {
    console.error("❌ Global authentication failed:", error);
    throw error;
  } finally {
    await browser.close();
  }
}

export default globalSetup;
