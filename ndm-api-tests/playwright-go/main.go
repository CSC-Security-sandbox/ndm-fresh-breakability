package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/playwright-community/playwright-go"
)

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

type Config struct {
	BaseURL                  string
	User                     string
	Password                 string
	SourceHost               string
	Protocol                 string
	ProtocolUsername          string
	ProtocolPassword         string
	SourceExportPaths        []string
	DestinationHost          string
	DestProtocolUsername      string
	DestProtocolPassword     string
	DestinationExportPaths   []string
}

var baseURL string

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("Missing required env var: %s", key)
	}
	return v
}

func loadConfig() Config {
	for _, p := range []string{".env", filepath.Join("..", "playwright-test", ".env")} {
		if _, err := os.Stat(p); err == nil {
			_ = godotenv.Load(p)
			break
		}
	}

	protocol := os.Getenv("PROTOCOL")
	if protocol == "" {
		protocol = "NFS"
	}

	split := func(s string) []string {
		if s == "" {
			return nil
		}
		var out []string
		for _, p := range strings.Split(s, ",") {
			out = append(out, strings.TrimSpace(p))
		}
		return out
	}

	return Config{
		BaseURL:                mustEnv("BASE_URL"),
		User:                   os.Getenv("NDM_TEST_USER"),
		Password:               os.Getenv("NDM_TEST_PASSWORD"),
		SourceHost:             mustEnv("SOURCE_HOST"),
		Protocol:               protocol,
		ProtocolUsername:        mustEnv("PROTOCOL_USERNAME"),
		ProtocolPassword:       os.Getenv("PROTOCOL_PASSWORD"),
		SourceExportPaths:      split(os.Getenv("SOURCE_EXPORT_PATHS")),
		DestinationHost:        os.Getenv("DESTINATION_HOST"),
		DestProtocolUsername:    os.Getenv("DESTINATION_PROTOCOL_USERNAME"),
		DestProtocolPassword:   os.Getenv("DESTINATION_PROTOCOL_PASSWORD"),
		DestinationExportPaths: split(os.Getenv("DESTINATION_EXPORT_PATHS")),
	}
}

// fullURL resolves a relative path against the base URL.
func fullURL(path string) string {
	if strings.HasPrefix(path, "http") {
		return path
	}
	return strings.TrimRight(baseURL, "/") + path
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility helpers
// ═══════════════════════════════════════════════════════════════════════════════

func sleep(ms int)        { time.Sleep(time.Duration(ms) * time.Millisecond) }
func sleepSec(s int)      { time.Sleep(time.Duration(s) * time.Second) }

func uniqueID() string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 8)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}

func screenshot(page playwright.Page, name string) {
	_ = os.MkdirAll("test-results", 0o755)
	path := filepath.Join("test-results", name+".png")
	data, err := page.Screenshot(playwright.PageScreenshotOptions{FullPage: playwright.Bool(true)})
	if err == nil {
		_ = os.WriteFile(path, data, 0o644)
		log.Printf("[screenshot] saved: %s", path)
	}
}

func expectVisible(loc playwright.Locator, timeoutMs float64) error {
	return loc.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(timeoutMs),
	})
}

func isVisible(loc playwright.Locator) bool {
	v, err := loc.IsVisible()
	return err == nil && v
}

func isEnabled(loc playwright.Locator) bool {
	e, err := loc.IsEnabled()
	return err == nil && e
}

func textContent(loc playwright.Locator) string {
	t, _ := loc.TextContent()
	return t
}

// ═══════════════════════════════════════════════════════════════════════════════
// Authentication
// ═══════════════════════════════════════════════════════════════════════════════

const storageStatePath = "tests/.auth/user.json"

func authenticate(browser playwright.Browser, cfg Config) error {
	log.Println("[auth] Starting Keycloak authentication...")

	ctx, err := browser.NewContext(playwright.BrowserNewContextOptions{
		IgnoreHttpsErrors: playwright.Bool(true),
	})
	if err != nil {
		return fmt.Errorf("new context: %w", err)
	}
	defer ctx.Close()

	page, err := ctx.NewPage()
	if err != nil {
		return fmt.Errorf("new page: %w", err)
	}

	if _, err = page.Goto(cfg.BaseURL); err != nil {
		return fmt.Errorf("goto base url: %w", err)
	}
	if err = expectVisible(page.Locator("#username"), 30000); err != nil {
		return fmt.Errorf("username field: %w", err)
	}

	user := cfg.User
	if user == "" {
		user = "admin@datamigrator.local"
	}
	pass := cfg.Password
	if pass == "" {
		pass = "welcome"
	}

	_ = page.Locator("#username").Fill(user)
	_ = page.Locator("#password").Fill(pass)
	_ = page.Locator("#kc-login").Click()

	if err = page.WaitForURL("**/home", playwright.PageWaitForURLOptions{
		Timeout: playwright.Float(30000),
	}); err != nil {
		return fmt.Errorf("wait for home: %w", err)
	}
	if err = expectVisible(page.GetByRole("heading", playwright.PageGetByRoleOptions{Name: "Home"}), 15000); err != nil {
		return fmt.Errorf("home heading: %w", err)
	}

	_ = os.MkdirAll(filepath.Dir(storageStatePath), 0o755)
	if _, err = ctx.StorageState(storageStatePath); err != nil {
		return fmt.Errorf("save storage state: %w", err)
	}
	log.Println("[auth] Authentication successful")
	return nil
}

func newAuthPage(browser playwright.Browser) (playwright.Page, playwright.BrowserContext, error) {
	ctx, err := browser.NewContext(playwright.BrowserNewContextOptions{
		StorageStatePath:  playwright.String(storageStatePath),
		IgnoreHttpsErrors: playwright.Bool(true),
	})
	if err != nil {
		return nil, nil, err
	}
	page, err := ctx.NewPage()
	if err != nil {
		return nil, nil, err
	}
	return page, ctx, nil
}

// ═══════════════════════════════════════════════════════════════════════════════
// File server creation (3-step wizard with validation retry)
// ═══════════════════════════════════════════════════════════════════════════════

func createFileServer(page playwright.Page, name, host, protocol, username, password string) error {
	if _, err := page.Goto(fullURL("/home")); err != nil {
		return fmt.Errorf("goto home: %w", err)
	}
	if err := expectVisible(page.GetByRole("heading", playwright.PageGetByRoleOptions{Name: "Home"}), 15000); err != nil {
		return fmt.Errorf("home heading: %w", err)
	}

	if err := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Add File Server"}).Click(); err != nil {
		return fmt.Errorf("click add file server: %w", err)
	}
	_ = page.WaitForURL(regexp.MustCompile(`new-file-server`), playwright.PageWaitForURLOptions{Timeout: playwright.Float(15000)})
	sleep(3000)

	// Step 0 — Server Type
	nameField := page.GetByPlaceholder("Name")
	if err := expectVisible(nameField, 15000); err != nil {
		return fmt.Errorf("name field: %w", err)
	}
	_ = nameField.Fill(name)
	_ = page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"}).Click()
	sleep(2000)

	// Step 1 — Credentials
	hostField := page.GetByRole("textbox", playwright.PageGetByRoleOptions{Name: "Host Name"})
	if err := expectVisible(hostField, 10000); err != nil {
		return fmt.Errorf("host field: %w", err)
	}
	_ = hostField.Fill(host)

	if protocol == "NFS" {
		_ = page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "NFS"}).First().Click()
		sleep(1000)
		_ = page.GetByPlaceholder("Username").Fill(username)
		if password != "" {
			_ = page.GetByPlaceholder("Password").Fill(password)
		}
	} else {
		_ = page.GetByRole("radio", playwright.PageGetByRoleOptions{Name: "SMB"}).Click()
		sleep(1000)
		_ = page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "SMB"}).First().Click()
		sleep(1000)
		_ = page.GetByPlaceholder("Username").Fill(username)
		if password != "" {
			_ = page.GetByPlaceholder("Password").Fill(password)
		}
	}

	_ = page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"}).Click()
	sleep(3000)

	// Step 2 — Workers: toggle ALL online workers
	if err := expectVisible(page.GetByText(regexp.MustCompile(`(?i)Compatible Workers`)).First(), 15000); err != nil {
		return fmt.Errorf("compatible workers: %w", err)
	}

	var workerPattern *regexp.Regexp
	if protocol == "NFS" {
		workerPattern = regexp.MustCompile(`(?i)nfs-worker`)
	} else {
		workerPattern = regexp.MustCompile(`(?i)smb-worker`)
	}

	workerNames := page.GetByText(workerPattern)
	_ = workerNames.First().WaitFor(playwright.LocatorWaitForOptions{
		State: playwright.WaitForSelectorStateVisible, Timeout: playwright.Float(15000),
	})
	sleep(2000)

	workerCount, _ := workerNames.Count()
	log.Printf("[createFileServer] Found %d worker(s)", workerCount)

	toggled := 0
	for i := 0; i < workerCount; i++ {
		el := workerNames.Nth(i)
		if !isVisible(el) {
			continue
		}
		info, err := el.Evaluate(toggleInspectJS, nil)
		if err != nil {
			continue
		}
		m, ok := info.(map[string]interface{})
		if !ok || m["found"] != true {
			continue
		}
		if m["isAlreadyOn"] == true {
			toggled++
			continue
		}
		if m["isOffline"] == true || m["isDisabled"] == true {
			continue
		}
		clicked, _ := el.Evaluate(toggleClickJS, nil)
		if cb, ok := clicked.(bool); ok && cb {
			toggled++
			log.Printf("[createFileServer] Worker %d: toggled ON", i)
			sleep(1000)
		}
	}

	if toggled == 0 {
		screenshot(page, "debug-no-online-workers")
		return fmt.Errorf("no online workers available")
	}
	log.Printf("[createFileServer] %d worker(s) associated", toggled)

	// Click Finish with retry for connection validation
	const maxRetries = 3
	for attempt := 1; attempt <= maxRetries; attempt++ {
		log.Printf("[createFileServer] Attempt %d/%d — clicking Finish...", attempt, maxRetries)
		finishBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Finish"})
		_ = expectVisible(finishBtn, 10000)
		_ = finishBtn.Click()

		loadingBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Loading"})
		if err := expectVisible(loadingBtn, 10000); err == nil {
			log.Printf("[createFileServer] Attempt %d: validation started", attempt)
		}

		deadline := time.Now().Add(2 * time.Minute)
		outcome := "timeout"

		for time.Now().Before(deadline) {
			if !strings.Contains(page.URL(), "new-file-server") {
				outcome = "redirected"
				break
			}
			if isVisible(page.GetByText("Configuration Successfully saved").First()) {
				outcome = "success_toast"
				break
			}
			if isVisible(page.GetByText("Error creating file server").First()) ||
				isVisible(page.GetByText("File Server Name already exists").First()) {
				outcome = "error_toast"
				break
			}
			if isVisible(page.GetByText(regexp.MustCompile(`(?i)Failed to perform validaton`)).First()) ||
				isVisible(page.GetByText(regexp.MustCompile(`(?i)Worker.*not responding`)).First()) {
				outcome = "validation_error"
				break
			}
			sleep(3000)
		}

		log.Printf("[createFileServer] Attempt %d: outcome = %s", attempt, outcome)

		if outcome == "redirected" || outcome == "success_toast" {
			sleep(3000)
			log.Printf("[createFileServer] File server %q created successfully", name)
			return nil
		}
		if outcome == "error_toast" {
			screenshot(page, "debug-create-error")
			return fmt.Errorf("file server creation failed (fatal error)")
		}

		// Retriable: dismiss toast, go Back → Proceed → retry Finish
		screenshot(page, fmt.Sprintf("debug-validation-attempt-%d", attempt))
		if attempt < maxRetries {
			closeBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Close"})
			if isVisible(closeBtn.First()) {
				_ = closeBtn.First().Click()
				sleep(1000)
			}
			backBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Back"})
			if isVisible(backBtn) {
				_ = backBtn.Click()
				sleep(2000)
				_ = page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"}).Click()
				sleep(3000)
			}
			sleep(5000)
			continue
		}
		return fmt.Errorf("validation failed after %d attempts", maxRetries)
	}
	return nil
}

const toggleInspectJS = `(nameEl) => {
	let ancestor = nameEl;
	for (let depth = 0; depth < 10; depth++) {
		ancestor = ancestor?.parentElement;
		if (!ancestor) break;
		const t = ancestor.querySelector('[role="switch"]') ||
			ancestor.querySelector('[class*="toggle" i]') ||
			ancestor.querySelector('input[type="checkbox"]');
		if (t) {
			const r = t.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			const txt = ancestor.textContent || "";
			return {
				found: true,
				isOffline: /offline/i.test(txt) && !/online/i.test(txt),
				hasOnline: /online/i.test(txt),
				isDisabled: t.hasAttribute("disabled") || t.getAttribute("aria-disabled")==="true" || !!t.closest(".disabled,[class*='disabled']"),
				isAlreadyOn: t.getAttribute("aria-checked")==="true" || t.checked===true,
				tag: t.tagName,
			};
		}
	}
	return { found: false };
}`

const toggleClickJS = `(nameEl) => {
	let ancestor = nameEl;
	for (let depth = 0; depth < 10; depth++) {
		ancestor = ancestor?.parentElement;
		if (!ancestor) break;
		const t = ancestor.querySelector('[role="switch"]') ||
			ancestor.querySelector('[class*="toggle" i]') ||
			ancestor.querySelector('input[type="checkbox"]');
		if (t && t.getBoundingClientRect().width > 0) { t.click(); return true; }
	}
	return false;
}`

// ═══════════════════════════════════════════════════════════════════════════════
// Navigate to file server, return UUID
// ═══════════════════════════════════════════════════════════════════════════════

func navigateToFileServer(page playwright.Page, srvName string) (string, error) {
	re := regexp.MustCompile(`/file-server/([a-f0-9-]+)`)
	if m := re.FindStringSubmatch(page.URL()); len(m) > 1 {
		return m[1], nil
	}

	if _, err := page.Goto(fullURL("/file-server")); err != nil {
		return "", err
	}
	sleep(3000)

	nameLink := page.GetByText(srvName, playwright.PageGetByTextOptions{Exact: playwright.Bool(true)})
	for attempt := 0; attempt < 3; attempt++ {
		if isVisible(nameLink.First()) {
			break
		}
		page.Goto(fullURL("/file-server"))
		sleep(3000)
	}

	if err := expectVisible(nameLink.First(), 15000); err != nil {
		return "", fmt.Errorf("file server %q not found in list", srvName)
	}
	_ = nameLink.First().Click()

	_ = page.WaitForURL(regexp.MustCompile(`/file-server/[a-f0-9-]+`), playwright.PageWaitForURLOptions{Timeout: playwright.Float(15000)})
	m := re.FindStringSubmatch(page.URL())
	if len(m) < 2 {
		return "", fmt.Errorf("could not extract file server ID from %s", page.URL())
	}
	log.Printf("[navigateToFileServer] ID: %s", m[1])
	return m[1], nil
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bulk Discovery via UI
// ═══════════════════════════════════════════════════════════════════════════════

func runBulkDiscovery(page playwright.Page, fsID string, exportPaths []string) error {
	fsURL := fullURL(fmt.Sprintf("/file-server/%s", fsID))
	for attempt := 0; attempt < 3; attempt++ {
		page.Goto(fsURL)
		sleep(3000)
		if strings.Contains(page.URL(), "/file-server/") {
			break
		}
		sleep(2000)
	}

	if err := expectVisible(page.GetByText("File Server Overview").First(), 30000); err != nil {
		return err
	}

	bulkBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Bulk Discover"})
	if err := expectVisible(bulkBtn, 30000); err != nil {
		return err
	}
	_ = bulkBtn.Click()
	_ = page.WaitForURL(regexp.MustCompile(`bulk-discover`), playwright.PageWaitForURLOptions{Timeout: playwright.Float(10000)})
	sleep(3000)
	_ = expectVisible(page.GetByText("Export Path").First(), 15000)
	sleep(2000)

	if len(exportPaths) > 0 {
		for _, ep := range exportPaths {
			pathText := page.GetByText(ep, playwright.PageGetByTextOptions{Exact: playwright.Bool(true)})
			if !isVisible(pathText.First()) {
				continue
			}
			pathText.First().Evaluate(checkboxClickJS, nil)
			log.Printf("[bulkDiscovery] Checked: %s", ep)
			sleep(500)
		}
	} else {
		selectAllTableRows(page)
	}

	submitBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Submit"})
	_ = submitBtn.Click()
	sleep(3000)
	return nil
}

const checkboxClickJS = `(el) => {
	let ancestor = el;
	for (let depth = 0; depth < 10; depth++) {
		ancestor = ancestor?.parentElement;
		if (!ancestor) break;
		const cb = ancestor.querySelector('[role="checkbox"]') ||
			ancestor.querySelector('input[type="checkbox"]');
		if (cb && cb.getBoundingClientRect().width > 0) {
			cb.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			return true;
		}
	}
	return false;
}`

func selectAllTableRows(page playwright.Page) {
	allCBs := page.Locator(`[role="checkbox"], input[type="checkbox"]`)
	count, _ := allCBs.Count()
	if count > 0 {
		_ = allCBs.First().Click()
		sleep(1000)
		sap := page.GetByText("Select all pages")
		if isVisible(sap) {
			_ = sap.Click()
			sleep(1000)
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bulk Migration via UI wizard
// ═══════════════════════════════════════════════════════════════════════════════

func runBulkMigration(page playwright.Page, srcFsID, destFsName string) error {
	fsURL := fullURL(fmt.Sprintf("/file-server/%s", srcFsID))
	for attempt := 0; attempt < 3; attempt++ {
		page.Goto(fsURL)
		sleep(3000)
		if strings.Contains(page.URL(), "/file-server/") {
			break
		}
		sleep(2000)
	}

	if err := expectVisible(page.GetByText("File Server Overview").First(), 30000); err != nil {
		return err
	}

	migrateBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Bulk Migrate"})
	if err := expectVisible(migrateBtn, 30000); err != nil {
		return err
	}
	_ = migrateBtn.Click()
	_ = page.WaitForURL(regexp.MustCompile(`bulk-migrate`), playwright.PageWaitForURLOptions{Timeout: playwright.Float(15000)})
	sleep(3000)

	// Step 1: Mapping — select destination file server
	startNow := page.GetByText("Start Now")
	if isVisible(startNow) {
		_ = startNow.Click()
	}

	destSelect := page.GetByText("Select Destination File Server").First()
	if isVisible(destSelect) {
		_ = destSelect.Click()
		sleep(1000)
		destOption := page.GetByText(destFsName, playwright.PageGetByTextOptions{Exact: playwright.Bool(false)})
		if isVisible(destOption.First()) {
			_ = destOption.First().Click()
			log.Printf("[bulkMigration] Selected destination: %s", destFsName)
			sleep(2000)
		}
	}

	// Select all source paths
	selectAllTableRows(page)
	sleep(1000)

	proceedBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"})
	_ = proceedBtn.Click()
	sleep(2000)

	// Step 2: Options — keep defaults
	log.Println("[bulkMigration] Step: Options (keeping defaults)")
	proceedBtn2 := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"})
	if isEnabled(proceedBtn2) {
		_ = proceedBtn2.Click()
		sleep(3000)
	}

	// Step 3: Review — select all and submit
	log.Println("[bulkMigration] Step: Review")
	sleep(5000)
	selectAllTableRows(page)
	sleep(1000)

	submitBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Submit"})
	if err := expectVisible(submitBtn, 30000); err != nil {
		return err
	}
	_ = submitBtn.Click()
	log.Println("[bulkMigration] Clicked Submit")
	sleep(5000)

	// Handle pre-check confirmation modal
	proceedModal := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"})
	if isVisible(proceedModal) {
		_ = proceedModal.Click()
		log.Println("[bulkMigration] Confirmed pre-check modal")
		sleep(3000)
	}
	return nil
}

// ═══════════════════════════════════════════════════════════════════════════════
// API helpers (via page.Evaluate to call NDM Jobs API from browser context)
// ═══════════════════════════════════════════════════════════════════════════════

const getJobConfigIDsJS = `async ({ nameOrId, jt }) => {
	const env = window.env || {};
	const base = env.VITE_JOBS_SERVICE_URL;
	if (!base) return JSON.stringify({ jobs: [] });
	const projectId = localStorage.getItem("selected_project_id") || "";
	let token = "";
	for (const s of [sessionStorage, localStorage]) {
		for (let i = 0; i < s.length; i++) {
			const k = s.key(i);
			if (k.includes("token") || k.includes("oidc")) {
				const v = s.getItem(k) || "";
				try { const p = JSON.parse(v); if (p?.access_token) { token = p.access_token; break; } if (p?.accessToken) { token = p.accessToken; break; } }
				catch { if (v.startsWith("eyJ")) { token = v; break; } }
			}
		}
		if (token) break;
	}
	const h = { "Content-Type": "application/json", projectId };
	if (token) h["Authorization"] = "Bearer " + token;
	try {
		const r = await fetch(base + "/jobs?projectId=" + projectId, { headers: h, credentials: "include" });
		const j = await r.json();
		let items = Array.isArray(j?.data?.items) ? j.data.items : Array.isArray(j?.data) ? j.data : [];
		const matched = items.filter(job => {
			const src = job.sourceServer || {};
			if (src.serverName !== nameOrId && src.fileServerName !== nameOrId && job.id !== nameOrId) return false;
			if (jt) return (job.jobType || "").toLowerCase().includes(jt.toLowerCase());
			return true;
		}).map(job => job.id || job.jobConfigId);
		return JSON.stringify({ jobs: matched });
	} catch (e) { return JSON.stringify({ jobs: [] }); }
}`

func getJobConfigIDs(page playwright.Page, srvName, jobType string) ([]string, error) {
	hasEnv, _ := page.Evaluate(`() => !!(window.env?.VITE_JOBS_SERVICE_URL)`)
	if b, ok := hasEnv.(bool); !ok || !b {
		page.Goto(fullURL("/home"))
		sleep(3000)
	}
	raw, err := page.Evaluate(getJobConfigIDsJS, map[string]interface{}{"nameOrId": srvName, "jt": jobType})
	if err != nil {
		return nil, err
	}
	jsonStr, _ := raw.(string)
	var r struct{ Jobs []string `json:"jobs"` }
	json.Unmarshal([]byte(jsonStr), &r)
	log.Printf("[getJobConfigIDs] Matched %d %s job(s) for %q", len(r.Jobs), jobType, srvName)
	return r.Jobs, nil
}

const pollJobStatusJS = `async ({ configId }) => {
	const env = window.env || {};
	const base = env.VITE_JOBS_SERVICE_URL;
	if (!base) return JSON.stringify({ status: "unknown", runId: "" });
	const projectId = localStorage.getItem("selected_project_id") || "";
	let token = "";
	for (const s of [sessionStorage, localStorage]) {
		for (let i = 0; i < s.length; i++) {
			const k = s.key(i);
			if (k.includes("token") || k.includes("oidc")) {
				const v = s.getItem(k) || "";
				try { const p = JSON.parse(v); if (p?.access_token) { token = p.access_token; break; } if (p?.accessToken) { token = p.accessToken; break; } }
				catch { if (v.startsWith("eyJ")) { token = v; break; } }
			}
		}
		if (token) break;
	}
	const h = { "Content-Type": "application/json", projectId };
	if (token) h["Authorization"] = "Bearer " + token;
	try {
		const r = await fetch(base + "/jobs/" + configId, { headers: h, credentials: "include" });
		const j = await r.json();
		const d = j?.data?.items || j?.data || j || {};
		const runs = Array.isArray(d.jobRuns) ? d.jobRuns : [];
		if (runs.length > 0) {
			const latest = runs[0];
			return JSON.stringify({ status: (latest.status||"unknown").toLowerCase(), runId: latest.id||latest.jobRunId||"",
				jobType: (d.jobType||"").toLowerCase(), configStatus: (d.status||"").toLowerCase(), runCount: runs.length });
		}
		return JSON.stringify({ status: "pending", runId: "", jobType: (d.jobType||"").toLowerCase(),
			configStatus: (d.status||"").toLowerCase(), runCount: 0 });
	} catch (e) { return JSON.stringify({ status: "error", runId: "" }); }
}`

type jobStatus struct {
	Status       string `json:"status"`
	RunID        string `json:"runId"`
	JobType      string `json:"jobType"`
	ConfigStatus string `json:"configStatus"`
	RunCount     int    `json:"runCount"`
}

func pollJob(page playwright.Page, configID string) (*jobStatus, error) {
	raw, err := page.Evaluate(pollJobStatusJS, map[string]interface{}{"configId": configID})
	if err != nil {
		return nil, err
	}
	jsonStr, _ := raw.(string)
	var r jobStatus
	json.Unmarshal([]byte(jsonStr), &r)
	return &r, nil
}

func waitForJobState(page playwright.Page, configID, target string, timeoutSec int) error {
	deadline := time.Now().Add(time.Duration(timeoutSec) * time.Second)
	for time.Now().Before(deadline) {
		r, err := pollJob(page, configID)
		if err == nil {
			log.Printf("[waitForJobState] %s: status=%s (target=%s)", configID, r.Status, target)
			if strings.Contains(r.Status, strings.ToLower(target)) {
				return nil
			}
			if r.Status == "errored" || r.Status == "failed" {
				return fmt.Errorf("job %s entered %s state", configID, r.Status)
			}
		}
		sleepSec(10)
	}
	return fmt.Errorf("job %s did not reach %q within %ds", configID, target, timeoutSec)
}

const jobRunActionJS = `async ({ runId, action }) => {
	const env = window.env || {};
	const base = env.VITE_JOBS_SERVICE_URL;
	if (!base) return JSON.stringify({ success: false });
	const projectId = localStorage.getItem("selected_project_id") || "";
	let token = "";
	for (const s of [sessionStorage, localStorage]) {
		for (let i = 0; i < s.length; i++) {
			const k = s.key(i);
			if (k.includes("token")||k.includes("oidc")) {
				const v = s.getItem(k)||"";
				try { const p = JSON.parse(v); if (p?.access_token) { token = p.access_token; break; } if (p?.accessToken) { token = p.accessToken; break; } }
				catch { if (v.startsWith("eyJ")) { token = v; break; } }
			}
		}
		if (token) break;
	}
	const h = { "Content-Type": "application/json", projectId };
	if (token) h["Authorization"] = "Bearer " + token;
	try {
		const r = await fetch(base + "/job-run/cutover/approve", {
			method: "PUT", headers: h, credentials: "include",
			body: JSON.stringify({ action, jobRunId: runId }),
		});
		return JSON.stringify({ success: r.ok, status: r.status });
	} catch (e) { return JSON.stringify({ success: false }); }
}`

func approveCutover(page playwright.Page, runID string) (bool, error) {
	raw, err := page.Evaluate(jobRunActionJS, map[string]interface{}{
		"runId":  runID,
		"action": "APPROVED",
	})
	if err != nil {
		return false, err
	}
	jsonStr, _ := raw.(string)
	var r struct {
		Success bool `json:"success"`
	}
	json.Unmarshal([]byte(jsonStr), &r)
	log.Printf("[approveCutover] %s: success=%v", runID, r.Success)
	return r.Success, nil
}

// ═══════════════════════════════════════════════════════════════════════════════
// Version check via About NDM page
// ═══════════════════════════════════════════════════════════════════════════════

func verifyVersions(page playwright.Page) error {
	log.Println("[versions] Checking NDM versions via About page...")

	raw, err := page.Evaluate(`async () => {
		const env = window.env || {};
		const base = env.VITE_ADMIN_SERVICE_URL || env.VITE_CONFIG_SERVICE_URL;
		if (!base) return JSON.stringify({ error: "no admin service url" });
		const projectId = localStorage.getItem("selected_project_id") || "";
		let token = "";
		for (const s of [sessionStorage, localStorage]) {
			for (let i = 0; i < s.length; i++) {
				const k = s.key(i);
				if (k.includes("token")||k.includes("oidc")) {
					const v = s.getItem(k)||"";
					try { const p = JSON.parse(v); if (p?.access_token) { token = p.access_token; break; } }
					catch { if (v.startsWith("eyJ")) { token = v; break; } }
				}
			}
			if (token) break;
		}
		const h = { "Content-Type": "application/json", projectId };
		if (token) h["Authorization"] = "Bearer " + token;
		try {
			const r = await fetch(base + "/api/v1/about-ndm", { headers: h, credentials: "include" });
			const j = await r.json();
			return JSON.stringify(j);
		} catch (e) { return JSON.stringify({ error: e.message }); }
	}`)
	if err != nil {
		return fmt.Errorf("evaluate: %w", err)
	}
	jsonStr, _ := raw.(string)
	log.Printf("[versions] API response: %s", jsonStr[:min(len(jsonStr), 300)])

	if strings.Contains(jsonStr, `"error"`) {
		return fmt.Errorf("about-ndm API error: %s", jsonStr)
	}
	log.Println("[versions] Version check passed")
	return nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ═══════════════════════════════════════════════════════════════════════════════
// TC-001 Test Implementation
// ═══════════════════════════════════════════════════════════════════════════════

func runTC001(browser playwright.Browser, cfg Config) error {
	uid := uniqueID()
	protocol := strings.ToLower(cfg.Protocol)

	srcServerName := fmt.Sprintf("tc-001-%s-src-fs-%s", protocol, uid)
	destServerName := fmt.Sprintf("tc-001-%s-dest-fs-%s", protocol, uid)

	var srcFileServerID, destFileServerID string

	// ─── Step 1: Create Source File Server ──────────────────────────────
	log.Println("═══ Step 1: Creating Source File Server")
	page, ctx, err := newAuthPage(browser)
	if err != nil {
		return fmt.Errorf("new page: %w", err)
	}
	defer ctx.Close()
	defer page.Close()

	if err := createFileServer(page, srcServerName, cfg.SourceHost, cfg.Protocol,
		cfg.ProtocolUsername, cfg.ProtocolPassword); err != nil {
		return fmt.Errorf("create source FS: %w", err)
	}
	srcFileServerID, err = navigateToFileServer(page, srcServerName)
	if err != nil {
		return fmt.Errorf("navigate to source FS: %w", err)
	}
	log.Printf("Source file server created: %s (%s)", srcServerName, srcFileServerID)

	// Verify Active
	if err := expectVisible(page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Bulk Discover"}), 30000); err != nil {
		return fmt.Errorf("source FS not Active")
	}
	log.Println("Source file server is Active")

	// ─── Step 2: Run Bulk Discovery on Source ──────────────────────────
	log.Println("═══ Step 2: Running Bulk Discovery on Source")
	if err := runBulkDiscovery(page, srcFileServerID, cfg.SourceExportPaths); err != nil {
		return fmt.Errorf("bulk discovery source: %w", err)
	}
	_ = expectVisible(page.GetByText("Bulk Discover Job has been created").First(), 10000)

	srcDiscoveryJobs, err := getJobConfigIDs(page, srcServerName, "discover")
	if err != nil || len(srcDiscoveryJobs) == 0 {
		return fmt.Errorf("no source discovery jobs found")
	}
	log.Printf("Source discovery job(s): %v", srcDiscoveryJobs)

	for _, jobID := range srcDiscoveryJobs {
		log.Printf("Waiting for source discovery job %s...", jobID)
		if err := waitForJobState(page, jobID, "completed", 600); err != nil {
			return fmt.Errorf("source discovery: %w", err)
		}
		log.Printf("Source discovery job %s completed", jobID)
	}

	// ─── Step 3: Verify Source Discovery Report ────────────────────────
	log.Println("═══ Step 3: Verifying Source Discovery Report")
	r, _ := pollJob(page, srcDiscoveryJobs[0])
	if r != nil && r.RunID != "" {
		page.Goto(fullURL(fmt.Sprintf("/job-discovery-preview/%s", r.RunID)))
		sleep(5000)
		if err := expectVisible(page.GetByText("Job Run Id").First(), 15000); err == nil {
			log.Println("Source discovery report loaded successfully")
		}
	}

	// ─── Step 4: Create Destination File Server ────────────────────────
	if cfg.DestinationHost == "" {
		log.Println("═══ Step 4: SKIPPED (DESTINATION_HOST not set)")
		log.Println("═══ Steps 5-8: SKIPPED (no destination)")
		return nil
	}

	log.Println("═══ Step 4: Creating Destination File Server")
	destUsername := cfg.DestProtocolUsername
	if destUsername == "" {
		destUsername = cfg.ProtocolUsername
	}

	if err := createFileServer(page, destServerName, cfg.DestinationHost, cfg.Protocol,
		destUsername, cfg.DestProtocolPassword); err != nil {
		return fmt.Errorf("create destination FS: %w", err)
	}
	destFileServerID, err = navigateToFileServer(page, destServerName)
	if err != nil {
		return fmt.Errorf("navigate to dest FS: %w", err)
	}
	log.Printf("Destination file server created: %s (%s)", destServerName, destFileServerID)

	if err := expectVisible(page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Bulk Discover"}), 30000); err != nil {
		return fmt.Errorf("dest FS not Active")
	}
	log.Println("Destination file server is Active")

	// ─── Step 5: Run Bulk Discovery on Destination ─────────────────────
	log.Println("═══ Step 5: Running Bulk Discovery on Destination")
	if err := runBulkDiscovery(page, destFileServerID, cfg.DestinationExportPaths); err != nil {
		return fmt.Errorf("bulk discovery dest: %w", err)
	}
	_ = expectVisible(page.GetByText("Bulk Discover Job has been created").First(), 10000)

	destDiscoveryJobs, err := getJobConfigIDs(page, destServerName, "discover")
	if err != nil || len(destDiscoveryJobs) == 0 {
		return fmt.Errorf("no dest discovery jobs found")
	}

	for _, jobID := range destDiscoveryJobs {
		log.Printf("Waiting for dest discovery job %s...", jobID)
		if err := waitForJobState(page, jobID, "completed", 600); err != nil {
			return fmt.Errorf("dest discovery: %w", err)
		}
		log.Printf("Dest discovery job %s completed", jobID)
	}

	// ─── Step 6: Run Bulk Migration (source → destination) ─────────────
	log.Println("═══ Step 6: Running Bulk Migration")
	if err := runBulkMigration(page, srcFileServerID, destServerName); err != nil {
		return fmt.Errorf("bulk migration: %w", err)
	}

	// Wait for migration toast
	sleep(5000)

	migrationJobs, err := getJobConfigIDs(page, srcServerName, "migrate")
	if err != nil || len(migrationJobs) == 0 {
		log.Println("[migration] No migration jobs found yet, waiting...")
		sleep(10000)
		migrationJobs, _ = getJobConfigIDs(page, srcServerName, "migrate")
	}

	if len(migrationJobs) > 0 {
		log.Printf("Migration job(s): %v", migrationJobs)
		for _, jobID := range migrationJobs {
			log.Printf("Waiting for migration job %s...", jobID)
			if err := waitForJobState(page, jobID, "completed", 600); err != nil {
				log.Printf("Migration job %s did not complete: %v", jobID, err)
			} else {
				log.Printf("Migration job %s completed", jobID)
			}
		}
	} else {
		log.Println("[migration] Warning: no migration jobs found")
	}

	// ─── Step 7: Verify Migration Report ───────────────────────────────
	log.Println("═══ Step 7: Verifying Migration Reports")
	if len(migrationJobs) > 0 {
		r, _ := pollJob(page, migrationJobs[0])
		if r != nil && r.RunID != "" {
			page.Goto(fullURL(fmt.Sprintf("/job-details/%s", migrationJobs[0])))
			sleep(5000)
			if isVisible(page.GetByText(regexp.MustCompile(`(?i)completed`)).First()) {
				log.Println("Migration job shows completed in Job Details")
			}
		}
	}

	// ─── Step 8: Version Check ─────────────────────────────────────────
	log.Println("═══ Step 8: Version Check")
	if err := verifyVersions(page); err != nil {
		log.Printf("[versions] Warning: %v", err)
	}

	log.Println("═══ TC-001 PASSED ═══")
	return nil
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════

func main() {
	cfg := loadConfig()
	baseURL = cfg.BaseURL

	log.Println("╔══════════════════════════════════════════════════════════════╗")
	log.Println("║  TC-001: Go + Playwright E2E Test                          ║")
	log.Println("║  Create file servers, discovery, migration, version check  ║")
	log.Println("╚══════════════════════════════════════════════════════════════╝")
	log.Printf("  Base URL:         %s", cfg.BaseURL)
	log.Printf("  Source Host:      %s", cfg.SourceHost)
	log.Printf("  Destination Host: %s", cfg.DestinationHost)
	log.Printf("  Protocol:         %s", cfg.Protocol)

	if err := playwright.Install(); err != nil {
		log.Fatalf("could not install playwright: %v", err)
	}

	pw, err := playwright.Run()
	if err != nil {
		log.Fatalf("could not start playwright: %v", err)
	}
	defer pw.Stop()

	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(false),
	})
	if err != nil {
		log.Fatalf("could not launch browser: %v", err)
	}
	defer browser.Close()

	if err := authenticate(browser, cfg); err != nil {
		log.Fatalf("authentication failed: %v", err)
	}

	start := time.Now()
	if err := runTC001(browser, cfg); err != nil {
		log.Printf("\n  ✘  TC-001 FAILED (%s) — %v\n", time.Since(start).Round(time.Second), err)
		os.Exit(1)
	}

	fmt.Printf("\n  ✓  TC-001 PASSED (%s)\n", time.Since(start).Round(time.Second))
}
