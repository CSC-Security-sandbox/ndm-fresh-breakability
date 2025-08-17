import { expect, Page } from "@playwright/test";
import { BASE_URL } from "../config/env";

// Helper functions to reduce code duplication
export const fillConfigName = async (page: Page, configName: string) => {
  // Use modern locator with fallback to attribute-based
  const configInput = page.locator('input[name="configName"]');
  await expect(configInput).toBeVisible();
  await configInput.fill(configName);
};

export const proceedToHostConfig = async (page: Page) => {
  await page.getByRole("button", { name: "Proceed" }).click();
};

export const fillHostDetails = async (page: Page, host: string) => {
  const hostInput = page.locator('input[name="host"]');
  await expect(hostInput).toBeVisible();
  await hostInput.fill(host);
};

export const expandAccordionCard = async (page: Page) => {
  // Click the NFS accordion card specifically (best practice: be specific)
  await page.getByRole("button", { name: "NFS" }).click();
};

export const fillCredentials = async (
  page: Page,
  username: string,
  password: string
) => {
  await page.locator('input[name="userName"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
};

export const selectNFSVersion = async (page: Page, version: string = "v3") => {
  // Use more specific locator for dropdown - get the first one that's actually clickable
  await page.locator("[class*='Select'][class*='control']").first().click();
  await page.getByText(version, { exact: true }).click();
};

export const proceedToWorkerConfig = async (page: Page) => {
  await page.getByRole("button", { name: "Proceed" }).click();
};

export const toggleWorkerIfEnabled = async (page: Page) => {
  const toggleSwitch = page.locator('button[role="switch"]:not([disabled])');
  if (await toggleSwitch.isEnabled()) {
    await toggleSwitch.click();
  }
};

export const finishConfiguration = async (page: Page) => {
  await page.getByRole("button", { name: "Finish" }).click();
};

export const fillCompleteServerForm = async (
  page: Page,
  serverDetails: any,
  nfsVersion: string = "v3"
) => {
  await fillConfigName(page, serverDetails.configName);
  await proceedToHostConfig(page);
  await fillHostDetails(page, serverDetails.host);
  await expandAccordionCard(page);
  await fillCredentials(page, serverDetails.username, serverDetails.password);
  await selectNFSVersion(page, nfsVersion);
  await proceedToWorkerConfig(page);
  await toggleWorkerIfEnabled(page);
  await finishConfiguration(page);
};

export const waitForSuccessOrError = async (page: Page) => {
  await page.waitForLoadState("networkidle", { timeout: 15000 });

  // Wait for any indication of success or failure using modern locators
  await Promise.race([
    // Success indicators
    page
      .getByText("Configuration Successfully saved")
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(() => null),
    page
      .getByRole("heading", { name: "File Servers" })
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => null),
    page
      .getByRole("heading", { name: "Home" })
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => null),
    // Error indicators
    page
      .getByText("Error")
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => null),
    // Generic wait fallback
    page.waitForTimeout(5000),
  ]);

  // Log what we found on the page
  const currentUrl = page.url();
  console.log(`Current URL after file server creation: ${currentUrl}`);

  // Check for success/error states using web-first assertions
  const successVisible = await page
    .getByText("Configuration Successfully saved")
    .isVisible();
  const errorVisible = await page.getByText("Error").isVisible();
  const homeVisible = await page
    .getByRole("heading", { name: "Home" })
    .isVisible();
  const fileServersVisible = await page
    .getByRole("heading", { name: "File Servers" })
    .isVisible();

  console.log(
    `Success message: ${successVisible}, Error: ${errorVisible}, Home: ${homeVisible}, File Servers: ${fileServersVisible}`
  );

  // Consider it successful if we have a success message or we're on a expected page without errors
  if (
    successVisible ||
    ((homeVisible || fileServersVisible) && !errorVisible)
  ) {
    console.log("✅ File server creation appears successful");
  } else if (errorVisible) {
    throw new Error("❌ File server creation failed with error");
  }
};

export const navigateToAddFileServer = async (page: Page) => {
  // Navigate to home page - should already be authenticated via global setup
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");

  // Verify we're authenticated using modern locators
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible({
    timeout: 10000,
  });

  // Click the Add File Server button using modern locator
  await page.getByRole("button", { name: "Add File Server" }).click();
  await expect(
    page.getByRole("heading", { name: "Storage Servers" })
  ).toBeVisible({
    timeout: 10000,
  });
};
