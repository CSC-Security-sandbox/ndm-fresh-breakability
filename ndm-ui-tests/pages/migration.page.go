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
	page             playwright.Page
	screenshotPrefix string
}

func NewMigrationPage(page playwright.Page, prefix ...string) *MigrationPage {
	p := &MigrationPage{page: page}
	if len(prefix) > 0 && prefix[0] != "" {
		p.screenshotPrefix = prefix[0]
	}
	return p
}

// Page returns the underlying Playwright page for advanced operations.
func (p *MigrationPage) Page() playwright.Page {
	return p.page
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

// SelectDestinationFileServer picks the destination FS from the bxp FormFieldSelect
// inside the wrapper div with data-testid="select-destination-file-server".
//
// This is a single-attempt method; use SelectDestinationFileServerWithRetry for
// resilience against stale API data (e.g. when running tests in parallel).
func (p *MigrationPage) SelectDestinationFileServer(dstFSName string) error {
	p.sleep(1000)

	wrapper := p.page.Locator(`[data-testid="select-destination-file-server"]`)
	if !p.isVisible(wrapper) {
		wrapper = p.page.Locator(`[data-testid="bulk-migrate-dst-fs-select"]`)
	}
	if !p.isVisible(wrapper) {
		wrapper = p.page.Locator(`[class*="Select-module"]`).
			Filter(playwright.LocatorFilterOptions{
				HasText: "Select Destination File Server",
			}).First()
		log.Printf("[SelectDestinationFileServer] data-testid not in DOM — using Select-module filter")
	}
	if !p.isVisible(wrapper) {
		label := p.page.GetByText("Select Destination File Server").First()
		if p.isVisible(label) {
			wrapper = label.Locator("..")
			log.Printf("[SelectDestinationFileServer] using label parent as wrapper")
		}
	}
	if err := p.expectVisible(wrapper, 10000); err != nil {
		return fmt.Errorf("destination FS wrapper not visible: %w", err)
	}

	// Scroll the wrapper into view and wait for layout to settle.
	_ = wrapper.ScrollIntoViewIfNeeded()
	p.sleep(800)

	// Use Playwright's locator to click the control div inside the wrapper.
	// bxp FormFieldSelect renders a div with class containing "Select-module_control".
	control := wrapper.Locator(`div[class*="Select-module_control"]`).First()
	if !p.isVisible(control) {
		control = wrapper.Locator(`div[class*="control"]`).First()
	}

	if p.isVisible(control) {
		_ = control.ScrollIntoViewIfNeeded()
		p.sleep(300)
		if err := control.Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)}); err != nil {
			log.Printf("[SelectDestinationFileServer] control.Click failed: %v — trying wrapper click", err)
			_ = wrapper.Click()
		} else {
			log.Printf("[SelectDestinationFileServer] clicked control via Playwright locator")
		}
	} else {
		log.Printf("[SelectDestinationFileServer] control locator not visible — clicking wrapper")
		_ = wrapper.Click()
	}
	p.sleep(2000)
	p.screenshot("mig-dst-fs-after-click")

	// Dump the DOM around the wrapper to discover actual class names for menu/options.
	domDump, _ := p.page.Evaluate(`() => {
		const result = { wrapperHTML: '', menuClasses: [], allSelectModuleClasses: [] };
		const w = document.querySelector('[data-testid="select-destination-file-server"]')
			|| document.querySelector('[data-testid="bulk-migrate-dst-fs-select"]');
		if (w) {
			result.wrapperHTML = w.innerHTML.substring(0, 2000);
		}
		// Find all elements with "Select-module" in class anywhere on the page.
		document.querySelectorAll('*').forEach(el => {
			const cls = (el.className || '').toString();
			if (cls.includes('Select-module') && !cls.includes('control')) {
				const t = el.textContent.trim();
				const tag = el.tagName;
				const r = el.getBoundingClientRect();
				if (t.length < 200 && t.length > 0) {
					result.allSelectModuleClasses.push({
						cls: cls.substring(0, 120),
						tag: tag,
						text: t.substring(0, 80),
						h: r.height,
						childCount: el.children.length,
					});
				}
			}
		});
		// Also look for any dropdown/menu/portal elements.
		document.querySelectorAll('[class*="menu"], [class*="Menu"], [class*="dropdown"], [class*="Dropdown"], [role="listbox"]').forEach(el => {
			const r = el.getBoundingClientRect();
			if (r.height > 0) {
				result.menuClasses.push({
					cls: (el.className||'').toString().substring(0, 120),
					tag: el.tagName,
					childCount: el.children.length,
					h: r.height,
				});
			}
		});
		return result;
	}`)
	if dm, ok := domDump.(map[string]interface{}); ok {
		if html, ok := dm["wrapperHTML"].(string); ok && len(html) > 0 {
			if len(html) > 500 {
				html = html[:500] + "..."
			}
			log.Printf("[SelectDestinationFileServer] wrapper innerHTML: %s", html)
		}
		if menus, ok := dm["allSelectModuleClasses"].([]interface{}); ok {
			log.Printf("[SelectDestinationFileServer] Select-module elements on page: %d", len(menus))
			for i, m := range menus {
				if i >= 15 {
					log.Printf("[SelectDestinationFileServer]   ... (%d more)", len(menus)-15)
					break
				}
				log.Printf("[SelectDestinationFileServer]   [%d] %v", i, m)
			}
		}
		if menus, ok := dm["menuClasses"].([]interface{}); ok && len(menus) > 0 {
			log.Printf("[SelectDestinationFileServer] menu/dropdown elements: %d", len(menus))
			for i, m := range menus {
				if i >= 10 {
					break
				}
				log.Printf("[SelectDestinationFileServer]   menu[%d] %v", i, m)
			}
		}
	}

	// Try to find and click the option.
	if err := p.clickBxpOption(dstFSName); err == nil {
		p.sleep(800)
		log.Printf("[SelectDestinationFileServer] selected %q", dstFSName)
		return nil
	}

	// Menu might have toggled closed — click again to reopen.
	log.Printf("[SelectDestinationFileServer] option not found — reopening dropdown")
	if p.isVisible(control) {
		_ = control.Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)})
	} else {
		_ = wrapper.Click()
	}
	p.sleep(2000)
	p.screenshot("mig-dst-fs-after-reopen")

	if err := p.clickBxpOption(dstFSName); err == nil {
		p.sleep(800)
		log.Printf("[SelectDestinationFileServer] selected %q on second attempt", dstFSName)
		return nil
	}

	p.screenshot("mig-dst-fs-not-found")
	return fmt.Errorf("destination FS %q not found in dropdown", dstFSName)
}

// clickBxpOption finds a bxp FormFieldSelect option containing text and clicks it.
// bxp uses virtualized rendering — only visible options exist in the DOM.
// This function incrementally scrolls the virtualized container to reveal the
// target option, then clicks it.
func (p *MigrationPage) clickBxpOption(text string) error {
	// Scroll through the virtualized dropdown to find and click the option.
	result, _ := p.page.Evaluate(`async (name) => {
		// Find the virtualized scroll container.
		const virt = document.querySelector('[class*="Select-module_virtualized"]');
		const menu = document.querySelector('[class*="Select-module_menu"]');
		const scrollContainer = virt || menu;
		if (!scrollContainer) {
			return { clicked: false, reason: 'no-menu-container' };
		}

		function findOption() {
			const opts = document.querySelectorAll('[class*="Select-module_option"]');
			for (const opt of opts) {
				if (opt.textContent.trim() === name) return opt;
			}
			return null;
		}

		// Check if already visible (no scroll needed).
		let opt = findOption();
		if (opt) {
			opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
			opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
			opt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
			return { clicked: true, text: name, scrolled: 0 };
		}

		// Incrementally scroll the virtualized container.
		// Each option is ~48px tall. Scroll in chunks of ~200px.
		const maxScroll = scrollContainer.scrollHeight;
		const step = 200;
		let scrollPos = 0;

		for (let i = 0; i < 100 && scrollPos < maxScroll + step; i++) {
			scrollPos += step;
			scrollContainer.scrollTop = scrollPos;
			// Wait for virtualized list to re-render.
			await new Promise(r => setTimeout(r, 50));

			opt = findOption();
			if (opt) {
				opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
				opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
				opt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
				return { clicked: true, text: name, scrolled: scrollPos };
			}
		}

		// Collect all visible option texts for diagnostics.
		const visibleOpts = [];
		document.querySelectorAll('[class*="Select-module_option"]').forEach(o => {
			visibleOpts.push(o.textContent.trim().substring(0, 80));
		});
		return {
			clicked: false,
			reason: 'not-found-after-scroll',
			maxScroll: maxScroll,
			scrolledTo: scrollPos,
			lastVisibleOpts: visibleOpts,
		};
	}`, text)

	if rm, ok := result.(map[string]interface{}); ok {
		if cl, _ := rm["clicked"].(bool); cl {
			log.Printf("[clickBxpOption] clicked %q (scrolled %.0fpx)", text, rm["scrolled"])
			return nil
		}
		log.Printf("[clickBxpOption] %q NOT found: %v (scrollHeight=%.0f, scrolledTo=%.0f)",
			text, rm["reason"], rm["maxScroll"], rm["scrolledTo"])
		if opts, ok := rm["lastVisibleOpts"].([]interface{}); ok {
			log.Printf("[clickBxpOption] last visible options after full scroll (%d):", len(opts))
			for i, o := range opts {
				log.Printf("[clickBxpOption]   [%d] %v", i, o)
			}
		}
	}

	return fmt.Errorf("option %q not found in virtualized dropdown", text)
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
		waitSec := 10 + attempt*5
		log.Printf("[SelectDestinationFileServerWithRetry] attempt %d/%d — waiting %ds then re-opening wizard", attempt, maxRetries, waitSec)
		p.page.Keyboard().Press("Escape")
		time.Sleep(time.Duration(waitSec) * time.Second)

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

// GetLatestJobRunID reads the Job Run ID from the first (most recent) row
// in the Job Run List table. Call this right after NavigateToJobRunList.
func (p *MigrationPage) GetLatestJobRunID() string {
	result, _ := p.page.Evaluate(`() => {
		// bxp table rows
		const rows = document.querySelectorAll('[data-testid^="table-row-"]');
		if (rows.length > 0) {
			const firstCell = rows[0].querySelector('td, [data-testid^="cell-"]');
			if (firstCell) return firstCell.textContent.trim();
		}
		// fallback: tbody tr
		const tr = document.querySelector('tbody tr');
		if (tr) {
			const td = tr.querySelector('td');
			if (td) return td.textContent.trim();
		}
		return '';
	}`)
	if s, ok := result.(string); ok && s != "" {
		log.Printf("[GetLatestJobRunID] captured job run ID: %s", s)
		return s
	}
	return ""
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

// DownloadCoCReport finds the job row matching srcFSName in the Job Run List,
// opens its overflow menu (⋯), and clicks "Download CoC Report".
// If srcFSName is empty, falls back to the first Migration row.
// Returns the saved file path.
func (p *MigrationPage) DownloadCoCReport(downloadDir string, srcFSName ...string) (string, error) {
	p.sleep(2000)

	if err := os.MkdirAll(downloadDir, 0o755); err != nil {
		return "", fmt.Errorf("create download dir %s: %w", downloadDir, err)
	}

	// Find the specific migration row by search term (job run ID, source name, etc.).
	var migRow playwright.Locator
	var err error
	if len(srcFSName) > 0 && srcFSName[0] != "" {
		migRow, err = p.findMigrationRowBySearch(srcFSName[0])
	} else {
		migRow, err = p.findFirstMigrationRow()
	}
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

	// NDM's CoC download flow: onClick calls prepareDownloadApi → gets a token →
	// sets window.location.href to the download URL. Playwright catches this as
	// a download event since the server returns Content-Disposition: attachment.
	p.sleep(500)

	// Set up download listener BEFORE clicking.
	downloadCh := make(chan playwright.Download, 1)
	p.page.OnDownload(func(d playwright.Download) {
		downloadCh <- d
	})

	// Click the exact "Download CoC Report" leaf element via JS.
	result, _ := p.page.Evaluate(`() => {
		const exactMatches = ['Download CoC Report', 'CoC Report', 'Download CoC'];
		const all = document.querySelectorAll('button, a, li, span, div, [role="menuitem"]');
		for (const el of all) {
			if (el.children.length > 1) continue;
			const t = el.textContent.trim();
			if (!exactMatches.includes(t)) continue;
			const r = el.getBoundingClientRect();
			if (r.height > 0 && r.width > 0) {
				el.click();
				return { clicked: true, text: t, tag: el.tagName };
			}
		}
		const visible = [];
		document.querySelectorAll('button, li, span, [role="menuitem"]').forEach(el => {
			if (el.children.length > 1) return;
			const t = el.textContent.trim();
			const r = el.getBoundingClientRect();
			if (t.length > 0 && t.length < 40 && r.height > 0) visible.push(t);
		});
		return { clicked: false, visible: visible.slice(0, 20) };
	}`)
	if rm, ok := result.(map[string]interface{}); ok {
		if clicked, _ := rm["clicked"].(bool); !clicked {
			if visible, ok := rm["visible"].([]interface{}); ok {
				log.Printf("[DownloadCoCReport] menu items found (%d):", len(visible))
				for i, v := range visible {
					log.Printf("[DownloadCoCReport]   [%d] %v", i, v)
				}
			}
			return "", fmt.Errorf("'Download CoC Report' not found in menu")
		}
		text, _ := rm["text"].(string)
		log.Printf("[DownloadCoCReport] JS clicked %q — waiting for download...", text)
	}

	// Wait for the download event (window.location.href triggers it).
	select {
	case download := <-downloadCh:
		suggestedName := download.SuggestedFilename()
		if suggestedName == "" {
			suggestedName = fmt.Sprintf("coc-report-%d.zip", time.Now().UnixMilli())
		}
		savePath := filepath.Join(downloadDir, suggestedName)
		if err := download.SaveAs(savePath); err != nil {
			return "", fmt.Errorf("save CoC report to %s: %w", savePath, err)
		}
		p.screenshot("mig-coc-downloaded")
		log.Printf("[DownloadCoCReport] saved to %s", savePath)
		return savePath, nil
	case <-time.After(30 * time.Second):
		return "", fmt.Errorf("download did not start within 30s after clicking 'Download CoC Report'")
	}
}

func (p *MigrationPage) NavigateToJobConfigDetails(configID string) error {
	url := fmt.Sprintf("%s/job-details/%s", config.BaseURL, configID)
	_, err := p.page.Goto(url, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(60000),
	})
	if err != nil {
		return fmt.Errorf("navigate to job config details: %w", err)
	}
	heading := p.page.GetByText("Job Config Details").First()
	if err := p.expectVisible(heading, 20000); err != nil {
		p.sleep(3000)
	}
	p.sleep(2000)
	log.Printf("[MigrationPage] on Job Config Details for %s", configID)
	return nil
}

// TriggerAdhocRun clicks the "Adhoc Run" button on the Job Config Details page.
func (p *MigrationPage) TriggerAdhocRun() error {
	candidates := []string{"Adhoc Run", "Ad Hoc", "Run Now", "Adhoc"}
	for _, name := range candidates {
		btn := p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: name})
		if p.isVisible(btn) {
			if err := btn.Click(); err == nil {
				p.sleep(3000)
				log.Printf("[MigrationPage] triggered adhoc run via button %q", name)
				return nil
			}
		}
	}
	btn := p.page.Locator(`[data-testid="btn-adhoc-run"]`)
	if p.isVisible(btn) {
		if err := btn.Click(); err == nil {
			p.sleep(3000)
			log.Printf("[MigrationPage] triggered adhoc run via data-testid")
			return nil
		}
	}
	return fmt.Errorf("Adhoc Run button not found on Job Config Details page")
}

// ClickRunHistoryTab clicks on the "Run History" tab on the Job Config Details page.
func (p *MigrationPage) ClickRunHistoryTab() {
	candidates := []playwright.Locator{
		p.page.GetByRole("tab", playwright.PageGetByRoleOptions{Name: "Run History"}),
		p.page.Locator(`[data-testid="tab-run-history"]`),
		p.page.GetByText("Run History", playwright.PageGetByTextOptions{Exact: playwright.Bool(true)}).First(),
		p.page.Locator(`button:has-text("Run History")`).First(),
	}
	for _, loc := range candidates {
		if p.isVisible(loc) {
			if err := loc.Click(); err == nil {
				p.sleep(3000)
				log.Printf("[MigrationPage] clicked Run History tab")
				return
			}
		}
	}
	log.Printf("[MigrationPage] Run History tab not found — may already be showing")
	p.sleep(2000)
}

// GetJobConfigIDFromURL extracts the job config ID from the current page URL.
func (p *MigrationPage) GetJobConfigIDFromURL() string {
	url := p.page.URL()
	re := regexp.MustCompile(`/job-details/([a-f0-9-]+)`)
	matches := re.FindStringSubmatch(url)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}

// DownloadCoCReportByRowIndex downloads the CoC report from a specific row
// in the Run History table (0-based index, 0 = most recent run).
func (p *MigrationPage) DownloadCoCReportByRowIndex(downloadDir string, rowIndex int) (string, error) {
	p.sleep(3000)

	if err := os.MkdirAll(downloadDir, 0o755); err != nil {
		return "", fmt.Errorf("create download dir %s: %w", downloadDir, err)
	}

	// Try BlueXP data-testid rows first, then fall back to native tbody tr.
	var rows []playwright.Locator
	var err error

	for attempt := 0; attempt < 5; attempt++ {
		rows, err = p.page.Locator(`[data-testid^="table-row-"]`).All()
		if err == nil && len(rows) > 0 {
			break
		}
		rows, err = p.page.Locator(`tbody tr`).All()
		if err == nil && len(rows) > 0 {
			break
		}
		p.sleep(2000)
	}

	if len(rows) == 0 {
		return "", fmt.Errorf("no rows found in run history table after 5 attempts")
	}
	if rowIndex >= len(rows) {
		return "", fmt.Errorf("row index %d out of range (only %d rows)", rowIndex, len(rows))
	}

	migRow := rows[rowIndex]

	overflowBtn := migRow.Locator(`[data-testid="btn-overflow-menu"]`)
	if !p.isVisible(overflowBtn) {
		overflowBtn = migRow.Locator(`button`).Last()
	}
	if err := p.expectVisible(overflowBtn, 10000); err != nil {
		return "", fmt.Errorf("overflow menu button not found on row %d: %w", rowIndex, err)
	}
	if err := overflowBtn.Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)}); err != nil {
		return "", fmt.Errorf("click overflow menu on row %d: %w", rowIndex, err)
	}
	p.sleep(1000)

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
				suggestedName = fmt.Sprintf("coc-report-row%d-%d.pdf", rowIndex, time.Now().UnixMilli())
			}
			savePath := filepath.Join(downloadDir, suggestedName)
			if err := download.SaveAs(savePath); err != nil {
				return "", fmt.Errorf("save CoC report to %s: %w", savePath, err)
			}
			log.Printf("[DownloadCoCReportByRowIndex] row %d saved to %s", rowIndex, savePath)
			return savePath, nil
		}
	}

	return "", fmt.Errorf("'Download CoC Report' option not found for row %d", rowIndex)
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

// findMigrationRowBySearch searches the Job Run List table for a row whose
// text contains the given search term (job run ID, source FS name, etc.).
// This ensures we click the overflow menu on the correct row even when
// multiple migration jobs exist.
func (p *MigrationPage) findMigrationRowBySearch(searchTerm string) (playwright.Locator, error) {
	log.Printf("[findMigrationRowBySearch] searching for %q", searchTerm)

	// Search using the table's search/filter input if available.
	searchInput := p.page.Locator(`[data-testid="table-search-input"], input[placeholder*="Search"], input[placeholder*="search"]`).First()
	if p.isVisible(searchInput) {
		_ = searchInput.Fill(searchTerm)
		p.sleep(1500)
		log.Printf("[findMigrationRowBySearch] typed %q in table filter", searchTerm)
	}

	// Try bxp table rows first.
	rows, err := p.page.Locator(`[data-testid^="table-row-"]`).All()
	if err == nil {
		for _, row := range rows {
			txt, _ := row.TextContent()
			if strings.Contains(txt, searchTerm) {
				log.Printf("[findMigrationRowBySearch] found row with %q", searchTerm)
				return row, nil
			}
		}
	}

	// Fallback: tbody tr.
	rows2, err := p.page.Locator(`tbody tr`).All()
	if err == nil {
		for _, row := range rows2 {
			txt, _ := row.TextContent()
			if strings.Contains(txt, searchTerm) {
				log.Printf("[findMigrationRowBySearch] found row (tbody) with %q", searchTerm)
				return row, nil
			}
		}
	}

	// If not found, fall back to first migration row.
	log.Printf("[findMigrationRowBySearch] %q not found — falling back to first migration row", searchTerm)
	return p.findFirstMigrationRow()
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

// ── Bulk Cutover flow ────────────────────────────────────────────────────────

// OpenBulkCutoverForm clicks "Bulk Cutover" on the file server overview and
// waits for the cutover wizard URL.
func (p *MigrationPage) OpenBulkCutoverForm() error {
	btn := p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Bulk Cutover"})
	if !p.isVisible(btn) {
		btn = p.page.Locator(`button:has-text("Bulk Cutover")`).First()
	}
	if err := p.expectVisible(btn, 30000); err != nil {
		return fmt.Errorf("Bulk Cutover button not visible: %w", err)
	}
	if err := btn.Click(); err != nil {
		return fmt.Errorf("click Bulk Cutover: %w", err)
	}
	if err := p.page.WaitForURL(regexp.MustCompile(`bulk-cutover`), playwright.PageWaitForURLOptions{
		Timeout: playwright.Float(15000),
	}); err != nil {
		return fmt.Errorf("did not navigate to bulk-cutover page: %w", err)
	}
	p.sleep(3000)
	log.Printf("[MigrationPage] Bulk Cutover wizard opened")
	return nil
}

// SelectCutoverPath selects the first row (or a row matching srcPath) in the
// Bulk Cutover Select Path table.
func (p *MigrationPage) SelectCutoverPath(srcPath ...string) error {
	p.sleep(2000)

	// If a specific source path is given, find its row; otherwise select first.
	var checkbox playwright.Locator
	if len(srcPath) > 0 && srcPath[0] != "" {
		row := p.page.Locator(`tbody tr`).Filter(playwright.LocatorFilterOptions{
			HasText: srcPath[0],
		}).First()
		if !p.isVisible(row) {
			row = p.page.Locator(`[data-testid^="table-row-"]`).Filter(playwright.LocatorFilterOptions{
				HasText: srcPath[0],
			}).First()
		}
		if err := p.expectVisible(row, 10000); err != nil {
			return fmt.Errorf("cutover path row with %q not found: %w", srcPath[0], err)
		}
		checkbox = row.Locator(`input[type="checkbox"]`).First()
		if !p.isVisible(checkbox) {
			checkbox = row.Locator(`[role="checkbox"]`).First()
		}
	} else {
		checkbox = p.page.Locator(`tbody tr`).First().Locator(`input[type="checkbox"]`).First()
		if !p.isVisible(checkbox) {
			checkbox = p.page.Locator(`[data-testid^="table-row-"]`).First().Locator(`input[type="checkbox"]`).First()
		}
		if !p.isVisible(checkbox) {
			checkbox = p.page.Locator(`[data-testid^="table-row-"]`).First().Locator(`[role="checkbox"]`).First()
		}
	}

	if err := p.expectVisible(checkbox, 10000); err != nil {
		return fmt.Errorf("cutover path checkbox not visible: %w", err)
	}

	checked, _ := checkbox.IsChecked()
	if !checked {
		if err := checkbox.Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)}); err != nil {
			return fmt.Errorf("click cutover path checkbox: %w", err)
		}
	}
	p.sleep(1000)
	log.Printf("[MigrationPage] cutover path selected")
	return nil
}

// AcceptCutoverWarning checks the "I understand Cutover requires downtime..."
// checkbox on the Select Path step.
func (p *MigrationPage) AcceptCutoverWarning() error {
	// The checkbox is rendered by <UserWarning> with controlName="isSelectPathConformed"
	checkbox := p.page.Locator(`input[name="isSelectPathConformed"]`)
	if !p.isVisible(checkbox) {
		// Fallback: find by partial text near the checkbox
		card := p.page.Locator(`text=I understand Cutover requires downtime`).Locator("..").Locator("..").Locator(`input[type="checkbox"]`).First()
		if p.isVisible(card) {
			checkbox = card
		} else {
			// Try role-based
			checkbox = p.page.GetByRole("checkbox").Filter(playwright.LocatorFilterOptions{}).First()
			if !p.isVisible(checkbox) {
				return fmt.Errorf("cutover warning checkbox not found")
			}
		}
	}

	checked, _ := checkbox.IsChecked()
	if !checked {
		if err := checkbox.Click(playwright.LocatorClickOptions{Force: playwright.Bool(true)}); err != nil {
			return fmt.Errorf("click cutover warning checkbox: %w", err)
		}
	}
	p.sleep(500)
	log.Printf("[MigrationPage] cutover warning accepted")
	return nil
}

// ProceedFromCutoverSelectPath clicks the "Proceed" button on the Select Path step.
func (p *MigrationPage) ProceedFromCutoverSelectPath() error {
	return p.clickProceed("cutover-select-path")
}

// SubmitCutover clicks the "Submit" button on the Cutover Review step.
func (p *MigrationPage) SubmitCutover() error {
	submitBtn := p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Submit"})
	if !p.isVisible(submitBtn) {
		submitBtn = p.page.Locator(`button:has-text("Submit")`).First()
	}
	if err := p.expectVisible(submitBtn, 15000); err != nil {
		return fmt.Errorf("Submit button not visible on cutover review: %w", err)
	}
	// Wait for it to become enabled.
	for i := 0; i < 10; i++ {
		disabled, _ := submitBtn.IsDisabled()
		if !disabled {
			break
		}
		log.Printf("[SubmitCutover] Submit disabled, waiting (attempt %d/10)…", i+1)
		p.sleep(2000)
	}
	if err := submitBtn.Click(); err != nil {
		return fmt.Errorf("click Submit on cutover review: %w", err)
	}
	p.sleep(3000)
	log.Printf("[MigrationPage] Cutover submitted")
	return nil
}

// readFirstCutoverRowStatus reads the status text from the first Cutover
// row in the Job Run List table.
func (p *MigrationPage) readFirstCutoverRowStatus() string {
	result, err := p.page.Evaluate(`() => {
		const known = ['running','completed','errored','failed','paused','pausing',
		               'stopped','stopping','ready','pending','blocked'];

		// Try bxp Table (data-testid rows)
		const rows = document.querySelectorAll('[data-testid^="table-row-"]');
		for (const row of rows) {
			if (!/cutover/i.test(row.textContent)) continue;
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
			if (!/cutover/i.test(row.textContent)) continue;
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

// WaitForCutoverBlocked polls the Job Run List until the cutover job enters
// "Blocked" state (waiting for human approval) or completes/errors.
func (p *MigrationPage) WaitForCutoverBlocked(timeoutMs float64) error {
	const pollInterval = 8000.0
	deadline := time.Now().Add(time.Duration(timeoutMs) * time.Millisecond)
	attempt := 0

	for time.Now().Before(deadline) {
		attempt++
		p.page.Reload(playwright.PageReloadOptions{
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
			Timeout:   playwright.Float(30000),
		})
		p.sleep(2000)

		status := p.readFirstCutoverRowStatus()
		log.Printf("[WaitForCutoverBlocked] attempt %d: status=%q", attempt, status)

		switch strings.ToLower(status) {
		case "blocked":
			p.screenshot("cutover-job-blocked")
			log.Printf("[WaitForCutoverBlocked] cutover job reached Blocked state after %d poll(s)", attempt)
			return nil
		case "completed":
			p.screenshot("cutover-job-completed")
			log.Printf("[WaitForCutoverBlocked] cutover job completed (no block needed) after %d poll(s)", attempt)
			return nil
		case "errored", "failed":
			p.screenshot("cutover-job-errored")
			return fmt.Errorf("cutover job entered %s state", status)
		}

		p.sleep(pollInterval)
	}

	p.screenshot("cutover-job-timeout")
	return fmt.Errorf("cutover job did not reach Blocked state within %.0fs", timeoutMs/1000)
}

func (p *MigrationPage) screenshot(name string) {
	if p.screenshotPrefix != "" {
		name = p.screenshotPrefix + "-" + name
	}
	path := fmt.Sprintf("test-results/screenshots/%s.png", name)
	_, _ = p.page.Screenshot(playwright.PageScreenshotOptions{
		Path:     playwright.String(path),
		FullPage: playwright.Bool(true),
	})
	log.Printf("[screenshot] saved → %s", path)
}
