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

  test("should toggle Telemetry Transmission on and off via Help drawer", async ({
    page,
  }) => {
    await page.goto("/home");
    await expect(
      page.getByRole("heading", { name: "Home" })
    ).toBeVisible({ timeout: 15_000 });

    // Intercept the ASUP settings API so we can observe the calls
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

    // Open the Help drawer — click the button containing the HelpIcon SVG
    // The HelpIcon SVG has a <desc> with text "Help" inside it
    const helpButton = page.locator('button', {
      has: page.locator('desc#-Help'),
    });
    await helpButton.click();

    // Wait for "Telemetry Transmission" label to appear inside the drawer
    const telemetryLabel = page.getByText("Telemetry Transmission");
    await expect(telemetryLabel).toBeVisible({ timeout: 10_000 });

    // Locate the toggle switch (role="switch") near the label
    const toggle = page
      .locator("div", { hasText: "Telemetry Transmission" })
      .getByRole("switch");

    await expect(toggle).toBeVisible();

    // Read initial state
    const initialChecked = await toggle.getAttribute("aria-checked");
    console.log(`Telemetry toggle initial state: ${initialChecked}`);

    // --- First toggle: flip the value ---
    await toggle.click();
    // Wait for the notification confirming the change
    const firstNotification = initialChecked === "true"
      ? "Telemetry Transmission has been disabled"
      : "Telemetry Transmission has been enabled";
    await expect(page.getByText(firstNotification).first()).toBeVisible({
      timeout: 10_000,
    });
    // Verify the toggle state flipped
    const flippedChecked = initialChecked === "true" ? "false" : "true";
    await expect(toggle).toHaveAttribute("aria-checked", flippedChecked);

    // --- Second toggle: flip it back to original ---
    await toggle.click();
    const secondNotification = initialChecked === "true"
      ? "Telemetry Transmission has been enabled"
      : "Telemetry Transmission has been disabled";
    await expect(page.getByText(secondNotification).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(toggle).toHaveAttribute("aria-checked", initialChecked!);

    // Verify two PUT requests were made to asup/settings
    expect(asupRequests).toHaveLength(2);
    expect(asupRequests[0].body).toEqual({
      enabled: initialChecked !== "true",
    });
    expect(asupRequests[1].body).toEqual({
      enabled: initialChecked === "true",
    });
    console.log("ASUP settings API calls captured:", JSON.stringify(asupRequests, null, 2));
  });
});
