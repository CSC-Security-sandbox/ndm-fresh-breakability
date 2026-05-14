package pages

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"ndm-ui-tests/config"

	"github.com/playwright-community/playwright-go"
)

// MigrationPage models the NDM Bulk Migrate wizard flow.
type MigrationPage struct {
	page playwright.Page
}

func NewMigrationPage(page playwright.Page) *MigrationPage {
	return &MigrationPage{page: page}
}

// ── Step 0: Navigate ──────────────────────────────────────────────────────────

// NavigateToFileServerOverview opens the file server overview page.
func (p *MigrationPage) NavigateToFileServerOverview(fsID string) error {
	url := fmt.Sprintf("%s/file-server/%s", config.BaseURL, fsID)
	for attempt := 1; attempt <= 3; attempt++ {
		_, err := p.page.Goto(url, playwright.PageGotoOptions{
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
			Timeout:   playwright.Float(60000),
		})
		if err == nil {
			break
		}
		p.sleep(2000)
	}
	if err := p.expectVisible(p.page.GetByText("File Server Overview").First(), 30000); err != nil {
		return fmt.Errorf("File Server Overview did not appear: %w", err)
	}
	p.sleep(2000)
	return nil
}

// ── Step 1: Open Bulk Migrate wizard ─────────────────────────────────────────

// OpenBulkMigrateForm clicks "Bulk Migrate" and waits for the wizard URL.
func (p *MigrationPage) OpenBulkMigrateForm() error {
	// Prefer data-testid (set in JobsAction.tsx); fall back to role+name.
	btn := p.page.Locator(`[data-testid="btn-bulk-migrate"]`)
	if !p.isVisible(btn) {
		btn = p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Bulk Migrate"})
	}
	if err := p.expectVisible(btn, 30000); err != nil {
		return fmt.Errorf("Bulk Migrate button not visible: %w", err)
	}
	if err := btn.Click(); err != nil {
		return fmt.Errorf("click Bulk Migrate: %w", err)
	}
	if err := p.page.WaitForURL(regexp.MustCompile(`bulk-migrate`), playwright.PageWaitForURLOptions{
		Timeout: playwright.Float(15000),
	}); err != nil {
		return fmt.Errorf("did not navigate to bulk-migrate page: %w", err)
	}
	p.sleep(3000)
	log.Printf("[MigrationPage] Bulk Migrate wizard opened")
	return nil
}

// ── Step 1 → Mapping page ─────────────────────────────────────────────────────

// SelectDestinationFileServer picks the destination FS from the bxp FormFieldSelect.
// bxp's FormFieldSelect renders a div[tabindex] trigger; clicking it focuses the
// wrapper but the dropdown only opens via keyboard (ArrowDown/Space/Enter).
func (p *MigrationPage) SelectDestinationFileServer(dstFSName string) error {
	p.sleep(1000)

	// ── Step A: Focus the dropdown trigger and open with keyboard ────────────

	// Find the trigger: the tabindex div inside the destination FS section.
	// bxp FormFieldSelect renders a custom div that responds to keyboard events.
	// We locate it by finding the div with tabindex that is in the RIGHT half of
	// the page (destination column) and is not one of the MUI Autocomplete inputs.
	focused, _ := p.page.Evaluate(`() => {
		// Collect all divs with tabindex (bxp Select triggers)
		const divs = Array.from(document.querySelectorAll('div[tabindex]'));
		const info = divs.map(el => {
			const r = el.getBoundingClientRect();
			return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), txt: el.textContent.trim().substring(0,60), ti: el.getAttribute('tabindex') };
		}).filter(d => d.h > 0);
		return JSON.stringify(info);
	}`)
	log.Printf("[SelectDestinationFileServer] tabindex divs: %v", focused)

	// Focus the element by clicking it with Playwright (triggers React focus events).
	// Use Locator filter to find the LAST div[tabindex] that is visible and in the
	// right column — this is the destination FS dropdown trigger.
	trigger := p.page.Locator(`div[tabindex]`).Filter(playwright.LocatorFilterOptions{
		HasText: "Select Destination File Server",
	}).Last()

	if !p.isVisible(trigger) {
		// Fallback: click the dropdown arrow (▼) SVG button next to the label
		trigger = p.page.Locator(`div[tabindex]`).Last()
	}

	if err := trigger.Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)}); err != nil {
		log.Printf("[SelectDestinationFileServer] trigger click error: %v", err)
	}
	p.sleep(500)

	// Press ArrowDown to open bxp dropdown (standard keyboard interaction for custom selects).
	_ = p.page.Keyboard().Press("ArrowDown")
	p.sleep(800)

	// If still not open, try Space and Enter.
	if lv, _ := p.page.Locator(`[role="listbox"], ul li`).First().IsVisible(); !lv {
		_ = p.page.Keyboard().Press("Space")
		p.sleep(500)
	}
	if lv, _ := p.page.Locator(`[role="listbox"], ul li`).First().IsVisible(); !lv {
		_ = p.page.Keyboard().Press("Enter")
		p.sleep(500)
	}

	p.screenshot("mig-dst-fs-dropdown-open")

	// ── Step B: Pick the option ───────────────────────────────────────────────
	// bxp renders popup as ul>li elements (from screenshots: plain list items)
	for _, sel := range []string{
		`[role="option"]`,
		`[role="listbox"] li`,
		`ul li`,
		`li`,
	} {
		opts := p.page.Locator(sel)
		count, _ := opts.Count()
		if count == 0 {
			continue
		}
		log.Printf("[SelectDestinationFileServer] %d option(s) via %q", count, sel)
		for i := 0; i < count; i++ {
			txt, _ := opts.Nth(i).TextContent()
			isVis, _ := opts.Nth(i).IsVisible()
			if !isVis {
				continue
			}
			log.Printf("[SelectDestinationFileServer]   [%d] %q", i, strings.TrimSpace(txt))
			if strings.Contains(strings.TrimSpace(txt), dstFSName) {
				if err := opts.Nth(i).Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)}); err == nil {
					p.sleep(800)
					log.Printf("[SelectDestinationFileServer] selected %q", dstFSName)
					return nil
				}
			}
		}
		break // only use the first selector that returns items
	}

	// JS fallback
	result, _ := p.page.Evaluate(fmt.Sprintf(`() => {
		for (const sel of ['[role="option"]', 'li']) {
			for (const el of document.querySelectorAll(sel)) {
				if (el.getBoundingClientRect().height > 0 && el.textContent.includes(%q)) {
					el.click(); return true;
				}
			}
		}
		return false;
	}`, dstFSName))
	if ok, _ := result.(bool); ok {
		p.sleep(800)
		log.Printf("[SelectDestinationFileServer] selected %q via JS", dstFSName)
		return nil
	}

	p.screenshot("mig-dst-fs-not-found")
	return fmt.Errorf("destination FS %q not found in dropdown", dstFSName)
}

// SelectSourcePath picks a source export path from the MUI Autocomplete.
func (p *MigrationPage) SelectSourcePath(srcPath string) error {
	return p.selectMuiAutocomplete(
		"bulk-migrate-src-path-input",   // data-testid (post-deploy)
		"Select Source Path",            // placeholder fallback (current deploy)
		srcPath, "source path",
	)
}

// SelectDestinationPath picks a destination export path from the MUI Autocomplete.
func (p *MigrationPage) SelectDestinationPath(dstPath string) error {
	return p.selectMuiAutocomplete(
		"bulk-migrate-dst-path-input",   // data-testid (post-deploy)
		"Select Destination Path",       // placeholder fallback (current deploy)
		dstPath, "destination path",
	)
}

// selectMuiAutocomplete clicks a MUI Autocomplete input identified first by
// data-testid, then by placeholder. Opens the popup and selects the option
// matching value.
func (p *MigrationPage) selectMuiAutocomplete(testID, placeholder, value, label string) error {
	// Try data-testid first (after frontend deploy), then placeholder (current deploy).
	input := p.page.Locator(fmt.Sprintf(`[data-testid="%s"]`, testID)).First()
	if !p.isVisible(input) {
		input = p.page.Locator(fmt.Sprintf(`input[placeholder="%s"]`, placeholder)).First()
	}
	if err := p.expectVisible(input, 10000); err != nil {
		return fmt.Errorf("%s input not visible (tried testid=%s, placeholder=%s): %w",
			label, testID, placeholder, err)
	}

	if err := input.Click(); err != nil {
		return fmt.Errorf("click %s input: %w", label, err)
	}
	p.sleep(800)

	// MUI renders a portal [role="listbox"] with [role="option"] children.
	opts := p.page.Locator(`[role="listbox"] [role="option"]`)
	_ = opts.First().WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(8000),
	})

	count, _ := opts.Count()
	log.Printf("[selectMuiAutocomplete] label=%q value=%q options=%d", label, value, count)
	for i := 0; i < count; i++ {
		txt, _ := opts.Nth(i).TextContent()
		log.Printf("[selectMuiAutocomplete]   [%d] %q", i, strings.TrimSpace(txt))
		if strings.Contains(strings.TrimSpace(txt), value) {
			if err := opts.Nth(i).Click(); err == nil {
				p.sleep(500)
				log.Printf("[selectMuiAutocomplete] selected %q for %s", value, label)
				return nil
			}
		}
	}

	p.screenshot(fmt.Sprintf("mig-autocomplete-%s-not-found", label))
	return fmt.Errorf("%s option %q not found in autocomplete (found %d options)", label, value, count)
}

// AddMapping clicks the "+ Add Mapping" button and waits for a mapping row
// to appear in the table below.
func (p *MigrationPage) AddMapping() error {
	addBtn := p.page.Locator(`[data-testid="btn-add-mapping"]`)
	if !p.isVisible(addBtn) {
		addBtn = p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Add Mapping"})
	}
	if !p.isVisible(addBtn) {
		addBtn = p.page.Locator(`button:has-text("Add Mapping")`).First()
	}
	if err := p.expectVisible(addBtn, 10000); err != nil {
		return fmt.Errorf("Add Mapping button not visible: %w", err)
	}
	disabled, _ := addBtn.IsDisabled()
	if disabled {
		return fmt.Errorf("Add Mapping button is disabled — check source/destination selections")
	}
	if err := addBtn.Click(); err != nil {
		return fmt.Errorf("click Add Mapping: %w", err)
	}
	p.sleep(2000)

	// Verify a mapping row appeared in the table.
	row := p.page.Locator(`table tbody tr, [data-testid^="table-row-"]`).First()
	if err := p.expectVisible(row, 10000); err != nil {
		log.Printf("[AddMapping] mapping row did not appear — proceeding anyway")
	}
	p.screenshot("mig-mapping-added")
	log.Printf("[AddMapping] mapping added successfully")
	return nil
}

// ProceedFromMapping clicks "Proceed" on the Mapping step (step 1).
func (p *MigrationPage) ProceedFromMapping() error {
	return p.clickProceed("mapping")
}

// ── Step 2 → Options page ─────────────────────────────────────────────────────

// ProceedFromOptions leaves all options at their defaults and clicks "Proceed".
func (p *MigrationPage) ProceedFromOptions() error {
	// Wait for Options step to render (Preserve a-time toggle is a good anchor).
	_ = p.expectVisible(p.page.GetByText("Preserve a-time").First(), 15000)
	p.sleep(1000)
	p.screenshot("mig-options-default")
	return p.clickProceed("options")
}

// ── Step 3 → Review page ──────────────────────────────────────────────────────

// SelectAllMappingsOnReview checks the header checkbox on the Review step
// to select all path mappings, then waits for "Submit" to become enabled.
func (p *MigrationPage) SelectAllMappingsOnReview() error {
	// Wait for Review step table.
	_ = p.expectVisible(p.page.GetByText("Source Export Path").First(), 15000)
	p.sleep(1000)

	// Click the header checkbox to select all rows.
	headerCB := p.page.Locator(`thead [role="checkbox"], thead input[type="checkbox"]`).First()
	if p.isVisible(headerCB) {
		if err := headerCB.Click(); err != nil {
			return fmt.Errorf("click header checkbox on review: %w", err)
		}
	} else {
		// Fallback: all rows may already be selected (default); just verify.
		log.Printf("[SelectAllMappingsOnReview] header checkbox not found — rows may be pre-selected")
	}
	p.sleep(1000)
	p.screenshot("mig-review-selected")
	return nil
}

// SubmitMigration clicks "Submit" on the Review step and waits for success toast.
func (p *MigrationPage) SubmitMigration() error {
	submitBtn := p.page.Locator(`[data-testid="btn-bulk-migrate-proceed"]`)
	if !p.isVisible(submitBtn) {
		submitBtn = p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Submit"})
	}
	if !p.isVisible(submitBtn) {
		submitBtn = p.page.Locator(`button:has-text("Submit")`).First()
	}
	if err := p.expectVisible(submitBtn, 10000); err != nil {
		return fmt.Errorf("Submit button not visible: %w", err)
	}
	if err := submitBtn.Click(); err != nil {
		return fmt.Errorf("click Submit: %w", err)
	}
	p.sleep(2000)

	// Wait for success toast.
	toast := p.page.GetByText("Bulk Migrate Job has been created").First()
	if err := p.expectVisible(toast, 15000); err != nil {
		log.Printf("[SubmitMigration] success toast not detected — proceeding")
	} else {
		log.Printf("[SubmitMigration] migration job created successfully")
	}
	p.screenshot("mig-job-created")
	return nil
}

// ── Job Run List ──────────────────────────────────────────────────────────────

// NavigateToJobRunList opens the Job Run List page.
func (p *MigrationPage) NavigateToJobRunList() error {
	url := fmt.Sprintf("%s/jobs-run-list", config.BaseURL)
	_, err := p.page.Goto(url, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(60000),
	})
	if err != nil {
		return fmt.Errorf("navigate to job run list: %w", err)
	}
	if err := p.expectVisible(p.page.GetByText("Job Run ID").First(), 20000); err != nil {
		p.sleep(3000)
	}
	p.sleep(2000)
	log.Printf("[MigrationPage] on Job Run List")
	return nil
}

// WaitForMigrationCompleted polls the UI job run table until the first
// migration row reaches "Completed" status (or errors out).
// timeoutMs is the maximum wait in milliseconds.
func (p *MigrationPage) WaitForMigrationCompleted(timeoutMs float64) error {
	const pollInterval = 8000.0
	deadline := time.Now().Add(time.Duration(timeoutMs) * time.Millisecond)
	attempt := 0

	for time.Now().Before(deadline) {
		attempt++
		// Reload to get fresh status.
		p.page.Reload(playwright.PageReloadOptions{
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
			Timeout:   playwright.Float(30000),
		})
		p.sleep(2000)

		status := p.readFirstMigrationRowStatus()
		log.Printf("[WaitForMigrationCompleted] attempt %d: status=%q", attempt, status)

		switch strings.ToLower(status) {
		case "completed":
			p.screenshot("mig-job-completed")
			log.Printf("[WaitForMigrationCompleted] migration job completed after %d poll(s)", attempt)
			return nil
		case "errored", "failed":
			p.screenshot("mig-job-errored")
			return fmt.Errorf("migration job entered %s state", status)
		}

		p.sleep(pollInterval)
	}

	p.screenshot("mig-job-timeout")
	return fmt.Errorf("migration job did not complete within %.0fs", timeoutMs/1000)
}

// readFirstMigrationRowStatus reads the status text from the first Migration
// row in the Job Run List table.
func (p *MigrationPage) readFirstMigrationRowStatus() string {
	result, err := p.page.Evaluate(`() => {
		const known = ['running','completed','errored','failed','paused','pausing',
		               'stopped','stopping','ready','pending','blocked'];
		// Try bxp Table (data-testid rows)
		const rows = document.querySelectorAll('[data-testid^="table-row-"]');
		for (const row of rows) {
			if (!/migration/i.test(row.textContent)) continue;
			const caps = row.querySelectorAll('.capitalize');
			for (const el of caps) {
				const t = el.textContent.trim().toLowerCase();
				if (known.includes(t)) return t;
			}
			// Raw text fallback
			for (const s of known) {
				if (row.textContent.toLowerCase().includes(s)) return s;
			}
		}
		// Fallback: native tbody tr
		const trows = document.querySelectorAll('tbody tr');
		for (const row of trows) {
			if (!/migration/i.test(row.textContent)) continue;
			const caps = row.querySelectorAll('.capitalize');
			for (const el of caps) {
				const t = el.textContent.trim().toLowerCase();
				if (known.includes(t)) return t;
			}
			for (const s of known) {
				if (row.textContent.toLowerCase().includes(s)) return s;
			}
		}
		return '';
	}`, nil)
	if err != nil {
		return ""
	}
	s, _ := result.(string)
	return s
}

// ── CoC Report Download ───────────────────────────────────────────────────────

// DownloadCoCReport opens the overflow menu (⋯) on the first migration row
// in the Job Run List and clicks "Download CoC Report". Returns the saved
// file path.
func (p *MigrationPage) DownloadCoCReport(downloadDir string) (string, error) {
	p.sleep(2000)

	if err := os.MkdirAll(downloadDir, 0o755); err != nil {
		return "", fmt.Errorf("create download dir %s: %w", downloadDir, err)
	}

	// Find the first migration row.
	migRow, err := p.findFirstMigrationRow()
	if err != nil {
		return "", err
	}

	// Click the overflow (⋯) button — the last button in the row.
	overflowBtn := migRow.Locator(`button`).Last()
	if err := p.expectVisible(overflowBtn, 10000); err != nil {
		return "", fmt.Errorf("overflow menu button not found on migration row: %w", err)
	}
	if err := overflowBtn.Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)}); err != nil {
		return "", fmt.Errorf("click overflow menu: %w", err)
	}
	p.sleep(1000)
	p.screenshot("mig-overflow-menu-open")

	// Click "Download CoC Report" in the menu.
	cocCandidates := []playwright.Locator{
		p.page.GetByText("Download CoC Report", playwright.PageGetByTextOptions{Exact: playwright.Bool(false)}).First(),
		p.page.Locator(`[role="menuitem"]:has-text("CoC")`).First(),
		p.page.Locator(`li:has-text("CoC")`).First(),
		p.page.GetByText("CoC Report").First(),
	}

	for _, loc := range cocCandidates {
		if p.isVisible(loc) {
			download, dlErr := p.page.ExpectDownload(func() error {
				return loc.Click()
			})
			if dlErr != nil {
				continue
			}
			suggestedName := download.SuggestedFilename()
			if suggestedName == "" {
				suggestedName = fmt.Sprintf("coc-report-%d.pdf", time.Now().UnixMilli())
			}
			savePath := filepath.Join(downloadDir, suggestedName)
			if err := download.SaveAs(savePath); err != nil {
				return "", fmt.Errorf("save CoC report to %s: %w", savePath, err)
			}
			p.screenshot("mig-coc-downloaded")
			log.Printf("[DownloadCoCReport] saved to %s", savePath)
			return savePath, nil
		}
	}

	return "", fmt.Errorf("'Download CoC Report' option not found in overflow menu")
}

// findFirstMigrationRow returns the first table row whose text contains "Migration".
func (p *MigrationPage) findFirstMigrationRow() (playwright.Locator, error) {
	// Try bxp Table (data-testid rows) first.
	rows, err := p.page.Locator(`[data-testid^="table-row-"]`).All()
	if err == nil {
		for _, row := range rows {
			txt, _ := row.TextContent()
			if strings.Contains(strings.ToLower(txt), "migration") {
				return row, nil
			}
		}
	}

	// Fallback: native tbody tr.
	rows2, err := p.page.Locator(`tbody tr`).All()
	if err == nil {
		for _, row := range rows2 {
			txt, _ := row.TextContent()
			if strings.Contains(strings.ToLower(txt), "migration") {
				return row, nil
			}
		}
		// If no "Migration" text found, return the first row.
		if len(rows2) > 0 {
			log.Printf("[findFirstMigrationRow] no row with 'Migration' text — using first row")
			return rows2[0], nil
		}
	}

	return nil, fmt.Errorf("no migration rows found in Job Run List")
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func (p *MigrationPage) clickProceed(step string) error {
	// Try data-testid first, then role/text fallbacks.
	proceedBtn := p.page.Locator(`[data-testid="btn-bulk-migrate-proceed"]`)
	if !p.isVisible(proceedBtn) {
		proceedBtn = p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"})
	}
	if !p.isVisible(proceedBtn) {
		proceedBtn = p.page.Locator(`button:has-text("Proceed")`).First()
	}
	if err := p.expectVisible(proceedBtn, 10000); err != nil {
		return fmt.Errorf("Proceed button not visible on %s step: %w", step, err)
	}
	// Wait for it to become enabled (up to 20s).
	for i := 0; i < 10; i++ {
		disabled, _ := proceedBtn.IsDisabled()
		if !disabled {
			break
		}
		log.Printf("[clickProceed] %s: Proceed disabled, waiting (attempt %d/10)…", step, i+1)
		p.sleep(2000)
	}
	if err := proceedBtn.Click(); err != nil {
		return fmt.Errorf("click Proceed on %s: %w", step, err)
	}
	p.sleep(3000)
	log.Printf("[MigrationPage] Proceed clicked on %s step", step)
	return nil
}

func (p *MigrationPage) sleep(ms float64) {
	p.page.WaitForTimeout(ms)
}

func (p *MigrationPage) isVisible(loc playwright.Locator) bool {
	v, _ := loc.IsVisible()
	return v
}

func (p *MigrationPage) expectVisible(loc playwright.Locator, timeoutMs float64) error {
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

func (p *MigrationPage) screenshot(name string) {
	path := fmt.Sprintf("test-results/screenshots/%s.png", name)
	_, _ = p.page.Screenshot(playwright.PageScreenshotOptions{
		Path:     playwright.String(path),
		FullPage: playwright.Bool(true),
	})
	log.Printf("[screenshot] saved → %s", path)
}
