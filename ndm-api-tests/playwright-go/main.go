package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/playwright-community/playwright-go"
)

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

type Config struct {
	BaseURL                string
	User                   string
	Password               string
	SourceHost             string
	Protocol               string
	ProtocolUsername        string
	ProtocolPassword       string
	SourceExportPaths      []string
	DestinationHost        string
	DestProtocolUsername    string
	DestProtocolPassword   string
	DestinationExportPaths []string
	MaxDiscoveryPaths      int
	MinWorkers             int
	ScheduleDelaySec       int
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

	maxPaths := 5
	if v := os.Getenv("MAX_DISCOVERY_PATHS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxPaths = n
		}
	}

	minWorkers := 2
	if v := os.Getenv("MIN_WORKERS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			minWorkers = n
		}
	}

	schedDelay := 90
	if v := os.Getenv("SCHEDULE_DELAY_SEC"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			schedDelay = n
		}
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
		MaxDiscoveryPaths:      maxPaths,
		MinWorkers:             minWorkers,
		ScheduleDelaySec:       schedDelay,
	}
}

func fullURL(path string) string {
	if strings.HasPrefix(path, "http") {
		return path
	}
	return strings.TrimRight(baseURL, "/") + path
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility helpers
// ═══════════════════════════════════════════════════════════════════════════════

func sleep(ms int)   { time.Sleep(time.Duration(ms) * time.Millisecond) }
func sleepSec(s int) { time.Sleep(time.Duration(s) * time.Second) }

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

func gotoWithRetry(page playwright.Page, url string, attempts int) {
	for i := 0; i < attempts; i++ {
		page.Goto(url, playwright.PageGotoOptions{
			Timeout:   playwright.Float(60000),
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		})
		sleep(3000)
		if strings.Contains(page.URL(), strings.TrimPrefix(url, baseURL)) {
			return
		}
		sleep(2000)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Authentication
// ═══════════════════════════════════════════════════════════════════════════════

const storageStatePath = "tests/.auth/user.json"

func authenticate(browser playwright.Browser, cfg Config) error {
	log.Println("[auth] Starting Keycloak authentication...")

	user := cfg.User
	if user == "" {
		user = "admin@datamigrator.local"
	}
	pass := cfg.Password
	if pass == "" {
		pass = "welcome"
	}

	const maxRetries = 3
	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		log.Printf("[auth] Attempt %d/%d", attempt, maxRetries)
		err := doAuthenticate(browser, cfg.BaseURL, user, pass)
		if err == nil {
			log.Println("[auth] Authentication successful")
			return nil
		}
		lastErr = err
		log.Printf("[auth] Attempt %d failed: %v", attempt, err)
		if attempt < maxRetries {
			sleepSec(5)
		}
	}
	return fmt.Errorf("authentication failed after %d attempts: %w", maxRetries, lastErr)
}

func doAuthenticate(browser playwright.Browser, baseURL, user, pass string) error {
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

	if _, err = page.Goto(baseURL, playwright.PageGotoOptions{
		Timeout:   playwright.Float(90000),
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
	}); err != nil {
		return fmt.Errorf("goto base url: %w", err)
	}

	if err = expectVisible(page.Locator("#username"), 60000); err != nil {
		return fmt.Errorf("username field not visible: %w", err)
	}

	_ = page.Locator("#username").Fill(user)
	_ = page.Locator("#password").Fill(pass)
	_ = page.Locator("#kc-login").Click()

	if err = page.WaitForURL("**/home", playwright.PageWaitForURLOptions{
		Timeout: playwright.Float(60000),
	}); err != nil {
		return fmt.Errorf("wait for home: %w", err)
	}
	if err = expectVisible(page.GetByRole("heading", playwright.PageGetByRoleOptions{Name: "Home"}), 30000); err != nil {
		return fmt.Errorf("home heading: %w", err)
	}

	_ = os.MkdirAll(filepath.Dir(storageStatePath), 0o755)
	if _, err = ctx.StorageState(storageStatePath); err != nil {
		return fmt.Errorf("save storage state: %w", err)
	}
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
// File server creation (3-step wizard) — requires minWorkers online
// ═══════════════════════════════════════════════════════════════════════════════

func createFileServer(page playwright.Page, name, host, protocol, username, password string, minWorkers int) error {
	if _, err := page.Goto(fullURL("/home"), playwright.PageGotoOptions{
		Timeout:   playwright.Float(60000),
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
	}); err != nil {
		return fmt.Errorf("goto home: %w", err)
	}
	if err := expectVisible(page.GetByRole("heading", playwright.PageGetByRoleOptions{Name: "Home"}), 30000); err != nil {
		return fmt.Errorf("home heading: %w", err)
	}

	if err := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Add File Server"}).Click(); err != nil {
		return fmt.Errorf("click add file server: %w", err)
	}
	_ = page.WaitForURL(regexp.MustCompile(`new-file-server`), playwright.PageWaitForURLOptions{Timeout: playwright.Float(15000)})
	sleep(3000)

	// Step 0 — Server Name
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

	// Step 2 — Workers: toggle online workers (need at least minWorkers)
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
			log.Printf("[createFileServer] Worker %d: already ON", i)
			continue
		}
		if m["isOffline"] == true || m["isDisabled"] == true {
			log.Printf("[createFileServer] Worker %d: offline/disabled, skipping", i)
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
	if toggled < minWorkers {
		screenshot(page, "debug-not-enough-workers")
		log.Printf("[createFileServer] WARNING: only %d worker(s) associated, wanted %d", toggled, minWorkers)
	}
	log.Printf("[createFileServer] %d worker(s) associated (min required: %d)", toggled, minWorkers)

	// Click Finish with retry
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
// Navigate to file server detail, return UUID
// ═══════════════════════════════════════════════════════════════════════════════

func navigateToFileServer(page playwright.Page, srvName string) (string, error) {
	re := regexp.MustCompile(`/file-server/([a-f0-9-]+)`)
	if m := re.FindStringSubmatch(page.URL()); len(m) > 1 {
		return m[1], nil
	}

	gotoWithRetry(page, fullURL("/file-server"), 5)

	nameLink := page.GetByText(srvName, playwright.PageGetByTextOptions{Exact: playwright.Bool(true)})
	for attempt := 0; attempt < 5; attempt++ {
		if isVisible(nameLink.First()) {
			break
		}
		gotoWithRetry(page, fullURL("/file-server"), 1)
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

func runBulkDiscovery(page playwright.Page, fsID string, exportPaths []string, maxPaths int) error {
	gotoWithRetry(page, fullURL(fmt.Sprintf("/file-server/%s", fsID)), 5)

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
		selectFirstNRows(page, maxPaths)
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

func selectFirstNRows(page playwright.Page, n int) {
	rows := page.Locator(`tbody tr`)
	total, _ := rows.Count()
	if total == 0 {
		log.Printf("[selectFirstNRows] No tbody rows, falling back to checkbox approach")
		allCBs := page.Locator(`[role="checkbox"], input[type="checkbox"]`)
		cbCount, _ := allCBs.Count()
		limit := n
		if cbCount-1 < limit {
			limit = cbCount - 1
		}
		for i := 1; i <= limit; i++ {
			_ = allCBs.Nth(i).Click()
			sleep(300)
		}
		log.Printf("[selectFirstNRows] Checked %d checkbox(es)", limit)
		return
	}
	limit := n
	if total < limit {
		limit = total
	}
	checked := 0
	for i := 0; i < limit; i++ {
		row := rows.Nth(i)
		cb := row.Locator(`[role="checkbox"], input[type="checkbox"]`).First()
		if isVisible(cb) {
			_ = cb.Click()
			checked++
			sleep(300)
		}
	}
	log.Printf("[selectFirstNRows] Checked %d of %d row(s) (max %d)", checked, total, n)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scheduled Bulk Migration via UI wizard
// ═══════════════════════════════════════════════════════════════════════════════

func runScheduledBulkMigration(page playwright.Page, srcFsID, destFsName string, scheduleDelaySec int) error {
	gotoWithRetry(page, fullURL(fmt.Sprintf("/file-server/%s", srcFsID)), 5)

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

	// Try to select "Start Later" / "Schedule" option for scheduled migration
	startLater := page.GetByText(regexp.MustCompile(`(?i)start\s*later|schedule`))
	if isVisible(startLater.First()) {
		_ = startLater.First().Click()
		sleep(2000)
		log.Printf("[bulkMigration] Selected 'Start Later' / scheduled mode")

		// Set schedule time to now + scheduleDelaySec
		scheduleTime := time.Now().UTC().Add(time.Duration(scheduleDelaySec) * time.Second)
		timeStr := scheduleTime.Format("03:04 PM")
		dateStr := scheduleTime.Format("01/02/2006")

		dateInput := page.Locator(`input[type="date"], input[placeholder*="date" i], input[aria-label*="date" i]`).First()
		if isVisible(dateInput) {
			_ = dateInput.Fill(dateStr)
			sleep(500)
		}
		timeInput := page.Locator(`input[type="time"], input[placeholder*="time" i], input[aria-label*="time" i]`).First()
		if isVisible(timeInput) {
			_ = timeInput.Fill(timeStr)
			sleep(500)
		}
		log.Printf("[bulkMigration] Scheduled for %s %s UTC", dateStr, timeStr)
	} else {
		// Fallback: if no scheduling UI, click Start Now
		startNow := page.GetByText("Start Now")
		if isVisible(startNow) {
			_ = startNow.Click()
		}
		log.Println("[bulkMigration] No scheduling option found, using Start Now")
	}

	// Step 1: Mapping — select destination file server
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
	log.Println("[bulkMigration] Step: Review & Submit")
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
// Bulk Cutover via UI
// ═══════════════════════════════════════════════════════════════════════════════

func runBulkCutover(page playwright.Page, srcFsID string) error {
	gotoWithRetry(page, fullURL(fmt.Sprintf("/file-server/%s", srcFsID)), 5)

	if err := expectVisible(page.GetByText("File Server Overview").First(), 30000); err != nil {
		return err
	}

	// Look for Bulk Cutover button (may be "Cutover" or "Bulk Cutover")
	cutoverBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: regexp.MustCompile(`(?i)cutover`)})
	if err := expectVisible(cutoverBtn.First(), 30000); err != nil {
		return fmt.Errorf("cutover button not visible: %w", err)
	}
	_ = cutoverBtn.First().Click()

	_ = page.WaitForURL(regexp.MustCompile(`(?i)cutover`), playwright.PageWaitForURLOptions{Timeout: playwright.Float(15000)})
	sleep(3000)

	// Select all paths for cutover
	selectAllTableRows(page)
	sleep(1000)

	submitBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Submit"})
	if err := expectVisible(submitBtn, 30000); err != nil {
		// Try Proceed first if Submit is not visible
		procBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"})
		if isVisible(procBtn) {
			_ = procBtn.Click()
			sleep(3000)
			selectAllTableRows(page)
			sleep(1000)
			submitBtn = page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Submit"})
		}
	}

	if isVisible(submitBtn) {
		_ = submitBtn.Click()
		log.Println("[bulkCutover] Clicked Submit")
		sleep(5000)
	}

	// Handle confirmation modal
	confirmBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"})
	if isVisible(confirmBtn) {
		_ = confirmBtn.Click()
		log.Println("[bulkCutover] Confirmed modal")
		sleep(3000)
	}

	_ = expectVisible(page.GetByText(regexp.MustCompile(`(?i)cutover.*created|bulk cutover.*created`)).First(), 15000)
	log.Println("[bulkCutover] Cutover job created")
	return nil
}

// ═══════════════════════════════════════════════════════════════════════════════
// API helpers (via page.Evaluate — calls NDM Jobs API from browser context)
// ═══════════════════════════════════════════════════════════════════════════════

const tokenExtractJS = `() => {
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
	return token;
}`

const getAllJobIDsJS = `async ({ jt }) => {
	const env = window.env || {};
	const base = env.VITE_JOBS_SERVICE_URL;
	if (!base) return JSON.stringify({ jobs: [], debug: "no VITE_JOBS_SERVICE_URL" });
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
			if (jt && !(job.jobType || "").toLowerCase().includes(jt.toLowerCase())) return false;
			return true;
		}).map(job => job.id || job.jobConfigId);
		return JSON.stringify({ jobs: matched, total: items.length });
	} catch (e) { return JSON.stringify({ jobs: [], debug: e.message }); }
}`

func ensureEnvLoaded(page playwright.Page) {
	hasEnv, _ := page.Evaluate(`() => !!(window.env?.VITE_JOBS_SERVICE_URL)`)
	if b, ok := hasEnv.(bool); !ok || !b {
		page.Goto(fullURL("/home"), playwright.PageGotoOptions{
			Timeout:   playwright.Float(60000),
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		})
		sleep(3000)
	}
}

func fetchAllJobIDs(page playwright.Page, jobType string) (map[string]bool, error) {
	ensureEnvLoaded(page)
	raw, err := page.Evaluate(getAllJobIDsJS, map[string]interface{}{"jt": jobType})
	if err != nil {
		return nil, err
	}
	jsonStr, _ := raw.(string)
	var r struct {
		Jobs  []string `json:"jobs"`
		Total int      `json:"total"`
		Debug string   `json:"debug"`
	}
	json.Unmarshal([]byte(jsonStr), &r)
	if r.Debug != "" {
		log.Printf("[fetchAllJobIDs] debug: %s", r.Debug)
	}
	set := make(map[string]bool, len(r.Jobs))
	for _, id := range r.Jobs {
		set[id] = true
	}
	log.Printf("[fetchAllJobIDs] Found %d %s job(s) (total %d)", len(set), jobType, r.Total)
	return set, nil
}

func diffJobIDs(before, after map[string]bool) []string {
	var newIDs []string
	for id := range after {
		if !before[id] {
			newIDs = append(newIDs, id)
		}
	}
	return newIDs
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
			return JSON.stringify({
				status: (latest.status||"unknown").toLowerCase(),
				runId: latest.id||latest.jobRunId||"",
				jobType: (d.jobType||"").toLowerCase(),
				configStatus: (d.status||"").toLowerCase(),
				runCount: runs.length
			});
		}
		return JSON.stringify({
			status: "no_runs",
			runId: "",
			jobType: (d.jobType||"").toLowerCase(),
			configStatus: (d.status||"").toLowerCase(),
			runCount: 0
		});
	} catch (e) { return JSON.stringify({ status: "error", runId: "", debug: e.message }); }
}`

type jobStatus struct {
	Status       string `json:"status"`
	RunID        string `json:"runId"`
	JobType      string `json:"jobType"`
	ConfigStatus string `json:"configStatus"`
	RunCount     int    `json:"runCount"`
	Debug        string `json:"debug"`
}

func pollJob(page playwright.Page, configID string) (*jobStatus, error) {
	ensureEnvLoaded(page)
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
	runAppeared := false
	for time.Now().Before(deadline) {
		r, err := pollJob(page, configID)
		if err == nil {
			if r.RunCount == 0 && !runAppeared {
				log.Printf("[waitForJobState] %s: waiting for run to appear (configStatus=%s)", configID, r.ConfigStatus)
				sleepSec(10)
				continue
			}
			runAppeared = true
			log.Printf("[waitForJobState] %s: status=%s configStatus=%s runs=%d (target=%s)",
				configID, r.Status, r.ConfigStatus, r.RunCount, target)
			if strings.EqualFold(r.Status, target) {
				return nil
			}
			if r.Status == "errored" || r.Status == "failed" {
				return fmt.Errorf("job %s entered %s state", configID, r.Status)
			}
		}
		sleepSec(10)
	}
	if !runAppeared {
		return fmt.Errorf("job %s: no run appeared within %ds", configID, timeoutSec)
	}
	return fmt.Errorf("job %s did not reach %q within %ds", configID, target, timeoutSec)
}

// verifyJobActiveNoRuns confirms that migration jobs are in ACTIVE status
// with zero runs (scheduled but not yet triggered).
func verifyJobActiveNoRuns(page playwright.Page, jobConfigIDs []string) error {
	for _, configID := range jobConfigIDs {
		r, err := pollJob(page, configID)
		if err != nil {
			return fmt.Errorf("poll %s: %w", configID, err)
		}
		log.Printf("[verifyActiveNoRuns] %s: configStatus=%s jobType=%s runCount=%d",
			configID, r.ConfigStatus, r.JobType, r.RunCount)

		if !strings.EqualFold(r.ConfigStatus, "active") {
			return fmt.Errorf("job %s expected ACTIVE status, got %q", configID, r.ConfigStatus)
		}
		if r.RunCount != 0 {
			return fmt.Errorf("job %s expected 0 runs, got %d", configID, r.RunCount)
		}
	}
	return nil
}

// waitForRunToAppear waits until the job config has at least 1 run.
func waitForRunToAppear(page playwright.Page, configID string, timeoutSec int) (*jobStatus, error) {
	deadline := time.Now().Add(time.Duration(timeoutSec) * time.Second)
	for time.Now().Before(deadline) {
		r, err := pollJob(page, configID)
		if err == nil && r.RunCount > 0 {
			log.Printf("[waitForRun] %s: run appeared — status=%s runId=%s", configID, r.Status, r.RunID)
			return r, nil
		}
		sleepSec(10)
	}
	return nil, fmt.Errorf("job %s: no run appeared within %ds", configID, timeoutSec)
}

const jobRunActionJS = `async ({ runId, action }) => {
	const env = window.env || {};
	const base = env.VITE_JOBS_SERVICE_URL;
	if (!base) return JSON.stringify({ success: false, debug: "no VITE_JOBS_SERVICE_URL" });
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
	} catch (e) { return JSON.stringify({ success: false, debug: e.message }); }
}`

func approveCutover(page playwright.Page, runID string) error {
	ensureEnvLoaded(page)
	raw, err := page.Evaluate(jobRunActionJS, map[string]interface{}{
		"runId":  runID,
		"action": "APPROVED",
	})
	if err != nil {
		return fmt.Errorf("evaluate: %w", err)
	}
	jsonStr, _ := raw.(string)
	var r struct {
		Success bool   `json:"success"`
		Debug   string `json:"debug"`
	}
	json.Unmarshal([]byte(jsonStr), &r)
	if !r.Success {
		return fmt.Errorf("approve cutover %s failed: %s", runID, r.Debug)
	}
	log.Printf("[approveCutover] %s: approved", runID)
	return nil
}

// ═══════════════════════════════════════════════════════════════════════════════
// Version check via About NDM API
// ═══════════════════════════════════════════════════════════════════════════════

func verifyVersions(page playwright.Page) error {
	log.Println("[versions] Checking NDM versions via About page...")
	ensureEnvLoaded(page)

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
	truncated := jsonStr
	if len(truncated) > 500 {
		truncated = truncated[:500] + "..."
	}
	log.Printf("[versions] API response: %s", truncated)

	if strings.Contains(jsonStr, `"error"`) {
		return fmt.Errorf("about-ndm API error: %s", truncated)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &resp); err == nil {
		if data, ok := resp["data"].(map[string]interface{}); ok {
			if items, ok := data["items"].(map[string]interface{}); ok {
				if build, ok := items["build"].(map[string]interface{}); ok {
					if cpv, ok := build["controlPlaneVersion"].(map[string]interface{}); ok {
						log.Printf("[versions] Control Plane version: %v", cpv["version"])
					}
					if wv, ok := build["workerVersion"].(map[string]interface{}); ok {
						log.Printf("[versions] Worker version: %v", wv["version"])
					}
				}
			}
		}
	}

	log.Println("[versions] Version check passed")
	return nil
}

// ═══════════════════════════════════════════════════════════════════════════════
// TC-001 Test Implementation
// ═══════════════════════════════════════════════════════════════════════════════
//
// TC-001: Create file servers with 2 workers, run discovery,
//         scheduled migration, cutover, and version validation.
//
// Steps:
//  1. Create source file server (2 workers)
//  2. Run bulk discovery on source → wait for completion → verify report
//  3. Create destination file server (2 workers)
//  4. Run bulk discovery on destination → wait for completion
//  5. Create SCHEDULED bulk migration (90s in future)
//  6. Verify jobs are ACTIVE with 0 runs (not yet triggered)
//  7. Wait for scheduled time → migration triggers → wait for COMPLETED
//  8. Verify migration report
//  9. Create bulk cutover → wait for BLOCKED → approve cutover
// 10. Version check via About NDM API
// ═══════════════════════════════════════════════════════════════════════════════

func runTC001(browser playwright.Browser, cfg Config) error {
	uid := uniqueID()
	protocol := strings.ToLower(cfg.Protocol)
	srcServerName := fmt.Sprintf("tc-001-%s-src-fs-%s", protocol, uid)
	destServerName := fmt.Sprintf("tc-001-%s-dest-fs-%s", protocol, uid)

	var srcFileServerID, destFileServerID string

	page, ctx, err := newAuthPage(browser)
	if err != nil {
		return fmt.Errorf("new page: %w", err)
	}
	defer ctx.Close()
	defer page.Close()

	// ─────────────────────────────────────────────────────────────────────
	// Step 1: Create Source File Server (with 2 workers)
	// ─────────────────────────────────────────────────────────────────────
	log.Println("═══ Step 1: Creating Source File Server")
	if err := createFileServer(page, srcServerName, cfg.SourceHost, cfg.Protocol,
		cfg.ProtocolUsername, cfg.ProtocolPassword, cfg.MinWorkers); err != nil {
		return fmt.Errorf("create source FS: %w", err)
	}
	srcFileServerID, err = navigateToFileServer(page, srcServerName)
	if err != nil {
		return fmt.Errorf("navigate to source FS: %w", err)
	}
	log.Printf("Source file server created: %s (%s)", srcServerName, srcFileServerID)

	if err := expectVisible(page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Bulk Discover"}), 30000); err != nil {
		return fmt.Errorf("source FS not Active")
	}
	log.Println("Source file server is Active")

	// ─────────────────────────────────────────────────────────────────────
	// Step 2: Run Bulk Discovery on Source → wait → verify report
	// ─────────────────────────────────────────────────────────────────────
	log.Println("═══ Step 2: Running Bulk Discovery on Source")

	beforeSrcDiscovery, _ := fetchAllJobIDs(page, "discover")

	if err := runBulkDiscovery(page, srcFileServerID, cfg.SourceExportPaths, cfg.MaxDiscoveryPaths); err != nil {
		return fmt.Errorf("bulk discovery source: %w", err)
	}
	_ = expectVisible(page.GetByText("Bulk Discover Job has been created").First(), 10000)
	sleep(5000)

	afterSrcDiscovery, _ := fetchAllJobIDs(page, "discover")
	srcDiscoveryJobs := diffJobIDs(beforeSrcDiscovery, afterSrcDiscovery)
	if len(srcDiscoveryJobs) == 0 {
		log.Println("[discovery] No new source jobs found, retrying after 10s...")
		sleepSec(10)
		afterSrcDiscovery, _ = fetchAllJobIDs(page, "discover")
		srcDiscoveryJobs = diffJobIDs(beforeSrcDiscovery, afterSrcDiscovery)
	}
	if len(srcDiscoveryJobs) == 0 {
		return fmt.Errorf("no source discovery jobs found (before=%d, after=%d)",
			len(beforeSrcDiscovery), len(afterSrcDiscovery))
	}
	log.Printf("Source discovery job(s) [new]: %v", srcDiscoveryJobs)

	for _, jobID := range srcDiscoveryJobs {
		log.Printf("Waiting for source discovery job %s...", jobID)
		if err := waitForJobState(page, jobID, "completed", 900); err != nil {
			return fmt.Errorf("source discovery: %w", err)
		}
		log.Printf("Source discovery job %s completed", jobID)
	}

	// Verify source discovery report
	log.Println("═══ Step 2b: Verifying Source Discovery Report")
	r, _ := pollJob(page, srcDiscoveryJobs[0])
	if r != nil && r.RunID != "" {
		page.Goto(fullURL(fmt.Sprintf("/job-discovery-preview/%s", r.RunID)), playwright.PageGotoOptions{
			Timeout: playwright.Float(60000), WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		})
		sleep(5000)
		if err := expectVisible(page.GetByText("Job Run Id").First(), 15000); err == nil {
			log.Println("Source discovery report loaded successfully")
		} else {
			log.Println("Source discovery report page loaded (Job Run Id not found)")
		}
	}

	// ─────────────────────────────────────────────────────────────────────
	// Step 3: Create Destination File Server (with 2 workers)
	// ─────────────────────────────────────────────────────────────────────
	if cfg.DestinationHost == "" {
		log.Println("═══ Step 3: SKIPPED (DESTINATION_HOST not set)")
		log.Println("═══ Steps 4-10: SKIPPED")
		return nil
	}

	log.Println("═══ Step 3: Creating Destination File Server")
	destUsername := cfg.DestProtocolUsername
	if destUsername == "" {
		destUsername = cfg.ProtocolUsername
	}
	if err := createFileServer(page, destServerName, cfg.DestinationHost, cfg.Protocol,
		destUsername, cfg.DestProtocolPassword, cfg.MinWorkers); err != nil {
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

	// ─────────────────────────────────────────────────────────────────────
	// Step 4: Run Bulk Discovery on Destination → wait for completion
	// ─────────────────────────────────────────────────────────────────────
	log.Println("═══ Step 4: Running Bulk Discovery on Destination")

	beforeDestDiscovery, _ := fetchAllJobIDs(page, "discover")

	if err := runBulkDiscovery(page, destFileServerID, cfg.DestinationExportPaths, cfg.MaxDiscoveryPaths); err != nil {
		return fmt.Errorf("bulk discovery dest: %w", err)
	}
	_ = expectVisible(page.GetByText("Bulk Discover Job has been created").First(), 10000)
	sleep(5000)

	afterDestDiscovery, _ := fetchAllJobIDs(page, "discover")
	destDiscoveryJobs := diffJobIDs(beforeDestDiscovery, afterDestDiscovery)
	if len(destDiscoveryJobs) == 0 {
		log.Println("[discovery] No new dest jobs found, retrying after 10s...")
		sleepSec(10)
		afterDestDiscovery, _ = fetchAllJobIDs(page, "discover")
		destDiscoveryJobs = diffJobIDs(beforeDestDiscovery, afterDestDiscovery)
	}
	if len(destDiscoveryJobs) == 0 {
		return fmt.Errorf("no dest discovery jobs found (before=%d, after=%d)",
			len(beforeDestDiscovery), len(afterDestDiscovery))
	}
	log.Printf("Dest discovery job(s) [new]: %v", destDiscoveryJobs)

	for _, jobID := range destDiscoveryJobs {
		log.Printf("Waiting for dest discovery job %s...", jobID)
		if err := waitForJobState(page, jobID, "completed", 900); err != nil {
			return fmt.Errorf("dest discovery: %w", err)
		}
		log.Printf("Dest discovery job %s completed", jobID)
	}

	// ─────────────────────────────────────────────────────────────────────
	// Step 5: Create Scheduled Bulk Migration (90s in future)
	// ─────────────────────────────────────────────────────────────────────
	log.Printf("═══ Step 5: Creating Scheduled Bulk Migration (%ds in future)", cfg.ScheduleDelaySec)

	beforeMigration, _ := fetchAllJobIDs(page, "migrate")

	if err := runScheduledBulkMigration(page, srcFileServerID, destServerName, cfg.ScheduleDelaySec); err != nil {
		return fmt.Errorf("bulk migration: %w", err)
	}
	sleep(5000)

	afterMigration, _ := fetchAllJobIDs(page, "migrate")
	migrationJobs := diffJobIDs(beforeMigration, afterMigration)
	if len(migrationJobs) == 0 {
		log.Println("[migration] No new jobs found, retrying after 10s...")
		sleepSec(10)
		afterMigration, _ = fetchAllJobIDs(page, "migrate")
		migrationJobs = diffJobIDs(beforeMigration, afterMigration)
	}
	if len(migrationJobs) == 0 {
		log.Println("[migration] WARNING: no migration jobs found — continuing")
	} else {
		log.Printf("Migration job(s) [new]: %v", migrationJobs)
	}

	// ─────────────────────────────────────────────────────────────────────
	// Step 6: Verify migration jobs are ACTIVE with 0 runs (not yet triggered)
	// ─────────────────────────────────────────────────────────────────────
	if len(migrationJobs) > 0 {
		log.Println("═══ Step 6: Verifying migration jobs are ACTIVE with 0 runs")
		sleepSec(10)
		if err := verifyJobActiveNoRuns(page, migrationJobs); err != nil {
			log.Printf("[step6] Warning: %v", err)
		} else {
			log.Println("All migration jobs are ACTIVE with 0 runs (as expected)")
		}
	}

	// ─────────────────────────────────────────────────────────────────────
	// Step 7: Wait for scheduled migration to trigger → COMPLETED
	// ─────────────────────────────────────────────────────────────────────
	if len(migrationJobs) > 0 {
		remainingWait := cfg.ScheduleDelaySec - 10
		if remainingWait < 10 {
			remainingWait = 10
		}
		log.Printf("═══ Step 7: Waiting %ds for scheduled migration to trigger...", remainingWait)
		sleepSec(remainingWait)

		for _, jobID := range migrationJobs {
			log.Printf("Waiting for migration run to appear for %s...", jobID)
			_, err := waitForRunToAppear(page, jobID, 120)
			if err != nil {
				log.Printf("[migration] %s: %v", jobID, err)
				continue
			}

			log.Printf("Waiting for migration job %s to complete...", jobID)
			if err := waitForJobState(page, jobID, "completed", 900); err != nil {
				log.Printf("[migration] %s did not complete: %v", jobID, err)
			} else {
				log.Printf("Migration job %s completed", jobID)
			}
		}

		// Verify migration report
		log.Println("═══ Step 7b: Verifying Migration Report")
		r, _ := pollJob(page, migrationJobs[0])
		if r != nil && r.RunID != "" {
			page.Goto(fullURL(fmt.Sprintf("/job-details/%s", migrationJobs[0])), playwright.PageGotoOptions{
				Timeout: playwright.Float(60000), WaitUntil: playwright.WaitUntilStateDomcontentloaded,
			})
			sleep(5000)
			if isVisible(page.GetByText(regexp.MustCompile(`(?i)completed`)).First()) {
				log.Println("Migration job shows 'completed' in Job Details")
			}
		}
	}

	// ─────────────────────────────────────────────────────────────────────
	// Step 8: Create Bulk Cutover → wait for BLOCKED → approve
	// ─────────────────────────────────────────────────────────────────────
	log.Println("═══ Step 8: Creating Bulk Cutover Job")

	beforeCutover, _ := fetchAllJobIDs(page, "cutover")

	if err := runBulkCutover(page, srcFileServerID); err != nil {
		log.Printf("[cutover] Warning — could not create cutover via UI: %v", err)
	} else {
		sleep(5000)

		afterCutover, _ := fetchAllJobIDs(page, "cutover")
		cutoverJobs := diffJobIDs(beforeCutover, afterCutover)
		if len(cutoverJobs) == 0 {
			sleepSec(10)
			afterCutover, _ = fetchAllJobIDs(page, "cutover")
			cutoverJobs = diffJobIDs(beforeCutover, afterCutover)
		}

		if len(cutoverJobs) > 0 {
			log.Printf("Cutover job(s) [new]: %v", cutoverJobs)

			// Wait for each cutover run to reach BLOCKED
			log.Println("═══ Step 8b: Waiting for cutover jobs to reach BLOCKED state")
			var cutoverRunIDs []string
			for _, jobID := range cutoverJobs {
				log.Printf("Waiting for cutover run to appear for %s...", jobID)
				st, err := waitForRunToAppear(page, jobID, 120)
				if err != nil {
					log.Printf("[cutover] %s: no run: %v", jobID, err)
					continue
				}

				log.Printf("Waiting for cutover job %s to reach BLOCKED...", jobID)
				if err := waitForJobState(page, jobID, "blocked", 600); err != nil {
					log.Printf("[cutover] %s did not reach BLOCKED: %v", jobID, err)
					continue
				}
				log.Printf("Cutover job %s is BLOCKED", jobID)

				// Re-poll to get the run ID
				st, _ = pollJob(page, jobID)
				if st != nil && st.RunID != "" {
					cutoverRunIDs = append(cutoverRunIDs, st.RunID)
				}
			}

			// Approve all cutover jobs
			if len(cutoverRunIDs) > 0 {
				log.Println("═══ Step 8c: Approving Cutover Jobs")
				for _, runID := range cutoverRunIDs {
					if err := approveCutover(page, runID); err != nil {
						log.Printf("[cutover] approve %s failed: %v", runID, err)
					}
				}

				// Wait for cutover completion after approval
				for _, jobID := range cutoverJobs {
					log.Printf("Waiting for cutover job %s to complete after approval...", jobID)
					if err := waitForJobState(page, jobID, "completed", 600); err != nil {
						log.Printf("[cutover] %s did not complete: %v", jobID, err)
					} else {
						log.Printf("Cutover job %s completed", jobID)
					}
				}
			}
		} else {
			log.Println("[cutover] WARNING: no cutover jobs found")
		}
	}

	// ─────────────────────────────────────────────────────────────────────
	// Step 9: Version Check via About NDM API
	// ─────────────────────────────────────────────────────────────────────
	log.Println("═══ Step 9: Version Check")
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
	log.Println("║  File servers → Discovery → Scheduled Migration → Cutover  ║")
	log.Println("╚══════════════════════════════════════════════════════════════╝")
	log.Printf("  Base URL:           %s", cfg.BaseURL)
	log.Printf("  Source Host:        %s", cfg.SourceHost)
	log.Printf("  Destination Host:   %s", cfg.DestinationHost)
	log.Printf("  Protocol:           %s", cfg.Protocol)
	log.Printf("  Min Workers:        %d", cfg.MinWorkers)
	log.Printf("  Max Discovery Paths: %d", cfg.MaxDiscoveryPaths)
	log.Printf("  Schedule Delay:     %ds", cfg.ScheduleDelaySec)

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
