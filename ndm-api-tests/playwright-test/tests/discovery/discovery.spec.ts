import { test, expect } from "@playwright/test";
import {
  getEnvOrThrow,
  createFileServer,
  navigateToFileServer,
  runBulkDiscovery,
  waitForJobCompletion,
  getJobConfigIds,
  navigateToDiscoveryReport,
  verifyDiscoveryReport,
  safeGoto,
} from "../helpers/e2e-helpers";

/**
 * Discovery E2E Tests
 *
 * Comprehensive test suite for the file server discovery workflow:
 *   1. File server creation with worker association
 *   2. Single export path discovery + report verification
 *   3. Select-all export paths discovery
 *   4. Discovery with custom exclude patterns
 *   5. Re-run discovery (idempotency)
 *   6. Full discovery report section verification
 *   7. File server overview reflects discovery data
 *
 * Required env vars:
 *   BASE_URL          — Control Plane URL (e.g. https://172.30.205.220)
 *   NDM_TEST_USER     — Keycloak username
 *   NDM_TEST_PASSWORD — Keycloak password
 *   SOURCE_HOST       — NFS/SMB source host IP
 *   PROTOCOL          — "NFS" or "SMB" (default: NFS)
 *   PROTOCOL_USERNAME — Protocol username (e.g. "root")
 *   PROTOCOL_PASSWORD — Protocol password (optional for NFS)
 *   EXPORT_PATHS      — Comma-separated paths for single-path test
 *                        (e.g. "/ifs/exampleexport"). Omit to skip single-path tests.
 */

const TIMEOUT_JOB = 600_000; // 10 min per discovery job
const uniqueId = `pw-${Date.now().toString(36)}`;

// ─── Shared state across serial tests ────────────────────────────────────────
let fileServerId: string;
let serverName: string;

const protocol = (process.env.PROTOCOL || "NFS") as "NFS" | "SMB";
const protocolPass = process.env.PROTOCOL_PASSWORD || "";
const singleExportPath = process.env.EXPORT_PATHS
  ? process.env.EXPORT_PATHS.split(",").map((p) => p.trim())
  : [];

test.describe.serial(
  "Discovery E2E: File Server → Bulk Discovery → Reports",
  () => {
    test.setTimeout(1_200_000); // 20 min per test

    // ───────────────────────────────────────────────────────────────────
    // 1. Create file server and verify Active state
    // ───────────────────────────────────────────────────────────────────
    test("1. Create file server and verify it is Active", async ({ page }) => {
      serverName = `e2e-${protocol.toLowerCase()}-${uniqueId}`;
      const host = getEnvOrThrow("SOURCE_HOST");
      const user = getEnvOrThrow("PROTOCOL_USERNAME");

      await test.step("Create file server via wizard", async () => {
        await createFileServer(page, {
          name: serverName,
          host,
          protocol,
          username: user,
          password: protocolPass || undefined,
        });

        await page.waitForTimeout(3_000);
        fileServerId = await navigateToFileServer(page, serverName);
        expect(fileServerId).toBeTruthy();
        console.log(`File server created: ${serverName} (${fileServerId})`);
      });

      await test.step("Verify overview shows Bulk Discover enabled", async () => {
        await page.goto(`/file-server/${fileServerId}`);
        await expect(
          page.getByText("File Server Overview").first()
        ).toBeVisible({ timeout: 15_000 });

        const bulkBtn = page.getByRole("button", { name: "Bulk Discover" });
        await expect(bulkBtn).toBeVisible({ timeout: 15_000 });
        await expect(bulkBtn).toBeEnabled({ timeout: 30_000 });
        console.log("Bulk Discover button enabled → file server is Active");
      });

      await test.step("Verify file server list shows Active status", async () => {
        await page.goto("/file-server");
        await page.waitForTimeout(3_000);
        await expect(
          page.getByText(serverName, { exact: true }).first()
        ).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText("Active").first()).toBeVisible({
          timeout: 10_000,
        });
        console.log("File server visible in list with Active status");
      });
    });

    // ───────────────────────────────────────────────────────────────────
    // 2. Single export path discovery
    // ───────────────────────────────────────────────────────────────────
    test("2. Discover single export path and verify report", async ({
      page,
    }) => {
      test.skip(
        singleExportPath.length === 0,
        "EXPORT_PATHS not set — skipping single-path test"
      );

      let jobConfigIds: string[];

      await test.step("Run bulk discovery on single path", async () => {
        console.log(`Discovering: ${singleExportPath.join(", ")}`);
        await runBulkDiscovery(page, fileServerId, {
          exportPaths: singleExportPath,
        });
        await expect(
          page.getByText("Bulk Discover Job has been created").first()
        ).toBeVisible({ timeout: 10_000 });
      });

      await test.step("Find discovery job configs via API", async () => {
        jobConfigIds = await getJobConfigIds(page, serverName, "discover");
        console.log(
          `Found ${jobConfigIds.length} discovery job(s):`,
          jobConfigIds
        );
        expect(jobConfigIds.length).toBeGreaterThan(0);
      });

      await test.step("Wait for discovery to complete", async () => {
        for (const jobId of jobConfigIds) {
          console.log(`Waiting for job ${jobId}…`);
          await waitForJobCompletion(page, jobId, TIMEOUT_JOB);
          console.log(`Job ${jobId} completed`);
        }
      });

      await test.step("Verify discovery report loads", async () => {
        await navigateToDiscoveryReport(page, jobConfigIds[0]);
        await verifyDiscoveryReport(page);
        await expect(page.getByText(/completed/i).first()).toBeVisible({
          timeout: 10_000,
        });
        console.log("Single-path discovery report verified");
      });
    });

    // ───────────────────────────────────────────────────────────────────
    // 3. Select ALL export paths discovery
    // ───────────────────────────────────────────────────────────────────
    test("3. Discover all export paths (select all)", async ({ page }) => {
      let jobConfigIds: string[];
      const jobCountBefore = (
        await getJobConfigIds(page, serverName, "discover")
      ).length;

      await test.step("Run bulk discovery — select all", async () => {
        await runBulkDiscovery(page, fileServerId);
        await expect(
          page.getByText("Bulk Discover Job has been created").first()
        ).toBeVisible({ timeout: 10_000 });
      });

      await test.step("Verify new job configs were created", async () => {
        await page.waitForTimeout(5_000);
        jobConfigIds = await getJobConfigIds(page, serverName, "discover");
        console.log(
          `Total discovery jobs: ${jobConfigIds.length} (was ${jobCountBefore})`
        );
        expect(jobConfigIds.length).toBeGreaterThan(jobCountBefore);
      });

      await test.step("Wait for new discovery jobs to complete", async () => {
        const newJobs = jobConfigIds.slice(jobCountBefore);
        for (const jobId of newJobs) {
          console.log(`Waiting for job ${jobId}…`);
          await waitForJobCompletion(page, jobId, TIMEOUT_JOB);
          console.log(`Job ${jobId} completed`);
        }
      });
    });

    // ───────────────────────────────────────────────────────────────────
    // 4. Discovery with custom exclude patterns
    // ───────────────────────────────────────────────────────────────────
    test("4. Discover with custom exclude patterns", async ({ page }) => {
      test.skip(
        singleExportPath.length === 0,
        "EXPORT_PATHS not set — skipping exclude-pattern test"
      );

      await test.step("Run discovery with exclude patterns", async () => {
        await runBulkDiscovery(page, fileServerId, {
          exportPaths: singleExportPath,
          excludeFilePatterns: "*.tmp\n*.log\n*/temp/*",
        });
        await expect(
          page.getByText("Bulk Discover Job has been created").first()
        ).toBeVisible({ timeout: 10_000 });
        console.log("Discovery with exclude patterns submitted");
      });

      await test.step("Wait for discovery to complete", async () => {
        await page.waitForTimeout(5_000);
        const allJobs = await getJobConfigIds(page, serverName, "discover");
        const latestJobId = allJobs[allJobs.length - 1];
        console.log(`Waiting for latest job ${latestJobId}…`);
        await waitForJobCompletion(page, latestJobId, TIMEOUT_JOB);
        console.log("Discovery with exclude patterns completed");
      });
    });

    // ───────────────────────────────────────────────────────────────────
    // 5. Re-run discovery on already-discovered path
    // ───────────────────────────────────────────────────────────────────
    test("5. Re-run discovery on same path", async ({ page }) => {
      test.skip(
        singleExportPath.length === 0,
        "EXPORT_PATHS not set — skipping re-discovery test"
      );

      let jobCountBefore: number;

      await test.step("Count existing discovery jobs", async () => {
        const existing = await getJobConfigIds(page, serverName, "discover");
        jobCountBefore = existing.length;
        console.log(`Discovery jobs before re-run: ${jobCountBefore}`);
      });

      await test.step("Re-run discovery on the same path", async () => {
        await runBulkDiscovery(page, fileServerId, {
          exportPaths: singleExportPath,
        });
        await expect(
          page.getByText("Bulk Discover Job has been created").first()
        ).toBeVisible({ timeout: 10_000 });
      });

      await test.step("Verify job count is at least the same", async () => {
        await page.waitForTimeout(5_000);
        const afterJobs = await getJobConfigIds(page, serverName, "discover");
        expect(afterJobs.length).toBeGreaterThanOrEqual(jobCountBefore);
        console.log(`Discovery jobs after re-run: ${afterJobs.length}`);
      });

      await test.step("Wait for re-discovery to complete", async () => {
        const allJobs = await getJobConfigIds(page, serverName, "discover");
        const latestJobId = allJobs[allJobs.length - 1];
        await waitForJobCompletion(page, latestJobId, TIMEOUT_JOB);
        console.log("Re-discovery completed successfully");
      });
    });

    // ───────────────────────────────────────────────────────────────────
    // 6. Full discovery report verification
    // ───────────────────────────────────────────────────────────────────
    test("6. Verify discovery report has all sections", async ({ page }) => {
      let jobConfigIds: string[];

      await test.step("Get completed discovery jobs", async () => {
        jobConfigIds = await getJobConfigIds(page, serverName, "discover");
        expect(jobConfigIds.length).toBeGreaterThan(0);
      });

      await test.step("Navigate to first discovery report", async () => {
        await navigateToDiscoveryReport(page, jobConfigIds[0]);
      });

      await test.step("Verify report header", async () => {
        await expect(
          page.getByText("Job Run Id").first()
        ).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText("Report Status").first()).toBeVisible();
        await expect(page.getByText("Scan Time").first()).toBeVisible();
        await expect(page.getByText("Scan Protocol").first()).toBeVisible();
      });

      await test.step("Verify completed status", async () => {
        await expect(page.getByText(/completed/i).first()).toBeVisible({
          timeout: 10_000,
        });
      });

      await test.step("Verify doughnut overview section", async () => {
        await expect(
          page.getByText("Total Items").first()
        ).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("Directories").first()).toBeVisible();
        await expect(page.getByText("Files").first()).toBeVisible();
      });

      await test.step("Verify space metrics", async () => {
        await expect(
          page.getByText("Total Space Used").first()
        ).toBeVisible();
        await expect(
          page.getByText("Discovered File Size").first()
        ).toBeVisible();
      });

      await test.step("Verify redirects section", async () => {
        await expect(page.getByText("Redirects").first()).toBeVisible();
        await expect(
          page.getByText("Symbolic links").first()
        ).toBeVisible();
      });

      await test.step("Verify bar charts", async () => {
        await expect(
          page.getByText("File Count and Space Used").first()
        ).toBeVisible();
        await expect(
          page.getByText("Files and Directories Depth").first()
        ).toBeVisible();
      });

      await test.step("Verify top-5 pie chart and tables", async () => {
        await expect(
          page.getByText("Top 5 File Extensions").first()
        ).toBeVisible();
        await expect(
          page.getByText("Maximum / Average").first()
        ).toBeVisible();
        await expect(
          page.getByText("Top 5 Directory Path Lengths").first()
        ).toBeVisible();
        await expect(
          page.getByText("Top 5 Biggest File Sizes").first()
        ).toBeVisible();
        await expect(
          page.getByText("Top 5 File Path Lengths").first()
        ).toBeVisible();
      });

      await test.step("Verify download report button", async () => {
        await expect(
          page.getByText("Download Discovery Report").first()
        ).toBeVisible();
        console.log("Full discovery report verification passed");
      });
    });

    // ───────────────────────────────────────────────────────────────────
    // 7. File server overview reflects discovery results
    // ───────────────────────────────────────────────────────────────────
    test("7. Verify file server overview after discovery", async ({
      page,
    }) => {
      await test.step("Navigate to file server overview", async () => {
        await safeGoto(page, `/file-server/${fileServerId}`);
        await expect(
          page.getByText("File Server Overview").first()
        ).toBeVisible({ timeout: 15_000 });
      });

      await test.step("Verify export paths table shows discovery info", async () => {
        await expect(
          page.getByText("Export Path").first()
        ).toBeVisible({ timeout: 15_000 });
        await expect(
          page.getByText("Discovery").first()
        ).toBeVisible({ timeout: 10_000 });
      });

      await test.step("Verify action buttons remain available", async () => {
        await expect(
          page.getByRole("button", { name: "Bulk Discover" })
        ).toBeEnabled({ timeout: 10_000 });
        await expect(
          page.getByRole("button", { name: "Bulk Migrate" })
        ).toBeVisible({ timeout: 10_000 });
        console.log("File server overview verified after discovery");
      });
    });
  }
);
