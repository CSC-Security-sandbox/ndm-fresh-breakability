import { test, expect } from "@playwright/test";

/**
 * Home page tests — no workers or file servers needed.
 * Just validates the dashboard loads and basic navigation works.
 */
test.describe("Home Page", () => {

  test("should load the dashboard with heading, charts, and notice board", async ({
    page,
  }) => {
    await page.goto("/home");

    await expect(
      page.getByRole("heading", { name: "Home" })
    ).toBeVisible({ timeout: 15_000 });

    const mainContent = page.locator(".p-6").first();
    await expect(mainContent.getByText("Jobs").first()).toBeVisible();
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

    const sidebar = page.locator(
      '[data-testid="ps-sidebar-container-test-id"]'
    );
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

    const sidebar = page.locator(
      '[data-testid="ps-sidebar-container-test-id"]'
    );
    await sidebar.hover();
    await page.waitForTimeout(1_000);

    const storageServersItem = sidebar
      .locator("nav li")
      .filter({ hasText: "Storage Servers" });
    await storageServersItem.hover();
    await storageServersItem.click();
    await page.waitForTimeout(500);

    await sidebar.getByText("File Servers").click();

    await expect(page).toHaveURL(/\/file-server/);
  });

  test("should navigate to Jobs List page via sidebar", async ({ page }) => {
    await page.goto("/home");

    await expect(
      page.getByRole("heading", { name: "Home" })
    ).toBeVisible({ timeout: 15_000 });

    const sidebar = page.locator(
      '[data-testid="ps-sidebar-container-test-id"]'
    );
    await sidebar.hover();
    await page.waitForTimeout(1_000);

    // The sidebar has an animation that can make elements "not stable".
    // Re-hover to keep it expanded, then use the nav listitem to avoid
    // matching the dashboard "Jobs" card heading.
    const jobsNavItem = sidebar.locator("nav li").filter({ hasText: "Jobs" });
    await jobsNavItem.hover();
    await jobsNavItem.click();
    await page.waitForTimeout(500);

    await sidebar.getByText("Job Config List").click();

    await expect(page).toHaveURL(/\/jobs-list/);
  });

  test("should toggle Telemetry Transmission via Help drawer", async ({
    page,
  }) => {
    await page.goto("/home");
    await expect(
      page.getByRole("heading", { name: "Home" })
    ).toBeVisible({ timeout: 15_000 });

    const asupRequests: { method: string; body: any }[] = [];
    await page.route("**/asup/settings", async (route) => {
      const request = route.request();
      if (request.method() === "PUT") {
        asupRequests.push({
          method: "PUT",
          body: JSON.parse(request.postData() || "{}"),
        });
      }
      await route.continue();
    });

    const helpButton = page.locator("button", {
      has: page.locator("desc#-Help"),
    });
    await helpButton.click();

    const telemetryLabel = page.getByText("Telemetry Transmission");
    await expect(telemetryLabel).toBeVisible({ timeout: 10_000 });

    const toggle = page
      .locator("div", { hasText: "Telemetry Transmission" })
      .getByRole("switch");

    await expect(toggle).toBeVisible();
    const initialChecked = await toggle.getAttribute("aria-checked");

    // First toggle: flip
    await toggle.click();
    const firstNotification =
      initialChecked === "true"
        ? "Telemetry Transmission has been disabled"
        : "Telemetry Transmission has been enabled";
    await expect(page.getByText(firstNotification).first()).toBeVisible({
      timeout: 10_000,
    });

    // Second toggle: flip back
    await toggle.click();
    const secondNotification =
      initialChecked === "true"
        ? "Telemetry Transmission has been enabled"
        : "Telemetry Transmission has been disabled";
    await expect(page.getByText(secondNotification).first()).toBeVisible({
      timeout: 10_000,
    });

    expect(asupRequests).toHaveLength(2);
  });
});
