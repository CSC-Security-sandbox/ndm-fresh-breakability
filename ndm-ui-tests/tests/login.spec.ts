import { test, expect, Browser, BrowserContext, Page } from "@playwright/test";

const BASE_URL = "http://localhost:3111";
const ADMIN_CREDENTIALS = {
  username: "admin@datamigrator.local",
  password: "Root@123",
};

let sharedBrowser: Browser;
let sharedContext: BrowserContext;
let page: Page;

test.describe.serial("NetApp Data Migrator UI Tests", () => {
  test.beforeAll(async ({ browser }) => {
    sharedBrowser = browser;
    sharedContext = await browser.newContext();
    page = await sharedContext.newPage();
  });

  test.afterAll(async () => {
    if (sharedContext) {
      await sharedContext.close();
    }
  });

  test("should display login form", async () => {
    await page.goto(BASE_URL);

    // Check if login elements are present
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    await expect(page.locator("text=Welcome!")).toBeVisible();
    await expect(page.locator("text=Log in to Data Migrator")).toBeVisible();
  });

  test("try to log in with invalid credentials", async () => {
    await page.fill('input[name="username"]', "invalidUser");
    await page.fill('input[name="password"]', "invalidPassword");
    await page.click('button[type="submit"]');

    // Check if login failed
    await expect(
      page.locator("text=Invalid username or password")
    ).toBeVisible();
    await page.waitForTimeout(1000); // Wait for a moment to see the error message
  });

  test("try to log in with valid credentials", async () => {
    await page.fill('input[name="username"]', ADMIN_CREDENTIALS.username);
    await page.fill('input[name="password"]', ADMIN_CREDENTIALS.password);
    await page.click('button[type="submit"]');
    await expect(page.locator('role=heading[name="Home"]')).toBeVisible();
  });
});
