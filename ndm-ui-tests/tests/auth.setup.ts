import { test as setup } from "@playwright/test";
import {
  BASE_URL,
  APP_ADMIN_CREDENTIALS,
  PROJECT_ADMIN_CREDENTIALS,
  PROJECT_VIEWER_CREDENTIALS,
} from "./config/env";

// ⚠️  SECURITY WARNING:
// The auth state files created by this setup contain sensitive session data.
// They are excluded from git via .gitignore - DO NOT commit them to the repository.

// Setup for App Admin
setup("authenticate app admin", async ({ page }) => {
  await page.goto(BASE_URL);

  // Use modern Playwright locators - based on the HTML element provided
  await page
    .getByPlaceholder("Enter Email")
    .fill(APP_ADMIN_CREDENTIALS.username);
  await page
    .getByRole("textbox", { name: "password" })
    .fill(APP_ADMIN_CREDENTIALS.password);
  await page.getByRole("button", { name: /submit|login|sign in/i }).click();

  await page.waitForURL((url) => !url.toString().includes("/login"));

  await page
    .context()
    .storageState({ path: "playwright/.auth/app-admin.json" });
});

// Setup for Project Admin
setup("authenticate project admin", async ({ page }) => {
  await page.goto(BASE_URL);

  // Use modern Playwright locators
  await page
    .getByPlaceholder("Enter Email")
    .fill(PROJECT_ADMIN_CREDENTIALS.username);
  await page
    .getByRole("textbox", { name: "password" })
    .fill(PROJECT_ADMIN_CREDENTIALS.password);
  await page.getByRole("button", { name: /submit|login|sign in/i }).click();

  await page.waitForURL((url) => !url.toString().includes("/login"));

  await page
    .context()
    .storageState({ path: "playwright/.auth/project-admin.json" });
});

// Setup for Project Viewer (commented out until user account is created)
// setup('authenticate project viewer', async ({ page }) => {
//   await page.goto(BASE_URL);
//
//   // Use modern Playwright locators
//   await page.getByPlaceholder("Enter Email").fill(PROJECT_VIEWER_CREDENTIALS.username);
//   await page.getByRole("textbox", { name: "password" }).fill(PROJECT_VIEWER_CREDENTIALS.password);
//   await page.getByRole("button", { name: /submit|login|sign in/i }).click();
//
//   await page.waitForURL(url => !url.toString().includes('/login'));
//
//   await page.context().storageState({ path: 'playwright/.auth/project-viewer.json' });
// });
