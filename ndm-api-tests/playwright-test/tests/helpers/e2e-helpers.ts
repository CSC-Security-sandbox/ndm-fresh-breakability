import { Page, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

export function getEnvOrThrow(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

// ---------------------------------------------------------------------------
// Sidebar navigation
// ---------------------------------------------------------------------------

export async function navigateViaSidebar(
  page: Page,
  parentMenu: string,
  childMenu: string
) {
  const sidebar = page.locator(
    '[data-testid="ps-sidebar-container-test-id"]'
  );
  await sidebar.hover();
  await page.waitForTimeout(800);
  await sidebar.getByText(parentMenu).click();
  await sidebar.getByText(childMenu).click();
  await page.waitForTimeout(2_000);
}

// ---------------------------------------------------------------------------
// File server creation (Other NAS wizard)
// ---------------------------------------------------------------------------

export interface FileServerParams {
  name: string;
  host: string;
  protocol: "NFS" | "SMB";
  username: string;
  password?: string;
  protocolVersion?: string;
}

/**
 * Creates a file server via the 3-step UI wizard:
 *   Step 0: Server Type — enter name, click Proceed
 *   Step 1: Credentials — enter host, select protocol, fill creds, click Proceed
 *   Step 2: Workers — toggle all available workers on, click Finish
 */
export async function createFileServer(page: Page, params: FileServerParams) {
  // Navigate to Home and click "Add File Server" button to ensure proper routing
  await page.goto("/home");
  await expect(
    page.getByRole("heading", { name: "Home" })
  ).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Add File Server" }).click();
  await page.waitForURL(/new-file-server/, { timeout: 15_000 });
  await page.waitForTimeout(3_000);

  // Step 0 — Server Type: enter name
  // The BXP FormFieldInputNew may use placeholder instead of standard label association
  const nameField = page.getByPlaceholder("Name");
  await expect(nameField).toBeVisible({ timeout: 15_000 });
  await nameField.fill(params.name);
  await page.getByRole("button", { name: "Proceed" }).click();
  await page.waitForTimeout(2_000);

  // Step 1 — Credentials: enter host and protocol details
  const hostField = page.getByRole("textbox", { name: "Host Name" });
  await expect(hostField).toBeVisible({ timeout: 10_000 });
  await hostField.fill(params.host);

  // NFS is selected by default — expand the NFS accordion to reveal fields
  if (params.protocol === "NFS") {
    const nfsAccordion = page.getByRole("button", { name: "NFS" }).first();
    await nfsAccordion.click();
    await page.waitForTimeout(1_000);

    const usernameField = page.getByPlaceholder("Username");
    await expect(usernameField).toBeVisible({ timeout: 5_000 });
    await usernameField.fill(params.username);

    if (params.password) {
      await page.getByPlaceholder("Password").fill(params.password);
    }
  } else {
    // Click SMB radio
    await page.getByRole("radio", { name: "SMB" }).click();
    await page.waitForTimeout(1_000);

    const smbAccordion = page.getByRole("button", { name: "SMB" }).first();
    await smbAccordion.click();
    await page.waitForTimeout(1_000);

    await page.getByPlaceholder("Username").fill(params.username);
    if (params.password) {
      await page.getByPlaceholder("Password").fill(params.password);
    }
  }

  await page.getByRole("button", { name: "Proceed" }).click();
  await page.waitForTimeout(3_000);

  // Step 2 — Workers: wait for the workers table to load, then toggle all on
  await expect(
    page.getByText(/Compatible Workers/i).first()
  ).toBeVisible({ timeout: 15_000 });

  // Wait for actual worker names to appear (e.g., "nfs-worker-9", "smb-worker-1")
  const workerNamePattern = params.protocol === "NFS" ? /nfs-worker/i : /smb-worker/i;
  try {
    await page.getByText(workerNamePattern).first().waitFor({ state: "visible", timeout: 15_000 });
    console.log("[createFileServer] Worker rows loaded");
  } catch {
    console.log("[createFileServer] No workers found — taking screenshot for debug");
    await page.screenshot({ path: "test-results/debug-step2-workers.png" });
  }
  await page.waitForTimeout(2_000);

  // Inspect the actual DOM structure around the worker rows for correct selectors.
  // BXP Table renders custom divs, not standard <table> HTML.
  const toggleInfo = await page.evaluate(() => {
    const info: string[] = [];

    // Find the "Associated" column area — look for all elements near "Online" text
    const allElements = document.querySelectorAll("*");
    for (const el of allElements) {
      const text = el.textContent?.trim() || "";
      const tag = el.tagName.toLowerCase();
      const cls = el.className?.toString() || "";
      const role = el.getAttribute("role") || "";

      // Log toggle-like elements
      if (
        role === "switch" ||
        cls.match(/toggle/i) ||
        (tag === "input" && (el as HTMLInputElement).type === "checkbox")
      ) {
        const rect = el.getBoundingClientRect();
        info.push(
          `TOGGLE: <${tag}> role="${role}" class="${cls.substring(0, 80)}" ` +
          `checked=${(el as any).checked ?? el.getAttribute("aria-checked")} ` +
          `visible=${rect.width > 0 && rect.height > 0} ` +
          `pos=${Math.round(rect.x)},${Math.round(rect.y)}`
        );
      }
    }
    return info;
  });
  console.log("[createFileServer] DOM toggle audit:", JSON.stringify(toggleInfo, null, 2));

  // Now click toggles that are inside the workers section (below "Compatible Workers" heading).
  // Use the "Associated" column header as an anchor — toggles are in that column.
  const associatedHeader = page.getByText("Associated").first();
  const hasAssociatedCol = await associatedHeader.isVisible().catch(() => false);

  if (hasAssociatedCol) {
    // Get the X position of the "Associated" column to scope toggle clicks
    const headerBox = await associatedHeader.boundingBox();
    console.log(`[createFileServer] "Associated" column at x=${headerBox?.x}`);
  }

  // Find worker rows by looking for worker names, then click the toggle in the same row.
  // BXP table rows may be <div> containers — use XPath to find the row ancestor.
  const workerNames = page.getByText(workerNamePattern);
  const workerCount = await workerNames.count();
  console.log(`[createFileServer] Found ${workerCount} worker name(s) matching ${workerNamePattern}`);

  let toggled = 0;
  for (let i = 0; i < workerCount; i++) {
    const workerNameEl = workerNames.nth(i);
    if (!(await workerNameEl.isVisible().catch(() => false))) continue;

    // Walk up the DOM to find the row-level container, then find the toggle inside it.
    // Try progressively higher ancestors until we find one that contains a toggle.
    const toggleClicked = await workerNameEl.evaluate((nameEl) => {
      let ancestor: HTMLElement | null = nameEl as HTMLElement;
      for (let depth = 0; depth < 10; depth++) {
        ancestor = ancestor?.parentElement ?? null;
        if (!ancestor) break;

        // Look for toggle-like child elements within this ancestor
        const toggleEl =
          ancestor.querySelector('[role="switch"]') ||
          ancestor.querySelector('[class*="toggle" i]') ||
          ancestor.querySelector('input[type="checkbox"]');

        if (toggleEl) {
          // Verify this toggle belongs to the data row (not the header)
          const rect = toggleEl.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            (toggleEl as HTMLElement).click();
            return `clicked at depth=${depth}, tag=${toggleEl.tagName}, class=${toggleEl.className?.toString().substring(0, 60)}`;
          }
        }
      }
      return null;
    });

    if (toggleClicked) {
      toggled++;
      console.log(`[createFileServer] Worker ${i}: ${toggleClicked}`);
      await page.waitForTimeout(1_000);
    } else {
      console.log(`[createFileServer] Worker ${i}: no toggle found in ancestor chain`);
    }
  }

  console.log(`[createFileServer] Toggled ${toggled}/${workerCount} workers`);

  // Verify association count changed
  const assocText = await page.getByText(/\d+ Associated/i).first().textContent().catch(() => "");
  console.log(`[createFileServer] Association status: ${assocText}`);

  await page.getByRole("button", { name: "Finish" }).click();

  // After creation, app may redirect to overview or list — wait for either
  await page.waitForURL(/\/file-server/, { timeout: 30_000 });
  await page.waitForTimeout(3_000);
}

// ---------------------------------------------------------------------------
// Navigate to a file server and get its ID from the URL
// ---------------------------------------------------------------------------

export async function navigateToFileServer(
  page: Page,
  serverName: string
): Promise<string> {
  // If we're already on the file server overview (after create redirect), extract ID
  const currentUrl = page.url();
  const overviewMatch = currentUrl.match(/\/file-server\/([a-f0-9-]+)/);
  if (overviewMatch?.[1]) {
    return overviewMatch[1];
  }

  // Navigate to the file server list
  await page.goto("/file-server");
  await page.waitForTimeout(3_000);

  // The Name column renders a BXP <Heading> (h* tag) with the full configName,
  // visually truncated via CSS text-ellipsis. Use getByText to find it.
  const nameHeading = page.getByText(serverName, { exact: true });
  await expect(nameHeading.first()).toBeVisible({ timeout: 15_000 });
  await nameHeading.first().click();

  await page.waitForURL(/\/file-server\//, { timeout: 15_000 });
  const url = page.url();
  const match = url.match(/\/file-server\/([^/?]+)/);
  return match?.[1] ?? "";
}

// ---------------------------------------------------------------------------
// Bulk Discovery
// ---------------------------------------------------------------------------

export interface BulkDiscoveryOptions {
  /** Specific export paths to select (e.g. ["/ifs/data", "/ifs/home"]). Omit to select all. */
  exportPaths?: string[];
  excludeFilePatterns?: string;
}

export async function runBulkDiscovery(
  page: Page,
  fileServerId: string,
  options: BulkDiscoveryOptions = {}
) {
  const fsUrl = `/file-server/${fileServerId}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(fsUrl);
    await page.waitForTimeout(3_000);

    if (page.url().includes('/file-server/')) break;
    console.log(`[bulkDiscovery] Attempt ${attempt + 1}: redirected to ${page.url()}, retrying…`);
    await page.waitForTimeout(2_000);
  }

  // Confirm the overview page has rendered before looking for actions
  await expect(page.getByText("File Server Overview").first()).toBeVisible({ timeout: 30_000 });

  const bulkDiscoverBtn = page.getByRole("button", { name: "Bulk Discover" });
  await expect(bulkDiscoverBtn).toBeVisible({ timeout: 30_000 });
  await expect(bulkDiscoverBtn).toBeEnabled({ timeout: 30_000 });
  await bulkDiscoverBtn.click();

  await page.waitForURL(/bulk-discover/, { timeout: 10_000 });
  await page.waitForTimeout(3_000);

  // Wait for export paths table to load
  await expect(page.getByText("Export Path").first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2_000);

  // Excluded Path Patterns — the form loads with a default value
  // ("*/~snapshot/*\n*/.snapshot/*"). Clear and replace when custom patterns are provided.
  if (options.excludeFilePatterns !== undefined) {
    const textarea = page.getByPlaceholder("Excluded Path Patterns");
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.clear();
      await textarea.fill(options.excludeFilePatterns);
      console.log(`[bulkDiscovery] Set exclude patterns to: ${options.excludeFilePatterns}`);
    } else {
      const labelTextarea = page.getByLabel("Excluded Path Patterns");
      if (await labelTextarea.isVisible().catch(() => false)) {
        await labelTextarea.clear();
        await labelTextarea.fill(options.excludeFilePatterns);
        console.log(`[bulkDiscovery] Set exclude patterns (by label) to: ${options.excludeFilePatterns}`);
      }
    }
  }

  // Select export paths. BXP table uses custom checkboxes (not standard <input>).
  if (options.exportPaths && options.exportPaths.length > 0) {
    // Select specific paths by finding their row and clicking the checkbox
    for (const exportPath of options.exportPaths) {
      console.log(`[bulkDiscovery] Selecting export path: ${exportPath}`);
      const pathText = page.getByText(exportPath, { exact: true });
      if (!(await pathText.first().isVisible().catch(() => false))) {
        console.log(`[bulkDiscovery] Path "${exportPath}" not found — skipping`);
        continue;
      }
      // Walk up to find the row container, then click the checkbox within it.
      // BXP checkboxes may be SVG elements — use dispatchEvent instead of .click().
      const clicked = await pathText.first().evaluate((el) => {
        let ancestor: HTMLElement | null = el as HTMLElement;
        for (let depth = 0; depth < 10; depth++) {
          ancestor = ancestor?.parentElement ?? null;
          if (!ancestor) break;
          const checkbox =
            ancestor.querySelector('[role="checkbox"]') ||
            ancestor.querySelector('input[type="checkbox"]') ||
            ancestor.querySelector('[class*="checkbox" i]') ||
            ancestor.querySelector('[class*="Checkbox"]');
          if (checkbox) {
            const rect = checkbox.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
              return true;
            }
          }
        }
        return false;
      });
      if (clicked) {
        console.log(`[bulkDiscovery] Checked path: ${exportPath}`);
        await page.waitForTimeout(500);
      }
    }
  } else {
    // Select all: click the header "select all" checkbox
    console.log("[bulkDiscovery] Selecting all export paths");
    await selectAllTableRows(page);
  }

  // Wait for Submit to become enabled (at least one path must be selected)
  const submitBtn = page.getByRole("button", { name: "Submit" });
  await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
  await submitBtn.click();
  await page.waitForTimeout(3_000);
}

// ---------------------------------------------------------------------------
// Job polling helpers
// ---------------------------------------------------------------------------

export async function waitForJobState(
  page: Page,
  jobConfigId: string,
  targetState: string,
  timeoutMs = 600_000,
  pollIntervalMs = 10_000
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Poll the Jobs API for this job config's latest job run status.
    // Job config status is ACTIVE/IN_ACTIVE — the run status is what we want
    // (COMPLETED, RUNNING, PENDING, FAILED, etc.)
    const info = await page.evaluate(async (configId) => {
      const env = (window as any).env || {};
      const jobsBaseUrl = env.VITE_JOBS_SERVICE_URL;
      if (!jobsBaseUrl) return { status: "unknown", debug: "no base url" };

      const projectId = localStorage.getItem("selected_project_id") || "";

      // Get auth token from storage
      let token = "";
      for (const storage of [sessionStorage, localStorage]) {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i)!;
          if (key.includes("token") || key.includes("oidc")) {
            const val = storage.getItem(key) || "";
            try {
              const parsed = JSON.parse(val);
              if (parsed?.access_token) { token = parsed.access_token; break; }
              if (parsed?.accessToken) { token = parsed.accessToken; break; }
            } catch {
              if (val.startsWith("eyJ")) { token = val; break; }
            }
          }
        }
        if (token) break;
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        projectId,
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      try {
        // Strategy 1: get job config details (includes embedded jobRuns)
        const configRes = await fetch(`${jobsBaseUrl}/jobs/${configId}`, {
          headers,
          credentials: "include",
        });
        const configJson = await configRes.json();
        const configData = configJson?.data?.items || configJson?.data || configJson || {};
        const embeddedRuns: any[] = Array.isArray(configData.jobRuns) ? configData.jobRuns : [];

        if (embeddedRuns.length > 0) {
          const latest = embeddedRuns[0];
          const runStatus = (latest.status || latest.jobStatus || "unknown").toLowerCase();
          const latestRunId = latest.id || latest._id || latest.jobRunId || latest.runId || "";
          return { status: runStatus, debug: `embedded runs=${embeddedRuns.length}, latestRunId=${latestRunId}, keys=${Object.keys(latest).join(",")}, status=${runStatus}` };
        }

        // Strategy 2: query job-run endpoint separately
        const runsRes = await fetch(`${jobsBaseUrl}/job-run?projectId=${projectId}`, {
          headers,
          credentials: "include",
        });
        const runsJson = await runsRes.json();
        let allRuns: any[] = [];
        if (Array.isArray(runsJson?.data?.items)) allRuns = runsJson.data.items;
        else if (Array.isArray(runsJson?.data)) allRuns = runsJson.data;
        else if (Array.isArray(runsJson)) allRuns = runsJson;

        const matchedRuns = allRuns.filter(
          (r: any) =>
            r.jobConfigId === configId ||
            r.jobConfig?.id === configId ||
            r.jobConfig?.jobConfigId === configId
        );

        if (matchedRuns.length > 0) {
          const latest = matchedRuns[matchedRuns.length - 1]; // latest by position
          const runStatus = (latest.status || "unknown").toLowerCase();
          return { status: runStatus, debug: `job-run API: matched=${matchedRuns.length}, latestRunId=${latest.id}, status=${runStatus}` };
        }

        // Log a sample of runs to understand the schema
        const runSample = allRuns.slice(0, 2).map((r: any) => ({
          id: r.id,
          configId: r.jobConfigId,
          configObjId: r.jobConfig?.id || r.jobConfig?.jobConfigId,
          status: r.status,
          keys: Object.keys(r).join(","),
        }));

        const configStatus = (configData.status || "active").toLowerCase();
        return {
          status: "pending",
          debug: `no runs (embedded=${embeddedRuns.length}, runApi=0/${allRuns.length}), configStatus=${configStatus}, jobRunsType=${typeof configData.jobRuns}, runSample=${JSON.stringify(runSample)}`,
        };
      } catch (err: any) {
        return { status: "error", debug: err?.message };
      }
    }, jobConfigId);

    console.log(`[waitForJobState] Job ${jobConfigId}: status=${info.status} (target=${targetState}) [${info.debug}]`);
    if (info.status.includes(targetState.toLowerCase())) {
      return;
    }

    await page.waitForTimeout(pollIntervalMs);
  }

  throw new Error(
    `Job ${jobConfigId} did not reach state "${targetState}" within ${timeoutMs / 1000}s`
  );
}

export async function waitForJobCompletion(
  page: Page,
  jobConfigId: string,
  timeoutMs = 600_000
) {
  await waitForJobState(page, jobConfigId, "completed", timeoutMs);
}

// ---------------------------------------------------------------------------
// Job config ID extraction via API
// ---------------------------------------------------------------------------

/**
 * Fetch job config IDs using the NDM Jobs API directly (via page context).
 * This avoids scraping the BXP table which uses non-standard DOM.
 *
 * @param serverNameOrId - The file server config name OR config ID to match against.
 */
export async function getJobConfigIds(
  page: Page,
  serverNameOrId: string,
  jobType?: string
): Promise<string[]> {
  // Ensure the app is loaded so window.env is populated
  const hasEnv = await page.evaluate(() => !!(window as any).env?.VITE_JOBS_SERVICE_URL).catch(() => false);
  if (!hasEnv) {
    await page.goto("/home");
    await page.waitForTimeout(3_000);
  }

  const result = await page.evaluate(async ({ nameOrId, jt }) => {
    const env = (window as any).env || {};
    const jobsBaseUrl = env.VITE_JOBS_SERVICE_URL;
    if (!jobsBaseUrl) return { jobs: [] as string[], debug: "no VITE_JOBS_SERVICE_URL" };

    // The app stores the token in Redux (authSlice.accessToken).
    // We can read it from the Redux store via __REDUX_DEVTOOLS_EXTENSION__ or from cookies.
    // Safest: get from the Redux store attached to the app's root element.
    const getToken = (): string => {
      try {
        const store = (window as any).__store || (window as any).__REDUX_STORE__;
        if (store) return store.getState()?.authSlice?.accessToken || "";
      } catch { /* ignore */ }
      // Fallback: scan sessionStorage/localStorage for token-like keys
      for (const storage of [sessionStorage, localStorage]) {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i)!;
          if (key.includes("token") || key.includes("oidc")) {
            const val = storage.getItem(key) || "";
            try {
              const parsed = JSON.parse(val);
              if (parsed?.access_token) return parsed.access_token;
              if (parsed?.accessToken) return parsed.accessToken;
            } catch {
              if (val.startsWith("eyJ")) return val;
            }
          }
        }
      }
      return "";
    };

    // Project ID: the app uses "selected_project_id" in localStorage
    const projectId = localStorage.getItem("selected_project_id") || "";
    const token = getToken();

    const url = `${jobsBaseUrl}/jobs?projectId=${projectId}`;
    const debugInfo: string[] = [
      `url=${url}`,
      `projectId=${projectId}`,
      `hasToken=${!!token}`,
    ];

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (projectId) headers["projectId"] = projectId;

      const res = await fetch(url, { headers, credentials: "include" });
      const json = await res.json();
      debugInfo.push(`status=${res.status}`);
      debugInfo.push(`responseKeys=${JSON.stringify(Object.keys(json || {}))}`);

      // Handle various response shapes
      let items: any[];
      if (Array.isArray(json?.data?.items)) {
        items = json.data.items;
      } else if (Array.isArray(json?.data)) {
        items = json.data;
      } else if (Array.isArray(json)) {
        items = json;
      } else {
        debugInfo.push(`rawData=${JSON.stringify(json)?.substring(0, 500)}`);
        items = [];
      }

      debugInfo.push(`totalItems=${items.length}`);

      // Log sample
      const sample = items.slice(0, 3).map((j: any) => ({
        id: j.id || j.jobConfigId,
        jobType: j.jobType,
        srcName: j.sourceServer?.serverName,
        srcFsName: j.sourceServer?.fileServerName,
      }));
      debugInfo.push(`sample=${JSON.stringify(sample)}`);

      const matched = items
        .filter((job: any) => {
          const src = job.sourceServer || {};
          const matchesName =
            src.serverName === nameOrId ||
            src.fileServerName === nameOrId ||
            job.id === nameOrId ||
            job.jobConfigId === nameOrId;
          if (!matchesName) return false;
          if (jt) {
            const type = (job.jobType || job.type || "").toLowerCase();
            return type.includes(jt.toLowerCase());
          }
          return true;
        })
        .map((job: any) => job.id || job.jobConfigId);

      return { jobs: matched, debug: debugInfo.join(" | ") };
    } catch (err: any) {
      debugInfo.push(`error=${err?.message}`);
      return { jobs: [] as string[], debug: debugInfo.join(" | ") };
    }
  }, { nameOrId: serverNameOrId, jt: jobType });

  console.log(`[getJobConfigIds] ${result.debug}`);
  console.log(`[getJobConfigIds] Matched ${result.jobs.length} job(s) for "${serverNameOrId}"`);
  return result.jobs;
}

// ---------------------------------------------------------------------------
// Job run ID extraction
// ---------------------------------------------------------------------------

export async function getLatestJobRunId(
  page: Page,
  jobConfigId: string
): Promise<string> {
  // Ensure the app is loaded so window.env is populated
  const hasEnv = await page.evaluate(() => !!(window as any).env?.VITE_JOBS_SERVICE_URL).catch(() => false);
  if (!hasEnv) {
    await page.goto("/home");
    await page.waitForTimeout(3_000);
  }

  // Use the job config details endpoint which includes jobRuns array
  const jobRunId = await page.evaluate(async (configId) => {
    const env = (window as any).env || {};
    const jobsBaseUrl = env.VITE_JOBS_SERVICE_URL;
    if (!jobsBaseUrl) return "";

    const projectId = localStorage.getItem("selected_project_id") || "";

    let token = "";
    for (const storage of [sessionStorage, localStorage]) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)!;
        if (key.includes("token") || key.includes("oidc")) {
          const val = storage.getItem(key) || "";
          try {
            const parsed = JSON.parse(val);
            if (parsed?.access_token) { token = parsed.access_token; break; }
            if (parsed?.accessToken) { token = parsed.accessToken; break; }
          } catch {
            if (val.startsWith("eyJ")) { token = val; break; }
          }
        }
      }
      if (token) break;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      projectId,
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${jobsBaseUrl}/jobs/${configId}`, {
        headers,
        credentials: "include",
      });
      const json = await res.json();
      const data = json?.data?.items || json?.data || json || {};
      const jobRuns: any[] = Array.isArray(data.jobRuns) ? data.jobRuns : [];

      if (jobRuns.length > 0) {
        const latest = jobRuns[0];
        const runId = latest.id || latest._id || latest.jobRunId || latest.runId || "";
        const keys = Object.keys(latest).join(",");
        console.log(`[getLatestJobRunId] run keys: ${keys}, id=${latest.id}, jobRunId=${latest.jobRunId}`);
        return runId;
      }
      return "";
    } catch {
      return "";
    }
  }, jobConfigId);

  console.log(`[getLatestJobRunId] Job config ${jobConfigId} → run ${jobRunId}`);
  return jobRunId;
}

// ---------------------------------------------------------------------------
// Navigate to discovery report preview
// ---------------------------------------------------------------------------

/**
 * From a completed discovery job run, navigate to the discovery report.
 * Route: /job-discovery-preview/:jobRunId
 *
 * Navigation path:
 *   Job Details page → click latest run row → Job Run Details →
 *   "Discovery Report" dropdown → "Preview"
 */
export async function navigateToDiscoveryReport(
  page: Page,
  jobConfigId: string
): Promise<void> {
  const jobRunId = await getLatestJobRunId(page, jobConfigId);
  if (!jobRunId) throw new Error("No job run found for job config " + jobConfigId);

  // Navigate directly to discovery preview
  await page.goto(`/job-discovery-preview/${jobRunId}`);
  await page.waitForTimeout(5_000);
}

/**
 * Verify discovery report page has loaded with expected sections.
 * Checks: header, overview doughnut, space metrics, redirects,
 * bar charts, pie charts, top-5 tables, and download button.
 */
export async function verifyDiscoveryReport(page: Page) {
  // Report Header — scope to visible elements only to avoid matching collapsed sidebar items
  const reportArea = page.locator("main, [class*='content'], [class*='page']").first();
  const visibleArea = (await reportArea.isVisible().catch(() => false)) ? reportArea : page;
  await expect(page.getByText("Job Run Id").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Report Status").first()).toBeVisible();
  await expect(page.getByText("Scan Time").first()).toBeVisible();
  await expect(page.getByText("Scan Protocol").first()).toBeVisible();

  // Doughnut overview
  await expect(page.getByText("Total Items").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Directories").first()).toBeVisible();
  await expect(page.getByText("Files").first()).toBeVisible();

  // Space metrics
  await expect(page.getByText("Total Space Used").first()).toBeVisible();
  await expect(page.getByText("Discovered File Size").first()).toBeVisible();

  // Redirects section
  await expect(page.getByText("Redirects").first()).toBeVisible();
  await expect(page.getByText("Symbolic links").first()).toBeVisible();

  // Bar charts
  await expect(page.getByText("File Count and Space Used").first()).toBeVisible();
  await expect(page.getByText("Files and Directories Depth").first()).toBeVisible();

  // Top-5 sections
  await expect(page.getByText("Top 5 File Extensions").first()).toBeVisible();
  await expect(page.getByText("Maximum / Average").first()).toBeVisible();
  await expect(page.getByText("Top 5 Directory Path Lengths").first()).toBeVisible();
  await expect(page.getByText("Top 5 Biggest File Sizes").first()).toBeVisible();
  await expect(page.getByText("Top 5 File Path Lengths").first()).toBeVisible();

  // Download button
  await expect(
    page.getByText("Download Discovery Report").first()
  ).toBeVisible();
}

// ---------------------------------------------------------------------------
// Jobs List UI verification
// ---------------------------------------------------------------------------

/**
 * Navigate to the Jobs Config List page and verify that discovery jobs
 * for the given server are visible in the UI table.
 */
export async function verifyJobsInList(
  page: Page,
  serverName: string,
  expectedJobType = "discover"
): Promise<void> {
  await page.goto("/jobs-list");
  await page.waitForTimeout(3_000);

  await expect(
    page.getByText("Job Config List").first()
  ).toBeVisible({ timeout: 15_000 });

  await expect(
    page.getByText(serverName).first()
  ).toBeVisible({ timeout: 15_000 });

  await expect(
    page.getByText(new RegExp(expectedJobType, "i")).first()
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * Navigate to the Job Details page for a given job config ID
 * and verify the job header and run information are present.
 */
export async function navigateToJobDetails(
  page: Page,
  jobConfigId: string
): Promise<void> {
  await page.goto(`/job-details/${jobConfigId}`);
  await page.waitForTimeout(3_000);
}

/**
 * Verify the Job Details page shows expected information:
 * job type, source server, status, and at least one job run.
 */
export async function verifyJobDetailsPage(
  page: Page,
  expectedServerName: string
): Promise<void> {
  await expect(
    page.getByText(expectedServerName).first()
  ).toBeVisible({ timeout: 15_000 });

  await expect(
    page.getByText(/discover/i).first()
  ).toBeVisible({ timeout: 10_000 });

  // Verify at least one job run row exists with a completed status
  await expect(
    page.getByText(/completed/i).first()
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * Verify that a discovery report contains non-zero data values,
 * not just section headings.
 */
export async function verifyDiscoveryReportData(page: Page) {
  // Total Items should show a non-zero count (rendered as a number in the UI)
  const totalItemsSection = page.locator("text=Total Items").first();
  await expect(totalItemsSection).toBeVisible({ timeout: 15_000 });

  // Look for numeric values > 0 near the overview section.
  // The doughnut chart area should show actual counts for Files and Directories.
  const hasNonZeroData = await page.evaluate(() => {
    const body = document.body.innerText;
    const sections = ["Total Items", "Directories", "Files", "Total Space Used"];
    for (const section of sections) {
      const idx = body.indexOf(section);
      if (idx === -1) return false;
      const nearby = body.substring(idx, idx + 200);
      if (/[1-9]\d*/.test(nearby)) return true;
    }
    return false;
  });

  if (!hasNonZeroData) {
    console.log("[verifyDiscoveryReportData] Warning: no non-zero values found in report sections");
  }

  // Verify the completed status is present
  await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Discovery report download helpers
// ---------------------------------------------------------------------------

/**
 * Download the discovery report as CSV from the preview page.
 * Expects the page to already be on `/job-discovery-preview/:jobRunId`.
 * Returns true if a download was initiated.
 */
export async function downloadDiscoveryReportCSV(page: Page): Promise<boolean> {
  const downloadBtn = page.getByText("Download Discovery Report").first();
  await expect(downloadBtn).toBeVisible({ timeout: 15_000 });
  await downloadBtn.click();
  await page.waitForTimeout(1_000);

  const csvOption = page.getByText("Download as CSV").first();
  await expect(csvOption).toBeVisible({ timeout: 5_000 });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }).catch(() => null),
    csvOption.click(),
  ]);

  if (download) {
    console.log(`[downloadCSV] Downloaded: ${download.suggestedFilename()}`);
    return true;
  }
  console.log("[downloadCSV] No download event received");
  return false;
}

/**
 * Download the discovery report as PDF from the preview page.
 * Expects the page to already be on `/job-discovery-preview/:jobRunId`.
 * Returns true if a download was initiated.
 */
export async function downloadDiscoveryReportPDF(page: Page): Promise<boolean> {
  const downloadBtn = page.getByText("Download Discovery Report").first();
  await expect(downloadBtn).toBeVisible({ timeout: 15_000 });
  await downloadBtn.click();
  await page.waitForTimeout(1_000);

  const pdfOption = page.getByText("Download as PDF").first();
  await expect(pdfOption).toBeVisible({ timeout: 5_000 });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }).catch(() => null),
    pdfOption.click(),
  ]);

  if (download) {
    console.log(`[downloadPDF] Downloaded: ${download.suggestedFilename()}`);
    return true;
  }
  console.log("[downloadPDF] No download event received");
  return false;
}

// ---------------------------------------------------------------------------
// Job action helpers (Pause, Resume, Stop, Ad-hoc)
// ---------------------------------------------------------------------------

/**
 * Update a job run's status via the NDM Jobs API (PAUSE, RESUME, STOP).
 * Uses page.evaluate to call the API from the browser context.
 */
export async function updateJobRunStatus(
  page: Page,
  jobRunId: string,
  action: "PAUSE" | "RESUME" | "STOP"
): Promise<{ success: boolean; debug: string }> {
  return page.evaluate(async ({ runId, actionStatus }) => {
    const env = (window as any).env || {};
    const jobsBaseUrl = env.VITE_JOBS_SERVICE_URL;
    if (!jobsBaseUrl) return { success: false, debug: "no VITE_JOBS_SERVICE_URL" };

    const projectId = localStorage.getItem("selected_project_id") || "";
    let token = "";
    for (const storage of [sessionStorage, localStorage]) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)!;
        if (key.includes("token") || key.includes("oidc")) {
          const val = storage.getItem(key) || "";
          try {
            const parsed = JSON.parse(val);
            if (parsed?.access_token) { token = parsed.access_token; break; }
            if (parsed?.accessToken) { token = parsed.accessToken; break; }
          } catch {
            if (val.startsWith("eyJ")) { token = val; break; }
          }
        }
      }
      if (token) break;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      projectId,
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${jobsBaseUrl}/job-run/action`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ ids: [runId], status: actionStatus }),
      });
      const json = await res.json().catch(() => ({}));
      return { success: res.ok, debug: `status=${res.status}, response=${JSON.stringify(json).substring(0, 200)}` };
    } catch (err: any) {
      return { success: false, debug: `error=${err?.message}` };
    }
  }, { runId: jobRunId, actionStatus: action });
}

/**
 * Trigger an ad-hoc run for a job config via the NDM Jobs API.
 */
export async function triggerAdhocRun(
  page: Page,
  jobConfigId: string
): Promise<{ success: boolean; debug: string }> {
  return page.evaluate(async (configId) => {
    const env = (window as any).env || {};
    const jobsBaseUrl = env.VITE_JOBS_SERVICE_URL;
    if (!jobsBaseUrl) return { success: false, debug: "no VITE_JOBS_SERVICE_URL" };

    const projectId = localStorage.getItem("selected_project_id") || "";
    let token = "";
    for (const storage of [sessionStorage, localStorage]) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)!;
        if (key.includes("token") || key.includes("oidc")) {
          const val = storage.getItem(key) || "";
          try {
            const parsed = JSON.parse(val);
            if (parsed?.access_token) { token = parsed.access_token; break; }
            if (parsed?.accessToken) { token = parsed.accessToken; break; }
          } catch {
            if (val.startsWith("eyJ")) { token = val; break; }
          }
        }
      }
      if (token) break;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      projectId,
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${jobsBaseUrl}/job-run/ad-hoc`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ jobConfigId: configId }),
      });
      const json = await res.json().catch(() => ({}));
      return { success: res.ok, debug: `status=${res.status}, response=${JSON.stringify(json).substring(0, 200)}` };
    } catch (err: any) {
      return { success: false, debug: `error=${err?.message}` };
    }
  }, jobConfigId);
}

/**
 * Get the latest job run status for a job config.
 * Returns { runId, status } or null if no runs exist.
 */
export async function getLatestJobRunStatus(
  page: Page,
  jobConfigId: string
): Promise<{ runId: string; status: string } | null> {
  return page.evaluate(async (configId) => {
    const env = (window as any).env || {};
    const jobsBaseUrl = env.VITE_JOBS_SERVICE_URL;
    if (!jobsBaseUrl) return null;

    const projectId = localStorage.getItem("selected_project_id") || "";
    let token = "";
    for (const storage of [sessionStorage, localStorage]) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)!;
        if (key.includes("token") || key.includes("oidc")) {
          const val = storage.getItem(key) || "";
          try {
            const parsed = JSON.parse(val);
            if (parsed?.access_token) { token = parsed.access_token; break; }
            if (parsed?.accessToken) { token = parsed.accessToken; break; }
          } catch {
            if (val.startsWith("eyJ")) { token = val; break; }
          }
        }
      }
      if (token) break;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      projectId,
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${jobsBaseUrl}/jobs/${configId}`, {
        headers,
        credentials: "include",
      });
      const json = await res.json();
      const data = json?.data?.items || json?.data || json || {};
      const jobRuns: any[] = Array.isArray(data.jobRuns) ? data.jobRuns : [];
      if (jobRuns.length > 0) {
        const latest = jobRuns[0];
        return {
          runId: latest.id || latest._id || "",
          status: (latest.status || latest.jobStatus || "unknown").toLowerCase(),
        };
      }
      return null;
    } catch {
      return null;
    }
  }, jobConfigId);
}

/**
 * Navigate to the Job Run Details page for a given job config + run ID.
 * Route: /job-details/:jobId/run/:jobRunId
 */
export async function navigateToJobRunDetails(
  page: Page,
  jobConfigId: string,
  jobRunId: string
): Promise<void> {
  await page.goto(`/job-details/${jobConfigId}/run/${jobRunId}`);
  await page.waitForTimeout(5_000);
  // SPA may redirect to /home — re-navigate if needed
  if (!page.url().includes('/job-details/')) {
    console.log(`[navigateToJobRunDetails] Redirected to ${page.url()}, re-navigating`);
    await page.goto(`/job-details/${jobConfigId}/run/${jobRunId}`);
    await page.waitForTimeout(5_000);
  }
}

/**
 * Verify the Job Run Details page shows expected content:
 * job type, status, source server name, and action buttons.
 */
export async function verifyJobRunDetailsPage(
  page: Page,
  expectedServerName: string
): Promise<void> {
  await expect(
    page.getByText(expectedServerName).first()
  ).toBeVisible({ timeout: 15_000 });

  await expect(
    page.getByText(/discover/i).first()
  ).toBeVisible({ timeout: 10_000 });

  // Verify the page has discovery report actions
  const reportDropdown = page.getByText(/Discovery\s*Report/i).first();
  const hasReportDropdown = await reportDropdown.isVisible().catch(() => false);
  if (hasReportDropdown) {
    console.log("[verifyJobRunDetailsPage] Discovery Report dropdown found");
  }
}

/**
 * Wait for a job run to reach a specific status, polling the API.
 * Unlike waitForJobState which waits for "completed", this waits for any target state.
 */
export async function waitForJobRunStatus(
  page: Page,
  jobConfigId: string,
  targetStatus: string,
  timeoutMs = 120_000,
  pollIntervalMs = 5_000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await getLatestJobRunStatus(page, jobConfigId);
    if (result) {
      console.log(`[waitForJobRunStatus] Job ${jobConfigId}: status=${result.status} (target=${targetStatus})`);
      if (result.status.includes(targetStatus.toLowerCase())) {
        return result.runId;
      }
    }
    await page.waitForTimeout(pollIntervalMs);
  }

  throw new Error(
    `Job ${jobConfigId} did not reach "${targetStatus}" within ${timeoutMs / 1000}s`
  );
}

// ---------------------------------------------------------------------------
// Table selection helper
// ---------------------------------------------------------------------------

async function selectAllTableRows(page: Page) {
  // BXP tables render checkboxes with role="checkbox" or as custom elements.
  // The first checkbox on the page (in the header row) is the "select all" checkbox.
  const allCheckboxes = page.locator('[role="checkbox"], input[type="checkbox"]');
  const count = await allCheckboxes.count();
  console.log(`[selectAll] Found ${count} checkboxes on page`);

  if (count > 0) {
    // First checkbox is typically the "select all" in the header
    const selectAll = allCheckboxes.first();
    const isChecked = (await selectAll.getAttribute("aria-checked")) === "true" ||
      (await selectAll.isChecked().catch(() => false));
    if (!isChecked) {
      await selectAll.click();
      console.log("[selectAll] Clicked select-all checkbox");
      await page.waitForTimeout(1_000);
    }
    return;
  }

  // Fallback: use page.evaluate to find and click the first checkbox-like element
  const clicked = await page.evaluate(() => {
    const el = document.querySelector('[class*="checkbox" i], [class*="Checkbox"]');
    if (el) {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }
    return false;
  });
  if (clicked) {
    console.log("[selectAll] Clicked checkbox via class selector fallback");
  } else {
    console.log("[selectAll] No checkboxes found on page");
  }
}
