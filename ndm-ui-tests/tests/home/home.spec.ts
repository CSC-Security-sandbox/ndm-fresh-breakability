import { test, expect, Browser, BrowserContext, Page } from "@playwright/test";

const BASE_URL = "http://localhost:3111";
const ADMIN_CREDENTIALS = {
  username: "admin@datamigrator.local",
  password: "Root@123",
};

let sharedContext: BrowserContext;
let sharedPage: Page;

test.describe.serial("Home Page Tests", () => {
  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext();
    sharedPage = await sharedContext.newPage();
  });

  test.afterAll(async () => {
    if (sharedContext) {
      await sharedContext.close();
    }
  });

  test("should login and display home page", async () => {
    await sharedPage.goto(BASE_URL);

    // Login with valid credentials
    await sharedPage.fill('input[name="username"]', ADMIN_CREDENTIALS.username);
    await sharedPage.fill('input[name="password"]', ADMIN_CREDENTIALS.password);
    await sharedPage.click('button[type="submit"]');

    // Check if login was successful by looking for the Home page heading
    await expect(sharedPage.locator('role=heading[name="Home"]')).toBeVisible();
  });

  test("should display the two main action buttons", async () => {
    // Check for the two main buttons on home page
    await expect(
      sharedPage.locator('button:has-text("Add File Server")')
    ).toBeVisible();
    await expect(
      sharedPage.locator('button:has-text("View Instruction To Setup Worker")')
    ).toBeVisible();
  });

  test("should navigate through all menu items", async () => {
    // Test Home navigation (should already be there)
    await expect(
      sharedPage.locator('button:has-text("Add File Server")')
    ).toBeVisible();

    // Try to locate the sidebar more broadly first
    const sidebarContainer = sharedPage
      .locator('complementary, nav, [role="navigation"]')
      .first();

    // Hover over sidebar to expand it
    await sidebarContainer.hover();
    await sharedPage.locator("text=Storage Servers").click();

    // Wait for the submenu to appear and be properly positioned
    await sharedPage.waitForSelector(
      '[data-testid="ps-submenu-content-test-id"]',
      {
        state: "visible",
        timeout: 5000,
      }
    );

    // Wait a bit for the submenu animation/positioning to complete
    await sharedPage.waitForTimeout(1000);

    // Click on File Servers within the submenu
    await sharedPage
      .locator(
        '[data-testid="ps-submenu-content-test-id"] >> text=File Servers'
      )
      .click();
    await sharedPage.waitForLoadState("networkidle");

    // Hover over sidebar again and navigate to Workers
    await sidebarContainer.hover();
    await sharedPage.waitForTimeout(1000);
    await sharedPage.locator("text=Workers").click();
    await sharedPage.waitForLoadState("networkidle");

    // Hover over sidebar again and navigate to Jobs
    await sidebarContainer.hover().then(() => {
      sharedPage.waitForTimeout(1000);
      sharedPage.locator("text=Jobs").click();
      sharedPage.waitForLoadState("networkidle");
    });

    // Hover over sidebar again and navigate back to Home
    await sidebarContainer.hover();
    await sharedPage.waitForTimeout(1000);
    await sharedPage.locator("text=Home").click();
    await sharedPage.waitForLoadState("networkidle");
    await expect(
      sharedPage.locator('button:has-text("Add File Server")')
    ).toBeVisible();
  });
});
