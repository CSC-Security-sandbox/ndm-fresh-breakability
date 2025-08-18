import { expect, test } from "@playwright/test";
import { getContextOptions } from "../helpers/browser-config";
import { BASE_URL } from "../config/env";

test.describe("File Server Discovery Test", () => {
  test.use({ storageState: "playwright/.auth/app-admin.json" });

  test("Should navigate to discovery page and verify FS name is displayed", async ({
    browser,
  }) => {
    const context = await browser.newContext(getContextOptions());
    const page = await context.newPage();

    try {
      //CREATE DISCOVERY ON SRC
      await page.goto(BASE_URL);
      await page.waitForLoadState("networkidle");
      await page.goto(`${BASE_URL}/file-server`);
      const fsNameElement = page
        .getByRole("heading", {
          name: /NFS_SRC_/,
        })
        .first();
      await expect(fsNameElement).toBeVisible();
      await fsNameElement.click();
      await page.getByRole("button", { name: "Bulk Discover" }).click();
      await page.waitForLoadState("networkidle");
      await page.locator('input[type="checkbox"][name="row"]').first().check();
      await page.getByRole("button", { name: "Submit" }).click();
      await expect(
        page.getByText("Bulk Discover Job has been created.")
      ).toBeVisible();

      await page.getByRole("button", { name: "View Job Listing" }).click();
      await page.waitForTimeout(3000);
      //   NAVIGATE TO DISCOVERY DETAIL TO CHECK PROGRESS
      //   Bulk Discover Job has been created.View Job Listing
    } finally {
      await context.close();
    }
  });
});
