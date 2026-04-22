import { test, expect } from "@playwright/test";
import { setupMockAuth, setupMockAPIs } from "./helpers/mock-auth";

const isLiveMode = !!process.env.BASE_URL;

test.describe("Home Page", () => {
  test.beforeEach(async ({ page }) => {
    if (!isLiveMode) {
      await setupMockAuth(page);
      await setupMockAPIs(page);

      await page.addInitScript(() => {
        localStorage.setItem("account_id", "acc-001");
        localStorage.setItem("selected_project_id", "proj-001");
      });
    }
  });

  test("should load the dashboard with heading, charts, and notice board", async ({
    page,
  }) => {
    await page.goto("/home");

    const heading = page.getByRole("heading", { name: "Home" });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    const mainContent = page.locator(".p-6").first();
    await expect(mainContent.getByText("Jobs").first()).toBeVisible();
    await expect(
      mainContent.locator("div", { hasText: /^.*Storage$/ }).first()
    ).toBeVisible();
    await expect(page.getByText(/Notice Board/)).toBeVisible();
  });

  test("should show Add File Server button for admin users", async ({
    page,
  }) => {
    await page.goto("/home");

    await expect(
      page.getByRole("heading", { name: "Home" })
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByRole("button", { name: "Add File Server" })
    ).toBeVisible();
  });

  test("should expand sidebar on hover and show navigation items", async ({
    page,
  }) => {
    await page.goto("/home");

    await expect(
      page.getByRole("heading", { name: "Home" })
    ).toBeVisible({ timeout: 15_000 });

    const sidebar = page.locator('[data-testid="ps-sidebar-container-test-id"]');
    await sidebar.hover();
    await page.waitForTimeout(800);

    await expect(sidebar.getByText("Home")).toBeVisible();
    await expect(sidebar.getByText("Storage Servers")).toBeVisible();
    await expect(sidebar.getByText("Workers")).toBeVisible();
    await expect(sidebar.getByText("Jobs")).toBeVisible();
  });

  test("should navigate to File Servers page via sidebar", async ({
    page,
  }) => {
    await page.goto("/home");

    await expect(
      page.getByRole("heading", { name: "Home" })
    ).toBeVisible({ timeout: 15_000 });

    const sidebar = page.locator('[data-testid="ps-sidebar-container-test-id"]');
    await sidebar.hover();
    await page.waitForTimeout(800);

    await sidebar.getByText("Storage Servers").click();
    await sidebar.getByText("File Servers").click();

    await expect(page).toHaveURL(/\/file-server/);
  });

  test("should navigate to Jobs List page via sidebar", async ({ page }) => {
    await page.goto("/home");

    await expect(
      page.getByRole("heading", { name: "Home" })
    ).toBeVisible({ timeout: 15_000 });

    const sidebar = page.locator('[data-testid="ps-sidebar-container-test-id"]');
    await sidebar.hover();
    await page.waitForTimeout(800);

    await sidebar.getByText("Jobs", { exact: true }).click();
    await sidebar.getByText("Job Config List").click();

    await expect(page).toHaveURL(/\/jobs-list/);
  });
});
