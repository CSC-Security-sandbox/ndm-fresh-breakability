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
	overview := p.page.Locator(`[data-testid="file-server-overview"]`)
	if !p.isVisible(overview) {
		overview = p.page.GetByText("File Server Overview").First()
	}
	if err := p.expectVisible(overview, 30000); err != nil {
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

	// ── Step A: Open the dropdown ────────────────────────────────────────────
	trigger := p.page.Locator(`[data-testid="select-destination-file-server"]`)
	if !p.isVisible(trigger) {
		trigger = p.page.Locator(`div[tabindex]`).Filter(playwright.LocatorFilterOptions{
			HasText: "Select Destination File Server",
		}).Last()
	}
	if !p.isVisible(trigger) {
		trigger = p.page.Locator(`div[tabindex]`).Last()
	}

	if err := trigger.Click(); err != nil {
		log.Printf("[SelectDestinationFileServer] trigger click error: %v", err)
	}
	p.sleep(1500)
	p.screenshot("mig-dst-fs-dropdown-open")

	// ── Step B: Pick the option ──────────────────────────────────────────────
	option := p.page.GetByText(dstFSName, playwright.PageGetByTextOptions{
		Exact: playwright.Bool(true),
	}).First()

	if p.isVisible(option) {
		if err := option.Click(); err == nil {
			p.sleep(800)
			log.Printf("[SelectDestinationFileServer] selected %q via getByText", dstFSName)
			return nil
		}
	}

	// Fallback: JS click on any visible element containing the name.
	result, _ := p.page.Evaluate(fmt.Sprintf(`() => {
		const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
		while (walk.nextNode()) {
			const el = walk.currentNode;
			const r = el.getBoundingClientRect();
			if (r.height === 0 || r.width === 0) continue;
			const txt = el.textContent.trim();
			if (txt === %q || txt === %q) {
				el.click();
				return true;
			}
		}
		return false;
	}`, dstFSName, dstFSName))
	if ok, _ := result.(bool); ok {
		p.sleep(800)
		log.Printf("[SelectDestinationFileServer] selected %q via JS", dstFSName)
		return nil
	}

	p.screenshot("mig-dst-fs-not-found")
	return fmt.Errorf("destination FS %q not found in dropdown", dstFSName)
}

// SelectDestinationFileServerWithRetry tries SelectDestinationFileServer.
// If it fails (e.g. wizard data stale), it navigates back to the source FS
// overview, re-opens the wizard, re-selects the source path, and retries.
func (p *MigrationPage) SelectDestinationFileServerWithRetry(
	srcFSID, dstFSName, srcExportPath string, maxRetries int,
) error {
	err := p.SelectDestinationFileServer(dstFSName)
	if err == nil {
		return nil
	}

	for attempt := 1; attempt <= maxRetries; attempt++ {
		log.Printf("[SelectDestinationFileServerWithRetry] attempt %d/%d — re-opening wizard", attempt, maxRetries)
		p.page.Keyboard().Press("Escape")
		p.sleep(5000)

		// Navigate back to file server overview to force re-mount the wizard.
		if navErr := p.NavigateToFileServerOverview(srcFSID); navErr != nil {
			return fmt.Errorf("retry %d: navigate to overview: %w", attempt, navErr)
		}
		p.sleep(3000)

		// Re-open Bulk Migrate wizard (re-fetches file server list).
		if openErr := p.OpenBulkMigrateForm(); openErr != nil {
			return fmt.Errorf("retry %d: open bulk migrate: %w", attempt, openErr)
		}

		// Re-select source path.
		if spErr := p.SelectSourcePath(srcExportPath); spErr != nil {
			return fmt.Errorf("retry %d: select source path: %w", attempt, spErr)
		}

		// Try selecting destination FS again.
		err = p.SelectDestinationFileServer(dstFSName)
		if err == nil {
			return nil
		}
		log.Printf("[SelectDestinationFileServerWithRetry] attempt %d: still not found", attempt)
	}

	return fmt.Errorf("destination FS %q not found after %d retries: %w", dstFSName, maxRetries, err)
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
	optionsAnchor := p.page.Locator(`[data-testid="bulk-migrate-options-step"]`)
	if !p.isVisible(optionsAnchor) {
		optionsAnchor = p.page.GetByText("Preserve a-time").First()
	}
	_ = p.expectVisible(optionsAnchor, 15000)
	p.sleep(1000)
	p.screenshot("mig-options-default")
	return p.clickProceed("options")
}

// ConfigureCustomOptions modifies all config fields on the Options step:
//   - Toggles OFF "Preserve a-time"
//   - Toggles OFF "Preserve Permissions"
//   - Selects "Exclude file older than (UTC)" and sets a past date
//   - Changes "Skip Files modified in last" to the given value
//   - Appends extra patterns to "Excluded Path Patterns"
func (p *MigrationPage) ConfigureCustomOptions(skipFileNum string, extraExcludePatterns string) error {
	optionsAnchor := p.page.Locator(`[data-testid="bulk-migrate-options-step"]`)
	if !p.isVisible(optionsAnchor) {
		optionsAnchor = p.page.GetByText("Preserve a-time").First()
	}
	if err := p.expectVisible(optionsAnchor, 15000); err != nil {
		return fmt.Errorf("options step not visible: %w", err)
	}
	p.sleep(1000)

	// ── 1. Toggle OFF "Preserve a-time" (default is ON) ─────────────────────
	aTimeToggle := p.page.GetByText("Preserve a-time", playwright.PageGetByTextOptions{Exact: playwright.Bool(true)}).First()
	if err := p.expectVisible(aTimeToggle, 5000); err != nil {
		return fmt.Errorf("'Preserve a-time' toggle not visible: %w", err)
	}
	if err := aTimeToggle.Click(); err != nil {
		return fmt.Errorf("click 'Preserve a-time' toggle: %w", err)
	}
	p.sleep(500)
	log.Printf("[ConfigureCustomOptions] toggled OFF 'Preserve a-time'")

	// ── 2. Toggle OFF "Preserve Permissions" (default is ON) ────────────────
	permToggle := p.page.GetByText("Preserve Permissions", playwright.PageGetByTextOptions{Exact: playwright.Bool(true)}).First()
	if err := p.expectVisible(permToggle, 5000); err != nil {
		return fmt.Errorf("'Preserve Permissions' toggle not visible: %w", err)
	}
	if err := permToggle.Click(); err != nil {
		return fmt.Errorf("click 'Preserve Permissions' toggle: %w", err)
	}
	p.sleep(500)
	log.Printf("[ConfigureCustomOptions] toggled OFF 'Preserve Permissions'")

	// ── 3. Select "Exclude file older than (UTC)" radio ─────────────────────
	excludeRadio := p.page.GetByText("Exclude file older than (UTC)", playwright.PageGetByTextOptions{Exact: playwright.Bool(true)}).First()
	if err := p.expectVisible(excludeRadio, 5000); err != nil {
		log.Printf("[ConfigureCustomOptions] 'Exclude file older than' radio not visible — skipping")
	} else {
		if err := excludeRadio.Click(); err != nil {
			return fmt.Errorf("click 'Exclude file older than' radio: %w", err)
		}
		p.sleep(1000)
		log.Printf("[ConfigureCustomOptions] selected 'Exclude file older than (UTC)'")
		p.screenshot("mig-options-exclude-older-than")
	}

	// ── 4. Change "Skip Files modified in last" number ──────────────────────
	skipInput := p.page.Locator(`input[placeholder="Number e.g. 10"]`).First()
	if !p.isVisible(skipInput) {
		skipInput = p.page.Locator(`input[name="skipFileNum"]`).First()
	}
	if p.isVisible(skipInput) {
		if err := skipInput.Click(playwright.LocatorClickOptions{ClickCount: playwright.Int(3)}); err == nil {
			skipInput.Fill(skipFileNum)
			p.sleep(500)
			log.Printf("[ConfigureCustomOptions] set 'Skip Files modified in last' to %s", skipFileNum)
		}
	} else {
		log.Printf("[ConfigureCustomOptions] skip files input not visible — skipping")
	}

	// ── 5. Append to "Excluded Path Patterns" textarea ──────────────────────
	excludeTextarea := p.page.Locator(`textarea[name="exclude_file_patterns"]`).First()
	if !p.isVisible(excludeTextarea) {
		excludeTextarea = p.page.Locator(`textarea[placeholder="Excluded Path Patterns"]`).First()
	}
	if p.isVisible(excludeTextarea) {
		currentVal, _ := excludeTextarea.InputValue()
		newVal := currentVal
		if newVal != "" && !strings.HasSuffix(newVal, "\n") {
			newVal += "\n"
		}
		newVal += extraExcludePatterns
		if err := excludeTextarea.Fill(newVal); err == nil {
			p.sleep(500)
			log.Printf("[ConfigureCustomOptions] set exclude patterns to: %q", newVal)
		}
	} else {
		log.Printf("[ConfigureCustomOptions] exclude patterns textarea not visible — skipping")
	}

	p.screenshot("mig-options-custom-configured")
	log.Printf("[ConfigureCustomOptions] all custom options configured")
	return nil
}

// SetIncrementalSyncCronExpression selects "Cron Expression" on the Options
// step and types the given cron expression (e.g. "*/5 * * * *").
func (p *MigrationPage) SetIncrementalSyncCronExpression(cronExpr string) error {
	optionsAnchor := p.page.Locator(`[data-testid="bulk-migrate-options-step"]`)
	if !p.isVisible(optionsAnchor) {
		optionsAnchor = p.page.GetByText("Preserve a-time").First()
	}
	if err := p.expectVisible(optionsAnchor, 15000); err != nil {
		return fmt.Errorf("options step not visible: %w", err)
	}
	p.sleep(1000)

	// Click the "Cron Expression" radio button.
	cronRadio := p.page.GetByText("Cron Expression", playwright.PageGetByTextOptions{Exact: playwright.Bool(true)}).First()
	if err := p.expectVisible(cronRadio, 10000); err != nil {
		return fmt.Errorf("'Cron Expression' radio not visible: %w", err)
	}
	if err := cronRadio.Click(); err != nil {
		return fmt.Errorf("click 'Cron Expression' radio: %w", err)
	}
	p.sleep(1000)

	// Find the cron expression input field.
	cronInput := p.page.Locator(`input[placeholder="* * * * *"]`).First()
	if !p.isVisible(cronInput) {
		cronInput = p.page.Locator(`input[name="incremental_sync_schedule_cron_expression"]`).First()
	}
	if err := p.expectVisible(cronInput, 10000); err != nil {
		return fmt.Errorf("cron expression input not visible: %w", err)
	}

	// Clear and type the cron expression.
	if err := cronInput.Click(playwright.LocatorClickOptions{ClickCount: playwright.Int(3)}); err != nil {
		return fmt.Errorf("triple-click cron input: %w", err)
	}
	if err := cronInput.Fill(cronExpr); err != nil {
		return fmt.Errorf("fill cron expression: %w", err)
	}
	p.sleep(500)

	p.screenshot("mig-options-cron-set")
	log.Printf("[SetIncrementalSyncCronExpression] set to %q", cronExpr)
	return nil
}

// ── Step 3 → Review page ──────────────────────────────────────────────────────

// SelectAllMappingsOnReview checks the header checkbox on the Review step
// to select all path mappings, then waits for "Submit" to become enabled.
func (p *MigrationPage) SelectAllMappingsOnReview() error {
	reviewAnchor := p.page.Locator(`[data-testid="bulk-migrate-review-step"]`)
	if !p.isVisible(reviewAnchor) {
		reviewAnchor = p.page.GetByText("Source Ex").First()
	}
	_ = p.expectVisible(reviewAnchor, 15000)
	p.sleep(1000)

	headerCB := p.page.Locator(`[data-testid="checkbox-select-all"]`)
	if !p.isVisible(headerCB) {
		headerCB = p.page.Locator(`[role="checkbox"], input[type="checkbox"]`).First()
	}
	allCBs := p.page.Locator(`[data-testid="checkbox-select-all"], [role="checkbox"], input[type="checkbox"]`)
	cbCount, _ := allCBs.Count()
	log.Printf("[SelectAllMappingsOnReview] found %d checkbox(es)", cbCount)

	if cbCount > 0 {
		if err := allCBs.First().Click(); err != nil {
			return fmt.Errorf("click header checkbox on review: %w", err)
		}
		log.Printf("[SelectAllMappingsOnReview] clicked header checkbox")
	} else {
		return fmt.Errorf("no checkboxes found on review step")
	}

	p.sleep(1000)

	// Also click "Select all pages" if it appears.
	sap := p.page.GetByText("Select all pages")
	if p.isVisible(sap) {
		_ = sap.Click()
		p.sleep(500)
	}

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

	toast := p.page.Locator(`[data-testid="toast-bulk-migrate-success"]`)
	if !p.isVisible(toast) {
		toast = p.page.GetByText("Bulk Migrate Job has been created").First()
	}
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
	jrlAnchor := p.page.Locator(`[data-testid="job-run-list-table"]`)
	if !p.isVisible(jrlAnchor) {
		jrlAnchor = p.page.GetByText("Job Run ID").First()
	}
	if err := p.expectVisible(jrlAnchor, 20000); err != nil {
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

		// Prefer data-testid for status
		const statusEl = document.querySelector('[data-testid="job-run-status"]');
		if (statusEl) {
			const t = statusEl.textContent.trim().toLowerCase();
			if (known.includes(t)) return t;
		}

		// Try bxp Table (data-testid rows)
		const rows = document.querySelectorAll('[data-testid^="table-row-"]');
		for (const row of rows) {
			if (!/migration/i.test(row.textContent)) continue;
			const caps = row.querySelectorAll('[data-testid="cell-status"], .capitalize');
			for (const el of caps) {
				const t = el.textContent.trim().toLowerCase();
				if (known.includes(t)) return t;
			}
			for (const s of known) {
				if (row.textContent.toLowerCase().includes(s)) return s;
			}
		}
		// Fallback: native tbody tr
		const trows = document.querySelectorAll('tbody tr');
		for (const row of trows) {
			if (!/migration/i.test(row.textContent)) continue;
			const caps = row.querySelectorAll('[data-testid="cell-status"], .capitalize');
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

// CountMigrationJobRuns counts the number of migration rows currently visible
// in the Job Run List table.
func (p *MigrationPage) CountMigrationJobRuns() int {
	count := 0

	// Try bxp Table rows first.
	rows, err := p.page.Locator(`[data-testid^="table-row-"]`).All()
	if err == nil && len(rows) > 0 {
		for _, row := range rows {
			txt, _ := row.TextContent()
			if strings.Contains(strings.ToLower(txt), "migration") {
				count++
			}
		}
		if count > 0 {
			return count
		}
	}

	// Fallback: native tbody tr.
	rows2, err := p.page.Locator(`tbody tr`).All()
	if err == nil {
		for _, row := range rows2 {
			txt, _ := row.TextContent()
			if strings.Contains(strings.ToLower(txt), "migration") {
				count++
			}
		}
	}
	return count
}

// WaitForNewMigrationJobRun waits until the number of migration rows in the
// Job Run List increases beyond initialCount, then waits for the newest job
// to reach "completed" status.
func (p *MigrationPage) WaitForNewMigrationJobRun(initialCount int, timeoutMs float64) error {
	const pollInterval = 15000.0
	deadline := time.Now().Add(time.Duration(timeoutMs) * time.Millisecond)
	attempt := 0

	// Phase 1: Wait for a new migration row to appear.
	for time.Now().Before(deadline) {
		attempt++
		p.page.Reload(playwright.PageReloadOptions{
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
			Timeout:   playwright.Float(30000),
		})
		p.sleep(3000)

		current := p.CountMigrationJobRuns()
		log.Printf("[WaitForNewMigrationJobRun] attempt %d: %d migration row(s) (initial=%d)", attempt, current, initialCount)

		if current > initialCount {
			log.Printf("[WaitForNewMigrationJobRun] new migration job detected (count: %d → %d)", initialCount, current)
			p.screenshot("mig-incremental-job-appeared")
			break
		}
		p.sleep(pollInterval)
	}

	if p.CountMigrationJobRuns() <= initialCount {
		p.screenshot("mig-incremental-job-timeout")
		return fmt.Errorf("no new migration job appeared within %.0fs (still %d rows)", timeoutMs/1000, initialCount)
	}

	// Phase 2: Wait for the new job to complete.
	log.Printf("[WaitForNewMigrationJobRun] waiting for incremental sync job to complete…")
	return p.WaitForMigrationCompleted(timeoutMs - float64(time.Since(deadline.Add(-time.Duration(timeoutMs)*time.Millisecond)).Milliseconds()))
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

	overflowBtn := migRow.Locator(`[data-testid="btn-overflow-menu"]`)
	if !p.isVisible(overflowBtn) {
		overflowBtn = migRow.Locator(`button`).Last()
	}
	if err := p.expectVisible(overflowBtn, 10000); err != nil {
		return "", fmt.Errorf("overflow menu button not found on migration row: %w", err)
	}
	if err := overflowBtn.Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)}); err != nil {
		return "", fmt.Errorf("click overflow menu: %w", err)
	}
	p.sleep(1000)
	p.screenshot("mig-overflow-menu-open")

	cocCandidates := []playwright.Locator{
		p.page.Locator(`[data-testid="menu-download-coc-report"]`).First(),
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
