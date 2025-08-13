import { test as setup, expect } from "@playwright/test";

const BASE_URL = "http://localhost:3111";
const ADMIN_CREDENTIALS = {
  username: "admin@datamigrator.local",
  password: "Root@123",
};

const authFile = "playwright/.auth/user.json";

setup("authenticate", async ({ page }) => {
  // Perform authentication steps
  await page.goto(BASE_URL);

  // Wait for the loading state to finish and login form to appear
  await page.waitForFunction(
    () => !document.body.textContent?.includes("Loading...."),
    { timeout: 30000 }
  );

  // Wait for login page elements to be visible
  await page.waitForSelector('input[name="username"]', { timeout: 15000 });
  await page.waitForSelector('input[name="password"]', { timeout: 15000 });

  await page.fill('input[name="username"]', ADMIN_CREDENTIALS.username);
  await page.fill('input[name="password"]', ADMIN_CREDENTIALS.password);
  await page.click('button[type="submit"]');

  // Wait for successful login - look for a specific element that appears after login
  await page.waitForSelector('button:has-text("Add File Server")', {
    timeout: 15000,
  });

  // Save signed-in state to 'authFile'
  await page.context().storageState({ path: authFile });
});
