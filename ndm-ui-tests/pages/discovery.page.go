package pages

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"

	"ndm-ui-tests/config"

	"github.com/playwright-community/playwright-go"
)

// checkboxClickJS walks up from the matched element to find and click
// the nearest checkbox (role="checkbox" or input[type="checkbox"]).
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

// readStatusFromPageJS queries the DOM for status text rendered by
// JobRunStatusCellRenderer (.capitalize class with lowercase text) or
// raw uppercase status enums.
const readStatusFromPageJS = `() => {
	const known = ['running','completed','errored','failed','paused','pausing',
	               'stopped','stopping','ready','pending','blocked'];
	const caps = document.querySelectorAll('.capitalize');
	for (const el of caps) {
		const t = el.textContent.trim().toLowerCase();
		if (known.includes(t)) return t.toUpperCase();
	}
	for (const s of ['ERRORED','COMPLETED','RUNNING','FAILED','PAUSED',
	                  'STOPPED','PAUSING','STOPPING','READY','PENDING','BLOCKED']) {
		const el = document.evaluate(
			'//*[normalize-space(text())="' + s + '"]',
			document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
		).singleNodeValue;
		if (el && el.getBoundingClientRect().height > 0) return s;
	}
	return '';
}`

// DiscoveryPage models the NDM Bulk Discovery flow.
type DiscoveryPage struct {
	page playwright.Page
}

func NewDiscoveryPage(page playwright.Page) *DiscoveryPage {
	return &DiscoveryPage{page: page}
}

// ── Navigation ───────────────────────────────────────────────────────────────

func (p *DiscoveryPage) gotoWithRetry(url string, retries int) {
	for i := 0; i < retries; i++ {
		_, err := p.page.Goto(url, playwright.PageGotoOptions{
			WaitUntil: playwright.WaitUntilStateCommit,
			Timeout:   playwright.Float(60000),
		})
		if err == nil {
			return
		}
		p.sleep(2000)
	}
}

// WaitForExportPathInOverview navigates to the file server overview page and
// polls until the specified export path appears in the export-paths table.
//
// On each iteration it also hits the NDM refresh API so NDM re-queries the
// NFS host — this bridges the gap between "API says volume exists" (fast) and
// "Bulk Discover form shows it" (needs NFS export to actually propagate).
//
// Between attempts it reloads the overview page so the table is re-rendered.
// Timeout: up to 20 × 15 s = 5 minutes.
func (p *DiscoveryPage) WaitForExportPathInOverview(fsID, exportPath, bearerToken, baseURL string) error {
	const maxAttempts = 20
	variants := nameVariants(exportPath)

	refreshURL := fmt.Sprintf("%s/api/v1/servers/refresh/%s", baseURL, fsID)
	overviewURL := fmt.Sprintf("%s/file-server/%s", config.BaseURL, fsID)

	httpClient := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec
		},
	}

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		// Trigger NDM to re-query the NFS host.
		if req, err := http.NewRequest("GET", refreshURL, nil); err == nil {
			req.Header.Set("Authorization", "Bearer "+bearerToken)
			resp, _ := httpClient.Do(req)
			if resp != nil {
				resp.Body.Close()
			}
		}

		// Navigate to the overview page so the table is freshly rendered.
		_, _ = p.page.Goto(overviewURL, playwright.PageGotoOptions{
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
			Timeout:   playwright.Float(30000),
		})
		p.sleep(3000) // let the React table render

		// Check whether any variant of the path is visible in the table.
		for _, v := range variants {
			loc := p.page.GetByText(v, playwright.PageGetByTextOptions{
				Exact: playwright.Bool(false),
			}).First()
			if p.isVisible(loc) {
				log.Printf("[WaitForExportPathInOverview] found %q on attempt %d", exportPath, attempt)
				return nil
			}
		}

		log.Printf("[WaitForExportPathInOverview] %q not in overview table (attempt %d/%d) — waiting 15s…",
			exportPath, attempt, maxAttempts)
		p.sleep(15000)
	}

	return fmt.Errorf("export path %q not visible in file server overview after %d attempts",
		exportPath, maxAttempts)
}

// NavigateToFileServerOverview opens the file server overview page.
func (p *DiscoveryPage) NavigateToFileServerOverview(fileServerID string) error {
	url := fmt.Sprintf("%s/file-server/%s", config.BaseURL, fileServerID)

	for attempt := 1; attempt <= 3; attempt++ {
		p.gotoWithRetry(url, 2)
		err := p.expectVisible(
			p.page.GetByText("File Server Overview").First(), 30000,
		)
		if err == nil {
			return nil
		}
		log.Printf("[NavigateToFileServerOverview] attempt %d: overview not visible, retrying…", attempt)
		p.sleep(3000)
	}
	return fmt.Errorf("File Server Overview did not appear after 3 attempts")
}

// OpenBulkDiscoverForm clicks "Bulk Discover" and waits for the form URL.
func (p *DiscoveryPage) OpenBulkDiscoverForm() error {
	bulkBtn := p.page.GetByRole("button", playwright.PageGetByRoleOptions{
		Name: "Bulk Discover",
	})
	if err := p.expectVisible(bulkBtn, 30000); err != nil {
		return fmt.Errorf("Bulk Discover button not visible: %w", err)
	}
	if err := bulkBtn.Click(); err != nil {
		return fmt.Errorf("click Bulk Discover: %w", err)
	}

	if err := p.page.WaitForURL(regexp.MustCompile(`bulk-discover`), playwright.PageWaitForURLOptions{
		Timeout: playwright.Float(10000),
	}); err != nil {
		return fmt.Errorf("did not navigate to bulk-discover: %w", err)
	}
	p.sleep(3000)

	if err := p.expectVisible(
		p.page.GetByText("Export Path").First(), 15000,
	); err != nil {
		return fmt.Errorf("Export Path table did not appear: %w", err)
	}
	p.sleep(2000)
	return nil
}

// IsBulkDiscoverEnabled returns whether "Bulk Discover" button is enabled.
func (p *DiscoveryPage) IsBulkDiscoverEnabled() (bool, error) {
	btn := p.page.GetByRole("button", playwright.PageGetByRoleOptions{
		Name: "Bulk Discover",
	})
	if !p.isVisible(btn) {
		return false, nil
	}
	disabled, err := btn.IsDisabled()
	if err != nil {
		return false, err
	}
	return !disabled, nil
}

// NavigateToJobConfigList opens /jobs-list (Job Config List tab).
func (p *DiscoveryPage) NavigateToJobConfigList(sourceConfigName string) error {
	url := fmt.Sprintf("%s/jobs-list?source=%s&type=DISCOVER", config.BaseURL, sourceConfigName)
	p.gotoWithRetry(url, 3)

	if err := p.page.WaitForURL(regexp.MustCompile(`jobs-list`), playwright.PageWaitForURLOptions{
		Timeout: playwright.Float(30000),
	}); err != nil {
		return fmt.Errorf("jobs-list URL did not load: %w", err)
	}
	p.sleep(3000)
	return nil
}

// NavigateToJobRunList opens /jobs-run-list (Job Run List tab).
func (p *DiscoveryPage) NavigateToJobRunList() error {
	url := fmt.Sprintf("%s/jobs-run-list", config.BaseURL)
	p.gotoWithRetry(url, 3)

	if err := p.page.WaitForURL(regexp.MustCompile(`jobs-run-list`), playwright.PageWaitForURLOptions{
		Timeout: playwright.Float(30000),
	}); err != nil {
		return fmt.Errorf("jobs-run-list URL did not load: %w", err)
	}
	p.sleep(3000)

	// Wait for the table header to render.
	if err := p.expectVisible(
		p.page.GetByText("Job Run ID").First(), 15000,
	); err != nil {
		p.sleep(3000)
	}
	return nil
}

// NavigateToJobsList is an alias kept for backward compat — goes to config list.
func (p *DiscoveryPage) NavigateToJobsList(sourceConfigName string) error {
	return p.NavigateToJobConfigList(sourceConfigName)
}

// ClickRefreshIcon clicks the refresh/reload icon button on the current page.
func (p *DiscoveryPage) ClickRefreshIcon() {
	refreshSelectors := []string{
		`button[aria-label*="refresh" i]`,
		`button[aria-label*="reload" i]`,
		`button:has(svg[data-testid*="refresh" i])`,
		`button:has(svg[data-testid*="Refresh" i])`,
	}
	for _, sel := range refreshSelectors {
		btn := p.page.Locator(sel).First()
		if p.isVisible(btn) {
			_ = btn.Click()
			p.sleep(2000)
			return
		}
	}
	// Fallback: look for icon buttons in the table header area.
	if btns, err := p.page.Locator(`button:has(svg)`).All(); err == nil && len(btns) > 1 {
		for _, btn := range btns {
			if p.isVisible(btn) {
				_ = btn.Click()
				p.sleep(2000)
				return
			}
		}
	}
}

// ── Bulk Discovery Form ─────────────────────────────────────────────────────

// SelectProtocol picks "NFS" or "SMB" from the protocol dropdown.
func (p *DiscoveryPage) SelectProtocol(protocol string) error {
	p.sleep(500)

	alreadySelected := p.isVisible(
		p.page.Locator(fmt.Sprintf(
			`xpath=//*[contains(text(),"Select Protocol")]/following::*[normalize-space(text())="%s"]`,
			protocol,
		)).First(),
	)
	if alreadySelected {
		return nil
	}

	triggerSelectors := []string{
		`xpath=//*[contains(text(),"Select Protocol")]/following::*[normalize-space(text())="NFS" or normalize-space(text())="SMB" or contains(text(),"Select")][1]`,
		`[role="combobox"]`,
		`[name="protocol"]`,
	}

	var clicked bool
	for _, sel := range triggerSelectors {
		loc := p.page.Locator(sel).First()
		if !p.isVisible(loc) {
			continue
		}
		if err := loc.Click(playwright.LocatorClickOptions{
			Timeout: playwright.Float(5000),
		}); err == nil {
			clicked = true
			break
		}
	}
	if !clicked {
		return fmt.Errorf("could not find protocol dropdown trigger")
	}

	p.sleep(300)

	option := p.page.GetByText(protocol, playwright.PageGetByTextOptions{
		Exact: playwright.Bool(true),
	}).Last()
	if err := option.Click(); err != nil {
		return fmt.Errorf("select protocol %q: %w", protocol, err)
	}
	p.sleep(500)
	return nil
}

// SetScheduleStartNow clicks the "Start Now" radio.
func (p *DiscoveryPage) SetScheduleStartNow() error {
	startNow := p.page.GetByText("Start Now")
	if p.isVisible(startNow) {
		return startNow.Click()
	}
	return clickAny(p.page,
		`label:has-text("Start Now")`,
		`text=Start Now`,
	)
}

// SetExcludeFilePatterns fills the "Excluded Path Patterns" textarea.
func (p *DiscoveryPage) SetExcludeFilePatterns(patterns string) error {
	textarea := p.page.Locator(
		`textarea[name="excludeFilePatterns"], textarea[placeholder*="Excluded Path Patterns"]`,
	).First()
	if !p.isVisible(textarea) {
		textarea = p.page.GetByLabel("Excluded Path Patterns").First()
	}
	if err := textarea.Clear(); err != nil {
		return fmt.Errorf("clear exclude patterns: %w", err)
	}
	return textarea.Fill(patterns)
}

// SelectAllExportPaths clicks the header checkbox to select all rows.
func (p *DiscoveryPage) SelectAllExportPaths() error {
	p.sleep(1000)

	allCBs := p.page.Locator(`[role="checkbox"], input[type="checkbox"]`)
	count, _ := allCBs.Count()
	if count > 0 {
		if err := allCBs.First().Click(); err != nil {
			return fmt.Errorf("click header checkbox: %w", err)
		}
		p.sleep(1000)

		sap := p.page.GetByText("Select all pages")
		if p.isVisible(sap) {
			_ = sap.Click()
			p.sleep(1000)
		}
		return nil
	}

	return fmt.Errorf("no checkboxes found in export paths table")
}

// nameVariants returns the original name plus variants with underscores and
// hyphens swapped. ONTAP volumes use underscores (master_nfs_vol_dnd_src_…)
// but ANF junction paths use hyphens (/master-nfs-vol-dnd-src-…).
func nameVariants(name string) []string {
	seen := map[string]bool{name: true}
	variants := []string{name}

	withHyphens := strings.ReplaceAll(name, "_", "-")
	if !seen[withHyphens] {
		variants = append(variants, withHyphens)
		seen[withHyphens] = true
	}
	withUnderscores := strings.ReplaceAll(name, "-", "_")
	if !seen[withUnderscores] {
		variants = append(variants, withUnderscores)
		seen[withUnderscores] = true
	}
	return variants
}

// SelectExportPathByName locates an export path in the (potentially paginated)
// table and clicks its checkbox. It handles underscore/hyphen mismatches
// between env var names and UI-displayed junction paths automatically.
func (p *DiscoveryPage) SelectExportPathByName(pathName string) error {
	p.sleep(500)

	variants := nameVariants(pathName)

	// Helper: try each name variant on the current page.
	tryClick := func() bool {
		for _, v := range variants {
			pathText := p.page.GetByText(v, playwright.PageGetByTextOptions{
				Exact: playwright.Bool(false),
			}).First()
			if !p.isVisible(pathText) {
				continue
			}
			result, err := pathText.Evaluate(checkboxClickJS, nil)
			if err != nil {
				continue
			}
			if clicked, ok := result.(bool); ok && clicked {
				if v != pathName {
					log.Printf("[SelectExportPathByName] matched variant %q (original: %q)", v, pathName)
				}
				return true
			}
		}
		return false
	}

	// 1. Check current page first.
	if tryClick() {
		log.Printf("[SelectExportPathByName] found %q on current page", pathName)
		p.sleep(500)
		return nil
	}

	// 2. Try search/filter box (File Server Overview has one, Bulk Discover may not).
	searchSelectors := []string{
		`input[placeholder*="Search" i]`,
		`input[placeholder*="Filter" i]`,
		`input[type="search"]`,
		`[data-testid="search-input"]`,
	}
	for _, sel := range searchSelectors {
		searchBox := p.page.Locator(sel).First()
		if p.isVisible(searchBox) {
			for _, v := range variants {
				_ = searchBox.Fill(v)
				log.Printf("[SelectExportPathByName] filtered table with %q", v)
				p.sleep(2000)
				if tryClick() {
					p.sleep(500)
					return nil
				}
			}
			_ = searchBox.Fill("")
			p.sleep(1000)
			break
		}
	}

	// 3. Try increasing rows-per-page to show all rows at once.
	rowsPerPage := p.page.Locator(`[class*="rowsPerPage"] select, [aria-label*="rows per page" i]`).First()
	if p.isVisible(rowsPerPage) {
		_, _ = rowsPerPage.SelectOption(playwright.SelectOptionValues{Values: &[]string{"100", "50", "All"}})
		p.sleep(2000)
		if tryClick() {
			log.Printf("[SelectExportPathByName] found %q after increasing rows per page", pathName)
			p.sleep(500)
			return nil
		}
	}

	// 4. Paginate: click "next page" buttons until the path appears.
	nextBtnSelectors := []string{
		`button[aria-label*="next" i]`,
		`button[aria-label*="Next" i]`,
		`[data-testid="next-page"]`,
		`button:has-text("›"):not(:has-text("»"))`,
		`button:has-text(">"):not(:has-text(">>"))`,
	}
	for pg := 0; pg < 20; pg++ {
		clicked := false
		for _, sel := range nextBtnSelectors {
			btn := p.page.Locator(sel).First()
			if !p.isVisible(btn) {
				continue
			}
			disabled, _ := btn.IsDisabled()
			if disabled {
				continue
			}
			if err := btn.Click(); err == nil {
				clicked = true
				log.Printf("[SelectExportPathByName] clicked next page (page %d)", pg+2)
				p.sleep(1500)
				break
			}
		}
		if !clicked {
			break
		}
		if tryClick() {
			log.Printf("[SelectExportPathByName] found %q on page %d", pathName, pg+2)
			p.sleep(500)
			return nil
		}
	}

	return fmt.Errorf("export path %q not visible in table (checked all pages)", pathName)
}

// SelectFirstNRows selects the first N export path rows.
func (p *DiscoveryPage) SelectFirstNRows(n int) error {
	p.sleep(1000)

	allCBs := p.page.Locator(`[role="checkbox"], input[type="checkbox"]`)
	cbCount, _ := allCBs.Count()

	limit := n
	if cbCount-1 < limit {
		limit = cbCount - 1
	}

	for i := 1; i <= limit; i++ {
		if err := allCBs.Nth(i).Click(); err != nil {
			continue
		}
		p.sleep(300)
	}

	return nil
}

// SubmitBulkDiscovery clicks Submit and waits for the navigation back.
func (p *DiscoveryPage) SubmitBulkDiscovery() error {
	submitBtn := p.page.GetByRole("button", playwright.PageGetByRoleOptions{
		Name: "Submit",
	})
	if err := submitBtn.Click(); err != nil {
		return fmt.Errorf("click Submit: %w", err)
	}
	p.sleep(5000)
	return nil
}

// ── Job Run Tracking ────────────────────────────────────────────────────────

// GetRunCount returns the number of rows in the current table (tbody tr).
func (p *DiscoveryPage) GetRunCount() int {
	rows := p.page.Locator(`tbody tr`)
	count, _ := rows.Count()
	return count
}

// WaitForNewRun polls the Job Run List until the row count exceeds prevCount,
// indicating a new run has appeared. Returns the new count.
func (p *DiscoveryPage) WaitForNewRun(prevCount int, timeoutMs float64) (int, error) {
	const pollInterval = 10000.0
	for elapsed := 0.0; elapsed < timeoutMs; elapsed += pollInterval {
		// Wait for table rows to render (up to 10s).
		_ = p.page.Locator(`tbody tr`).First().WaitFor(playwright.LocatorWaitForOptions{
			State:   playwright.WaitForSelectorStateVisible,
			Timeout: playwright.Float(10000),
		})

		current := p.GetRunCount()
		log.Printf("[WaitForNewRun] poll %.0fs: rows=%d (was %d)", elapsed/1000, current, prevCount)
		if current > prevCount {
			return current, nil
		}

		// Soft refresh via the UI refresh icon — avoids full page reload
		// which would clear the DOM and require re-rendering.
		p.ClickRefreshIcon()
		p.sleep(5000)
	}
	return p.GetRunCount(), fmt.Errorf("no new run appeared within %.0fs (still %d rows)", timeoutMs/1000, prevCount)
}

// GetLatestRunStatus reads the status of the FIRST row in the run list.
// This is the newest run when sorted by start time descending.
func (p *DiscoveryPage) GetLatestRunStatus() (string, error) {
	// Use JS to read the status from the first table row's .capitalize cell.
	result, err := p.page.Evaluate(`() => {
		const known = ['running','completed','errored','failed','paused','pausing',
		               'stopped','stopping','ready','pending','blocked'];
		const firstRow = document.querySelector('tbody tr');
		if (!firstRow) return '';
		const caps = firstRow.querySelectorAll('.capitalize');
		for (const el of caps) {
			const t = el.textContent.trim().toLowerCase();
			if (known.includes(t)) return t.toUpperCase();
		}
		return '';
	}`, nil)
	if err != nil {
		return "", fmt.Errorf("latest run status JS eval: %w", err)
	}
	s, _ := result.(string)
	if s == "" {
		return "", fmt.Errorf("could not read status from first run row")
	}
	return s, nil
}

// ── Job Run Status ──────────────────────────────────────────────────────────

// GetJobRunStatus reads the first visible job run status from the page.
// The JobRunStatusCellRenderer outputs: status.toLowerCase() with CSS capitalize,
// so the DOM textContent is "errored" not "ERRORED". This function uses JS
// evaluation to reliably read it.
func (p *DiscoveryPage) GetJobRunStatus() (string, error) {
	result, err := p.page.Evaluate(readStatusFromPageJS, nil)
	if err != nil {
		return "", fmt.Errorf("status JS eval failed: %w", err)
	}
	s, ok := result.(string)
	if !ok || s == "" {
		return "", fmt.Errorf("could not determine job run status from page")
	}
	return s, nil
}

// WaitForJobRunStatus polls the FIRST ROW of the current page until the
// desired status or a terminal error state is reached. Uses GetLatestRunStatus
// to read only the newest run, ignoring old errored rows below it.
func (p *DiscoveryPage) WaitForJobRunStatus(desiredStatus string, timeoutMs float64) error {
	const pollInterval = 5000.0
	desired := strings.ToUpper(desiredStatus)

	for elapsed := 0.0; elapsed < timeoutMs; elapsed += pollInterval {
		p.ClickRefreshIcon()
		p.sleep(1000)

		status, err := p.GetLatestRunStatus()
		if err != nil {
			// Fallback to page-wide status if first-row read fails.
			status, err = p.GetJobRunStatus()
		}
		if err != nil {
			log.Printf("[WaitForJobRunStatus] poll %.0fs: status not found yet (%v)", elapsed/1000, err)
		} else {
			log.Printf("[WaitForJobRunStatus] poll %.0fs: status=%s (want %s)", elapsed/1000, status, desired)

			if status == desired {
				return nil
			}
			if status == "COMPLETED" && desired != "COMPLETED" {
				return nil
			}
			if (status == "ERRORED" || status == "FAILED") && desired != "ERRORED" && desired != "FAILED" {
				p.takeScreenshot("job-errored")
				return fmt.Errorf("job entered %s state (wanted %s) — check worker logs and file server connectivity", status, desired)
			}
		}

		p.sleep(pollInterval)
		p.page.Reload()
		p.sleep(2000)
	}

	p.takeScreenshot("job-timeout")
	return fmt.Errorf("job did not reach %s within %.0fs", desired, timeoutMs/1000)
}

// OpenLatestDiscoveryJob clicks the first job row in the current table.
func (p *DiscoveryPage) OpenLatestDiscoveryJob() (string, error) {
	p.sleep(2000)

	rows := p.page.Locator(`tbody tr`)
	count, _ := rows.Count()
	if count > 0 {
		if err := rows.First().Click(); err != nil {
			return "", fmt.Errorf("click first job row: %w", err)
		}
	} else {
		row := p.page.GetByText("Discovery").First()
		if p.isVisible(row) {
			_ = row.Click()
		} else {
			return "", fmt.Errorf("no job rows found in table")
		}
	}

	p.sleep(3000)
	return p.page.URL(), nil
}

// ── Job Actions (via header buttons — requires row selection first) ──────────

// selectFirstJobRow clicks the checkbox on the first table row so that
// header action buttons (Pause, Stop, Resume) become enabled.
func (p *DiscoveryPage) selectFirstJobRow() error {
	firstRow := p.page.Locator(`tbody tr`).First()
	if err := p.expectVisible(firstRow, 10000); err != nil {
		return fmt.Errorf("no rows visible in job run table")
	}

	// Click the checkbox in the first row.
	cb := firstRow.Locator(`[role="checkbox"], input[type="checkbox"]`).First()
	if p.isVisible(cb) {
		if err := cb.Click(); err != nil {
			return fmt.Errorf("click row checkbox: %w", err)
		}
		p.sleep(500)
		return nil
	}

	// Fallback: click the first cell (some tables use row-click selection).
	firstCell := firstRow.Locator(`td`).First()
	if p.isVisible(firstCell) {
		_ = firstCell.Click()
		p.sleep(500)
	}
	return nil
}

func (p *DiscoveryPage) clickJobAction(action string) error {
	// Select the first row so header action buttons become enabled.
	if err := p.selectFirstJobRow(); err != nil {
		log.Printf("[clickJobAction] row selection warning: %v", err)
	}
	p.sleep(1000)

	// Try header-level buttons (enabled now that a row is selected).
	headerBtn := p.page.GetByRole("button", playwright.PageGetByRoleOptions{
		Name: action,
	})
	if err := p.expectVisible(headerBtn, 5000); err == nil {
		disabled, _ := headerBtn.IsDisabled()
		if !disabled {
			if err := headerBtn.Click(); err == nil {
				p.sleep(2000)
				return nil
			}
		}
	}

	// Fallback: try the ⋯ overflow menu on the first row.
	menuBtns := p.page.Locator(`tbody tr`).First().Locator(`button`).Last()
	if p.isVisible(menuBtns) {
		_ = menuBtns.Click()
		p.sleep(500)
	}

	actionBtn := p.page.GetByText(action, playwright.PageGetByTextOptions{
		Exact: playwright.Bool(true),
	}).First()
	if err := actionBtn.Click(); err != nil {
		return fmt.Errorf("click %q action: %w", action, err)
	}
	p.sleep(2000)
	return nil
}

func (p *DiscoveryPage) PauseJob() error  { return p.clickJobAction("Pause") }
func (p *DiscoveryPage) ResumeJob() error { return p.clickJobAction("Resume") }
func (p *DiscoveryPage) StopJob() error   { return p.clickJobAction("Stop") }

func (p *DiscoveryPage) TriggerAdhocRun() error {
	candidates := []string{"Run Now", "Ad Hoc", "Adhoc", "Trigger Run"}
	for _, name := range candidates {
		btn := p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: name})
		if p.isVisible(btn) {
			if err := btn.Click(); err == nil {
				p.sleep(3000)
				return nil
			}
		}
	}
	return fmt.Errorf("ad-hoc run button not found")
}

// ── Discovery Report ────────────────────────────────────────────────────────

func (p *DiscoveryPage) IsReportVisible() (bool, error) {
	return p.isVisible(p.page.GetByText("Discovery Report").First()), nil
}

func (p *DiscoveryPage) IsReportDownloadEnabled() (bool, error) {
	csvBtn := p.page.GetByText("Download Discovery Report as CSV").First()
	if p.isVisible(csvBtn) {
		disabled, _ := csvBtn.IsDisabled()
		return !disabled, nil
	}
	return false, nil
}

// ── Discovery Report Download ───────────────────────────────────────────────

// DownloadDiscoveryReportCSV clicks the "Discovery Report" dropdown on the
// Job Run Details page and selects the CSV download option. The caller must
// already be on a completed job run's detail page.
func (p *DiscoveryPage) DownloadDiscoveryReportCSV() error {
	// Try multiple known dropdown trigger patterns.
	dropdownCandidates := []playwright.Locator{
		p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Discovery Report"}),
		p.page.Locator(`button:has-text("Discovery Report")`),
		p.page.Locator(`[data-testid*="discovery-report"]`),
		p.page.Locator(`button:has-text("Report")`).First(),
	}

	var opened bool
	for _, loc := range dropdownCandidates {
		if p.isVisible(loc) {
			if err := loc.Click(); err == nil {
				opened = true
				p.sleep(500)
				break
			}
		}
	}
	if !opened {
		return fmt.Errorf("Discovery Report dropdown button not found")
	}

	// Click the CSV download option from the dropdown menu.
	csvCandidates := []playwright.Locator{
		p.page.GetByText("Download as CSV", playwright.PageGetByTextOptions{Exact: playwright.Bool(false)}).First(),
		p.page.GetByText("CSV", playwright.PageGetByTextOptions{Exact: playwright.Bool(false)}).First(),
		p.page.GetByText("Download Discovery Report as CSV").First(),
		p.page.Locator(`[role="menuitem"]:has-text("CSV")`).First(),
	}

	for _, loc := range csvCandidates {
		if p.isVisible(loc) {
			if err := loc.Click(); err == nil {
				p.sleep(2000)
				return nil
			}
		}
	}

	return fmt.Errorf("CSV download option not found in Discovery Report dropdown")
}

// DownloadDiscoveryReportFromJobRunList navigates to the Job Run List,
// finds the first completed discovery row, opens its overflow menu (⋯),
// and clicks "Download Discovery Report as CSV". Returns the saved file path.
func (p *DiscoveryPage) DownloadDiscoveryReportFromJobRunList(downloadDir string, rowIndex int) (string, error) {
	p.sleep(3000)

	// The Job Run List uses the bxp Table component (div-based rows with
	// data-testid="table-row-*"), NOT native <table>/<tbody>/<tr>.
	rowSelector := `[data-testid^="table-row-"]`

	_ = p.page.Locator(rowSelector).First().WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(20000),
	})
	p.sleep(1000)

	rows, err := p.page.Locator(rowSelector).All()
	if err != nil || len(rows) == 0 {
		return "", fmt.Errorf("no rows found in Job Run List table (selector: %s)", rowSelector)
	}
	log.Printf("[DownloadDiscoveryReportFromJobRunList] found %d row(s)", len(rows))
	if rowIndex >= len(rows) {
		return "", fmt.Errorf("row index %d out of range (table has %d rows)", rowIndex, len(rows))
	}

	targetRow := rows[rowIndex]

	// Open the overflow menu and attempt the download. Retry the whole
	// open+click sequence up to 3 times because the menu can close itself
	// between our isVisible() check and the actual click.
	overflowCandidates := []playwright.Locator{
		targetRow.Locator(`button[aria-label*="overflow" i], button[aria-label*="more action" i], button[aria-label*="options" i]`).First(),
		targetRow.Locator(`[data-testid*="overflow"], [data-testid*="more"]`).First(),
		targetRow.Locator(`button`).Last(),
	}

	csvOptionCandidates := []playwright.Locator{
		p.page.GetByText("Download Discovery Report as CSV", playwright.PageGetByTextOptions{Exact: playwright.Bool(false)}).First(),
		p.page.GetByText("Download Report as CSV", playwright.PageGetByTextOptions{Exact: playwright.Bool(false)}).First(),
		p.page.GetByText("Download as CSV", playwright.PageGetByTextOptions{Exact: playwright.Bool(false)}).First(),
		p.page.GetByText("Download CSV", playwright.PageGetByTextOptions{Exact: playwright.Bool(false)}).First(),
		p.page.Locator(`[role="menuitem"]:has-text("CSV")`).First(),
		p.page.Locator(`li:has-text("CSV")`).First(),
		p.page.Locator(`[role="menuitem"]:has-text("Download")`).First(),
		p.page.Locator(`li:has-text("Download")`).First(),
		p.page.GetByText("Download", playwright.PageGetByTextOptions{Exact: playwright.Bool(false)}).First(),
	}

	var downloadStarted bool
	var savePath string

	for attempt := 1; attempt <= 3 && !downloadStarted; attempt++ {
		// (Re-)open the overflow menu on each attempt.
		var overflowErr error
		for _, btn := range overflowCandidates {
			if p.isVisible(btn) {
				if err := btn.Hover(); err == nil {
					overflowErr = btn.Click()
				} else {
					overflowErr = btn.Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)})
				}
				if overflowErr == nil {
					break
				}
			}
		}
		if overflowErr != nil {
			log.Printf("[DownloadDiscoveryReportFromJobRunList] attempt %d: overflow click failed: %v", attempt, overflowErr)
			p.sleep(1000)
			continue
		}

		// Wait for menu items to render.
		_ = p.page.Locator(`[role="menuitem"], [role="menu"] li, ul[class*="menu"] li`).
			First().WaitFor(playwright.LocatorWaitForOptions{
			State:   playwright.WaitForSelectorStateVisible,
			Timeout: playwright.Float(5000),
		})
		p.sleep(500)

		// Log visible menu items for debugging.
		if items, err := p.page.Locator(`[role="menuitem"], [role="menu"] li`).All(); err == nil {
			for i, item := range items {
				if txt, err := item.TextContent(); err == nil {
					log.Printf("[DownloadDiscoveryReportFromJobRunList] attempt %d menu item %d: %q", attempt, i, strings.TrimSpace(txt))
				}
			}
		}

		for _, loc := range csvOptionCandidates {
			if !p.isVisible(loc) {
				continue
			}
			txt, _ := loc.TextContent()
			log.Printf("[DownloadDiscoveryReportFromJobRunList] attempt %d: trying %q", attempt, strings.TrimSpace(txt))
			download, dlErr := p.page.ExpectDownload(func() error {
				// 10s click timeout — fail fast if menu closed, so we retry.
				return loc.Click(playwright.LocatorClickOptions{
					Timeout: playwright.Float(10000),
				})
			}, playwright.PageExpectDownloadOptions{
				Timeout: playwright.Float(60000), // 60s for the download to start
			})
			if dlErr == nil {
				suggestedName := download.SuggestedFilename()
				savePath = downloadDir + "/" + suggestedName
				if err := download.SaveAs(savePath); err != nil {
					return "", fmt.Errorf("save downloaded CSV to %s: %w", savePath, err)
				}
				downloadStarted = true
				log.Printf("[DownloadDiscoveryReportFromJobRunList] CSV saved to %s", savePath)
				break
			}
			log.Printf("[DownloadDiscoveryReportFromJobRunList] attempt %d: ExpectDownload failed for %q: %v",
				attempt, strings.TrimSpace(txt), dlErr)
		}

		if !downloadStarted && attempt < 3 {
			log.Printf("[DownloadDiscoveryReportFromJobRunList] attempt %d: no download started — retrying in 2s…", attempt)
			p.sleep(2000)
		}
	}

	if !downloadStarted {
		return "", fmt.Errorf("'Download Discovery Report as CSV' option not found in overflow menu after 3 attempts")
	}

	return savePath, nil
}

// GenerateAndDownloadConsolidatedCSV performs the full Consolidated Discovery
// Report flow on the File Server Overview page:
//  1. Click the "Consolidate All Discovery Reports" button to trigger generation.
//  2. Verify the toast notification and "Generating..." button state.
//  3. Wait for the download-ready "Consolidated Discovery Report" button.
//  4. Click the download button and save the CSV via Playwright's download API.
//
// Returns the path to the saved CSV file, or an error if any step fails.
// The timeoutMs parameter controls how long to wait for generation to complete.
func (p *DiscoveryPage) GenerateAndDownloadConsolidatedCSV(downloadDir string, timeoutMs float64) (string, error) {
	p.sleep(2000)

	// ── Step 1: Click the main "Consolidate All Discovery Reports" button ─
	// This is a split button. Clicking the main text area triggers generation.
	// The small dropdown arrow on the right is for format selection — we skip it
	// and let the default (CSV) action fire.
	triggerCandidates := []playwright.Locator{
		p.page.Locator(`button:has-text("Consolidate All Discovery Reports")`).First(),
		p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Consolidate All Discovery Reports"}),
		p.page.Locator(`button:has-text("Consolidate")`).First(),
	}

	var triggerBtn playwright.Locator
	for _, loc := range triggerCandidates {
		if p.isVisible(loc) {
			triggerBtn = loc
			break
		}
	}
	if triggerBtn == nil {
		return "", fmt.Errorf("Consolidate All Discovery Reports button not found")
	}

	if err := triggerBtn.Click(); err != nil {
		return "", fmt.Errorf("click Consolidate trigger button: %w", err)
	}
	log.Printf("[GenerateAndDownloadConsolidatedCSV] dropdown trigger clicked — looking for Generate as CSV option")
	p.sleep(1000)

	// The button is an ActionMenu trigger. Clicking it opens a dropdown with
	// "Generate as PDF" and "Generate as CSV". Click the CSV option.
	csvOptionCandidates := []playwright.Locator{
		p.page.GetByText("Generate as CSV", playwright.PageGetByTextOptions{Exact: playwright.Bool(false)}).First(),
		p.page.Locator(`li:has-text("Generate as CSV")`).First(),
		p.page.Locator(`[role="menuitem"]:has-text("CSV")`).First(),
		p.page.GetByText("CSV", playwright.PageGetByTextOptions{Exact: playwright.Bool(true)}).First(),
	}

	var csvClicked bool
	for _, loc := range csvOptionCandidates {
		if err := loc.WaitFor(playwright.LocatorWaitForOptions{
			State:   playwright.WaitForSelectorStateVisible,
			Timeout: playwright.Float(5000),
		}); err == nil {
			if err := loc.Click(); err == nil {
				csvClicked = true
				log.Printf("[GenerateAndDownloadConsolidatedCSV] 'Generate as CSV' clicked — generation triggered")
				break
			}
		}
	}
	if !csvClicked {
		return "", fmt.Errorf("'Generate as CSV' option not found in dropdown menu")
	}
	p.sleep(1000)

	// ── Step 2: Verify toast notification ───────────────────────────────
	toast := p.page.Locator(`text=Generating consolidated discovery report`).First()
	if err := toast.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(10000),
	}); err == nil {
		log.Printf("[GenerateAndDownloadConsolidatedCSV] toast notification visible")
	} else {
		log.Printf("[GenerateAndDownloadConsolidatedCSV] toast not detected — proceeding")
	}

	// ── Step 3: Wait for button state transitions ───────────────────────
	// Button states: "Consolidate All Discovery Reports" → "Generating" → "Consolidated Discovery Report"
	// "Consolidated" (past tense) only appears in the download-ready state,
	// never in the trigger "Consolidate All Discovery Reports", so this
	// locator is unambiguous.
	downloadBtn := p.page.Locator(`button:has-text("Consolidated")`).First()

	// First check if "Generating" state is visible (may already have passed).
	generatingBtn := p.page.Locator(`button:has-text("Generating")`).First()
	if err := generatingBtn.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(5000),
	}); err == nil {
		log.Printf("[GenerateAndDownloadConsolidatedCSV] button is in 'Generating' state")
	} else {
		log.Printf("[GenerateAndDownloadConsolidatedCSV] 'Generating' state not caught (may be fast)")
	}

	// Wait for the download-ready "Consolidated Discovery Report" button.
	log.Printf("[GenerateAndDownloadConsolidatedCSV] waiting for 'Consolidated Discovery Report' button (up to %.0fs)…", timeoutMs/1000)
	if err := downloadBtn.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(timeoutMs),
	}); err != nil {
		return "", fmt.Errorf("'Consolidated Discovery Report' button did not appear within %.0fs: %w", timeoutMs/1000, err)
	}
	log.Printf("[GenerateAndDownloadConsolidatedCSV] download button ready")

	// ── Step 4: Click the download button and capture the file ──────────
	download, err := p.page.ExpectDownload(func() error {
		return downloadBtn.Click()
	})
	if err != nil {
		return "", fmt.Errorf("download did not start after clicking: %w", err)
	}

	suggestedName := download.SuggestedFilename()
	log.Printf("[GenerateAndDownloadConsolidatedCSV] download started — file: %s", suggestedName)

	savePath := downloadDir + "/" + suggestedName
	if err := download.SaveAs(savePath); err != nil {
		return "", fmt.Errorf("save downloaded CSV to %s: %w", savePath, err)
	}

	log.Printf("[GenerateAndDownloadConsolidatedCSV] CSV saved to %s", savePath)
	return savePath, nil
}

// NavigateToCompletedJobRunDetail opens the detail page of the first
// completed job run visible on the Job Run List. Returns the run URL.
func (p *DiscoveryPage) NavigateToCompletedJobRunDetail() (string, error) {
	if err := p.NavigateToJobRunList(); err != nil {
		return "", err
	}

	// Look for a row with "completed" status and click it.
	rows, err := p.page.Locator(`tbody tr`).All()
	if err != nil || len(rows) == 0 {
		return "", fmt.Errorf("no job run rows found")
	}

	for _, row := range rows {
		text, _ := row.InnerText()
		if strings.Contains(strings.ToLower(text), "completed") {
			if err := row.Click(); err == nil {
				p.sleep(3000)
				return p.page.URL(), nil
			}
		}
	}

	// Fallback: click the first row regardless.
	if err := rows[0].Click(); err != nil {
		return "", fmt.Errorf("click first job run row: %w", err)
	}
	p.sleep(3000)
	return p.page.URL(), nil
}

// ── helpers ──────────────────────────────────────────────────────────────────

func (p *DiscoveryPage) sleep(ms float64) {
	p.page.WaitForTimeout(ms)
}

func (p *DiscoveryPage) isVisible(loc playwright.Locator) bool {
	v, _ := loc.IsVisible()
	return v
}

func (p *DiscoveryPage) expectVisible(loc playwright.Locator, timeoutMs float64) error {
	err := loc.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(timeoutMs),
	})
	if err != nil {
		return err
	}
	time.Sleep(150 * time.Millisecond)
	return nil
}

func (p *DiscoveryPage) takeScreenshot(name string) {
	dir := config.ScreenshotDir
	_ = os.MkdirAll(dir, 0o755)
	path := fmt.Sprintf("%s/%s.png", dir, name)
	_, _ = p.page.Screenshot(playwright.PageScreenshotOptions{
		Path:     playwright.String(path),
		FullPage: playwright.Bool(true),
	})
	log.Printf("[screenshot] saved → %s", path)
}

// ── API-based Job Polling ───────────────────────────────────────────────────
// These methods call the jobs microservice API directly from the browser
// context, bypassing UI table rendering issues entirely.

// JobStatus represents the API response for a job's current state.
type JobStatus struct {
	Status       string `json:"status"`
	RunID        string `json:"runId"`
	JobType      string `json:"jobType"`
	ConfigStatus string `json:"configStatus"`
	RunCount     int    `json:"runCount"`
	Debug        string `json:"debug"`
}

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

// EnsureEnvLoaded makes sure window.env is populated in the browser context.
func (p *DiscoveryPage) EnsureEnvLoaded() {
	hasEnv, _ := p.page.Evaluate(`() => !!(window.env?.VITE_JOBS_SERVICE_URL)`)
	if b, ok := hasEnv.(bool); !ok || !b {
		p.page.Goto(config.BaseURL+"/home", playwright.PageGotoOptions{
			Timeout:   playwright.Float(60000),
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		})
		p.sleep(3000)
	}
}

// FetchAllJobIDs returns a set of job config IDs via API. If the type
// filter returns 0 results but the API has jobs, retries without filter.
func (p *DiscoveryPage) FetchAllJobIDs(jobType string) map[string]bool {
	p.EnsureEnvLoaded()

	fetch := func(jt string) ([]string, int) {
		raw, err := p.page.Evaluate(getAllJobIDsJS, map[string]interface{}{"jt": jt})
		if err != nil {
			log.Printf("[FetchAllJobIDs] evaluate error: %v", err)
			return nil, 0
		}
		jsonStr, _ := raw.(string)
		var r struct {
			Jobs  []string `json:"jobs"`
			Total int      `json:"total"`
			Debug string   `json:"debug"`
		}
		_ = json.Unmarshal([]byte(jsonStr), &r)
		if r.Debug != "" {
			log.Printf("[FetchAllJobIDs] debug: %s", r.Debug)
		}
		return r.Jobs, r.Total
	}

	jobs, total := fetch(jobType)
	if len(jobs) == 0 && total > 0 {
		log.Printf("[FetchAllJobIDs] type %q matched 0 of %d — retrying without filter", jobType, total)
		jobs, total = fetch("")
	}

	set := make(map[string]bool, len(jobs))
	for _, id := range jobs {
		set[id] = true
	}
	log.Printf("[FetchAllJobIDs] found %d job(s) (total %d)", len(set), total)
	return set
}

// DiffJobIDs returns IDs present in after but not in before, sorted for
// deterministic ordering (Go map iteration is randomized).
func DiffJobIDs(before, after map[string]bool) []string {
	var newIDs []string
	for id := range after {
		if !before[id] {
			newIDs = append(newIDs, id)
		}
	}
	sort.Strings(newIDs)
	return newIDs
}

// PollJob checks the current status of a job config via API.
func (p *DiscoveryPage) PollJob(configID string) (*JobStatus, error) {
	p.EnsureEnvLoaded()
	raw, err := p.page.Evaluate(pollJobStatusJS, map[string]interface{}{"configId": configID})
	if err != nil {
		return nil, err
	}
	jsonStr, _ := raw.(string)
	var r JobStatus
	_ = json.Unmarshal([]byte(jsonStr), &r)
	return &r, nil
}

// WaitForRunToAppear polls until a run appears for the config.
func (p *DiscoveryPage) WaitForRunToAppear(configID string, timeoutSec int) (*JobStatus, error) {
	deadline := time.Now().Add(time.Duration(timeoutSec) * time.Second)
	for time.Now().Before(deadline) {
		r, err := p.PollJob(configID)
		if err == nil && r.RunCount > 0 {
			log.Printf("[WaitForRunToAppear] %s: run appeared — status=%s runId=%s", configID, r.Status, r.RunID)
			return r, nil
		}
		p.sleep(10000)
	}
	return nil, fmt.Errorf("job %s: no run appeared within %ds", configID, timeoutSec)
}

// WaitForJobState polls the API until the job reaches the target status.
func (p *DiscoveryPage) WaitForJobState(configID, target string, timeoutSec int) error {
	deadline := time.Now().Add(time.Duration(timeoutSec) * time.Second)
	runAppeared := false
	for time.Now().Before(deadline) {
		r, err := p.PollJob(configID)
		if err == nil {
			if r.RunCount == 0 && !runAppeared {
				log.Printf("[WaitForJobState] %s: waiting for run (configStatus=%s)", configID, r.ConfigStatus)
				p.sleep(10000)
				continue
			}
			runAppeared = true
			log.Printf("[WaitForJobState] %s: status=%s configStatus=%s runs=%d (target=%s)",
				configID, r.Status, r.ConfigStatus, r.RunCount, target)
			if strings.EqualFold(r.Status, target) {
				return nil
			}
			if r.Status == "errored" || r.Status == "failed" {
				return fmt.Errorf("job %s entered %s state", configID, r.Status)
			}
		}
		p.sleep(10000)
	}
	if !runAppeared {
		return fmt.Errorf("job %s: no run appeared within %ds", configID, timeoutSec)
	}
	return fmt.Errorf("job %s did not reach %q within %ds", configID, target, timeoutSec)
}
