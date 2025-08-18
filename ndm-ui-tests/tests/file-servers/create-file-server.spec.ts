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

let NFS_SRC_VALID_FILE_SERVER_DETAILS;
let NFS_TGT_VALID_FILE_SERVER_DETAILS;

test.describe.configure({ mode: "serial" });

test.describe("FS - NFS FS Creation Tests - App Admin", () => {
  test.use({ storageState: "playwright/.auth/app-admin.json" });

  test.beforeEach(async () => {
    console.log("✅ Setting up test data for FS tests");

    const timestamp = new Date().toISOString().replace(/[:.]/g, "_");

    NFS_SRC_VALID_FILE_SERVER_DETAILS = {
      configName: `NFS_SRC_${timestamp}`,
      host: "192.168.85.3",
      username: "root",
      password: "root",
    };

    NFS_TGT_VALID_FILE_SERVER_DETAILS = {
      configName: `NFS_TGT_${timestamp}`,
      host: "192.168.85.4",
      username: "root",
      password: "root",
    };
  });

  test("Should create NFS source FS", async ({ browser }) => {
    const context = await browser.newContext(getContextOptions());
    const page = await context.newPage();

    try {
      await navigateToAddFileServer(page);
      await fillCompleteServerForm(page, NFS_SRC_VALID_FILE_SERVER_DETAILS);
      await waitForSuccessOrError(page);
    } finally {
      await context.close();
    }
  });

  test("Should create NFS target FS", async ({ browser }) => {
    const context = await browser.newContext(getContextOptions());
    const page = await context.newPage();

    try {
      await navigateToAddFileServer(page);
      await fillCompleteServerForm(page, NFS_TGT_VALID_FILE_SERVER_DETAILS);
      await waitForSuccessOrError(page);
    } finally {
      await context.close();
    }
  });

  test("Should validate NFS FS connection and show error for invalid host/IP", async ({
    browser,
  }) => {
    const context = await browser.newContext(getContextOptions());
    const page = await context.newPage();

    try {
      const invalidServerDetails = {
        ...NFS_SRC_VALID_FILE_SERVER_DETAILS,
        host: "invalid-host",
        username: `INVALID_FS_${NFS_SRC_VALID_FILE_SERVER_DETAILS.username}`,
      };

      await navigateToAddFileServer(page);
      await fillCompleteServerForm(page, invalidServerDetails);
      await expect(page.getByText("Error")).toBeVisible({ timeout: 15000 });
    } finally {
      await context.close();
    }
  });
});
