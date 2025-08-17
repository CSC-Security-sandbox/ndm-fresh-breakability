import { expect, Page, test } from "@playwright/test";
import {
  getContextOptions,
  getContextOptionsWithoutVideo,
} from "../helpers/browser-config";
import {
  fillCompleteServerForm,
  navigateToAddFileServer,
  waitForSuccessOrError,
} from "./file-server.helpers";

let NFS_VALID_FILE_SERVER_DETAILS;

// Configure this test suite to run in serial mode
test.describe.configure({ mode: "serial" });

// Admin and Project Admin tests (can create file servers)
test.describe("FS - Create File Server Tests - App Admin", () => {
  test.use({ storageState: "playwright/.auth/app-admin.json" });

  test.beforeEach(async () => {
    console.log("✅ Setting up test data for file server tests");

    NFS_VALID_FILE_SERVER_DETAILS = {
      configName: new Date().toISOString().replace(/[:.]/g, "_"), // Unique config name
      host: "192.168.85.3",
      username: "root",
      password: "root",
    };
  });

  test("Should create file server with valid data", async ({ browser }) => {
    // Create a new page for this specific test with video recording
    const context = await browser.newContext(getContextOptions());
    const page = await context.newPage();

    try {
      // Navigate to Add File Server page
      await navigateToAddFileServer(page);

      // Use helper method to fill the complete form
      await fillCompleteServerForm(page, NFS_VALID_FILE_SERVER_DETAILS);

      // Wait for success confirmation
      await waitForSuccessOrError(page);
    } finally {
      // Close the context instead of just the page to properly save video
      await context.close();
    }
  });

  test("Should validate worker and show error for invalid host/IP", async ({
    browser,
  }) => {
    // Create a new page for this specific test with video recording
    const context = await browser.newContext(getContextOptions());
    const page = await context.newPage();

    try {
      const invalidServerDetails = {
        ...NFS_VALID_FILE_SERVER_DETAILS,
        host: "invalid-host",
        username: `INVALID_FS_${NFS_VALID_FILE_SERVER_DETAILS.username}`,
      };

      // Navigate to Add File Server page
      await navigateToAddFileServer(page);

      // Use helper method to fill the complete form with invalid data
      await fillCompleteServerForm(page, invalidServerDetails);

      // Simply check for "Error" text as you mentioned the app shows it
      await expect(page.getByText("Error")).toBeVisible({ timeout: 15000 });
    } finally {
      // Close the context instead of just the page to properly save video
      await context.close();
    }
  });
});
