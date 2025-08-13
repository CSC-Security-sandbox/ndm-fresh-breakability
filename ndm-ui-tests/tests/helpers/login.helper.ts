import { Page, expect } from "@playwright/test";

const BASE_URL = "http://localhost:3111";
const ADMIN_CREDENTIALS = {
  username: "admin@datamigrator.local",
  password: "Root@123",
};

export async function loginAsAdmin(page: Page) {
  await page.goto(BASE_URL);

  // Wait for the login form to be visible
  await expect(page.locator('input[name="username"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();

  // Fill in credentials and submit
  await page.fill('input[name="username"]', ADMIN_CREDENTIALS.username);
  await page.fill('input[name="password"]', ADMIN_CREDENTIALS.password);
  await page.click('button[type="submit"]');

  // Wait for successful login by checking for a specific home page element
  await expect(
    page.locator('button:has-text("Add File Server")')
  ).toBeVisible();
}
