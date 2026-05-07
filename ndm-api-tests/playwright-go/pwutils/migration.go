package pwutils

import (
	"fmt"
	"log"
	"regexp"
	"strings"

	"github.com/playwright-community/playwright-go"
)

// selectMuiAutocomplete clicks an MUI Autocomplete input and picks an option.
// MUI Autocomplete renders: <input placeholder="..." role="combobox" />
// Options appear as <li role="option"> inside a <ul role="listbox">.
func selectMuiAutocomplete(page playwright.Page, placeholder, optionText string) error {
	input := page.Locator(fmt.Sprintf(`input[placeholder="%s"]`, placeholder)).First()
	if err := ExpectVisible(input, 10000); err != nil {
		return fmt.Errorf("MUI Autocomplete input[placeholder=%q] not visible: %w", placeholder, err)
	}
	_ = input.Click()
	log.Printf("[selectAutocomplete] Clicked input[placeholder=%q]", placeholder)
	Sleep(1500)

	// Wait for the listbox (dropdown) to appear
	_ = ExpectVisible(page.Locator(`[role="listbox"]`).First(), 5000)

	// Find and click the option
	option := page.Locator(`[role="option"]`).GetByText(optionText, playwright.LocatorGetByTextOptions{
		Exact: playwright.Bool(false),
	}).First()
	if err := ExpectVisible(option, 5000); err != nil {
		Screenshot(page, fmt.Sprintf("debug-autocomplete-no-option-%s", strings.ReplaceAll(placeholder, " ", "-")))
		page.Keyboard().Press("Escape")
		return fmt.Errorf("option %q not found in autocomplete %q: %w", optionText, placeholder, err)
	}
	_ = option.Click()
	log.Printf("[selectAutocomplete] Selected %q from %q", optionText, placeholder)
	Sleep(1000)
	return nil
}

// selectFormFieldSelect opens a BXP FormFieldSelect (or MUI Select) and picks an option.
// These render a <div role="combobox"> trigger (unlike Autocomplete which is <input>).
// Falls back through multiple strategies if the first doesn't match.
func selectFormFieldSelect(page playwright.Page, placeholder, optionText string) error {
	opened := false

	// Strategy 1: MUI Select / BXP — div[role="combobox"] containing the placeholder text
	divCombos := page.Locator(`div[role="combobox"]`)
	count, _ := divCombos.Count()
	for i := 0; i < count; i++ {
		el := divCombos.Nth(i)
		txt := TextContent(el)
		if strings.Contains(txt, placeholder) || strings.Contains(txt, "Destination File Server") {
			_ = el.Click()
			log.Printf("[selectFormFieldSelect] Clicked div[role=combobox] (strategy 1)")
			Sleep(1500)
			opened = true
			break
		}
	}

	// Strategy 2: native <select> element with matching name
	if !opened {
		nativeSelect := page.Locator(`select`)
		nativeCount, _ := nativeSelect.Count()
		for i := 0; i < nativeCount; i++ {
			sel := nativeSelect.Nth(i)
			if IsVisible(sel) {
				_, err := sel.SelectOption(playwright.SelectOptionValues{
					Labels: playwright.StringSlice(optionText),
				})
				if err == nil {
					log.Printf("[selectFormFieldSelect] Selected %q via native <select>", optionText)
					Sleep(1000)
					return nil
				}
			}
		}
	}

	// Strategy 3: skip the label, click the dropdown placeholder
	// The label has class "font-semibold", the dropdown placeholder doesn't
	if !opened {
		allMatches := page.GetByText(placeholder, playwright.PageGetByTextOptions{Exact: playwright.Bool(true)})
		matchCount, _ := allMatches.Count()
		log.Printf("[selectFormFieldSelect] Found %d elements matching %q", matchCount, placeholder)
		if matchCount >= 2 {
			_ = allMatches.Nth(1).Click()
			log.Printf("[selectFormFieldSelect] Clicked Nth(1) text match (strategy 3)")
			Sleep(1500)
			opened = true
		}
	}

	// Strategy 4: click any button/div with aria-haspopup near the label
	if !opened {
		trigger := page.Locator(`[aria-haspopup="listbox"], [aria-haspopup="true"]`).First()
		if IsVisible(trigger) {
			_ = trigger.Click()
			log.Printf("[selectFormFieldSelect] Clicked [aria-haspopup] element (strategy 4)")
			Sleep(1500)
			opened = true
		}
	}

	if !opened {
		Screenshot(page, "debug-formfieldselect-not-opened")
		return fmt.Errorf("could not open FormFieldSelect dropdown for %q", placeholder)
	}

	// Select the option from the opened dropdown
	// Try role="option" first (MUI Select renders options with this role)
	option := page.Locator(`[role="option"]`).GetByText(optionText, playwright.LocatorGetByTextOptions{
		Exact: playwright.Bool(false),
	}).First()
	if err := ExpectVisible(option, 5000); err == nil {
		_ = option.Click()
		log.Printf("[selectFormFieldSelect] Selected %q (role=option)", optionText)
		Sleep(1000)
		return nil
	}

	// Try <li> elements in any visible dropdown/popover
	liOption := page.Locator(`li`).GetByText(optionText, playwright.LocatorGetByTextOptions{
		Exact: playwright.Bool(false),
	}).First()
	if IsVisible(liOption) {
		_ = liOption.Click()
		log.Printf("[selectFormFieldSelect] Selected %q (li)", optionText)
		Sleep(1000)
		return nil
	}

	// Last resort: any visible text match
	textOption := page.GetByText(optionText, playwright.PageGetByTextOptions{Exact: playwright.Bool(false)}).First()
	if IsVisible(textOption) {
		_ = textOption.Click()
		log.Printf("[selectFormFieldSelect] Selected %q (text fallback)", optionText)
		Sleep(1000)
		return nil
	}

	Screenshot(page, "debug-formfieldselect-no-option")
	page.Keyboard().Press("Escape")
	return fmt.Errorf("option %q not found in dropdown %q", optionText, placeholder)
}

// RunBulkMigration drives the Bulk Migrate wizard:
//
//	Step 1 (Mapping): select "Start Now", pick dest file server via BXP FormFieldSelect,
//	    for each source→dest pair: select source path (MUI Autocomplete),
//	    select dest path (MUI Autocomplete), click "Add Mapping" button.
//	Step 2 (Options): keep defaults, click Proceed.
//	Step 3 (Review): select all rows, click Submit.
func RunBulkMigration(page playwright.Page, srcFsID, destFsName string, srcExportPaths, destExportPaths []string) error {
	GotoWithRetry(page, FullURL(fmt.Sprintf("/file-server/%s", srcFsID)), 5)

	if err := ExpectVisible(page.GetByText("File Server Overview").First(), 30000); err != nil {
		return err
	}

	migrateBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Bulk Migrate"})
	if err := ExpectVisible(migrateBtn, 30000); err != nil {
		return err
	}
	_ = migrateBtn.Click()
	_ = page.WaitForURL(regexp.MustCompile(`bulk-migrate`), playwright.PageWaitForURLOptions{Timeout: playwright.Float(15000)})
	Sleep(3000)

	Screenshot(page, "debug-migration-page-loaded")

	// ── Job Schedule: select "Start Now" radio ──
	startNow := page.GetByText("Start Now")
	if IsVisible(startNow) {
		_ = startNow.Click()
		Sleep(1000)
		log.Println("[bulkMigration] Selected 'Start Now'")
	}

	// ── Select Destination File Server (BXP FormFieldSelect) ──
	if err := selectFormFieldSelect(page, "Select Destination File Server", destFsName); err != nil {
		log.Printf("[bulkMigration] WARNING: %v", err)
		Screenshot(page, "debug-migration-dest-fs-failed")
	} else {
		Sleep(2000)
	}

	Screenshot(page, "debug-migration-after-dest-selected")

	// ── Add source→destination path mappings ──
	mappingCount := len(srcExportPaths)
	if len(destExportPaths) < mappingCount {
		mappingCount = len(destExportPaths)
	}

	for i := 0; i < mappingCount; i++ {
		srcPath := srcExportPaths[i]
		destPath := destExportPaths[i]

		// Select source path (MUI Autocomplete)
		if err := selectMuiAutocomplete(page, "Select Source Path", srcPath); err != nil {
			log.Printf("[bulkMigration] WARNING: %v", err)
			Screenshot(page, fmt.Sprintf("debug-migration-src-path-failed-%d", i))
			continue
		}

		// Select destination path (MUI Autocomplete)
		if err := selectMuiAutocomplete(page, "Select Destination Path", destPath); err != nil {
			log.Printf("[bulkMigration] WARNING: %v", err)
			Screenshot(page, fmt.Sprintf("debug-migration-dest-path-failed-%d", i))
			continue
		}

		// Click "Add Mapping" button
		addMappingBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Add Mapping"})
		if err := ExpectVisible(addMappingBtn, 10000); err != nil {
			log.Printf("[bulkMigration] 'Add Mapping' button not visible")
			Screenshot(page, fmt.Sprintf("debug-migration-add-mapping-failed-%d", i))
			continue
		}
		_ = addMappingBtn.Click()
		log.Printf("[bulkMigration] Added mapping %d: %s → %s", i+1, srcPath, destPath)
		Sleep(2000)
	}

	Screenshot(page, "debug-migration-mappings-added")

	// ── Click Proceed to Step 2 (Options) ──
	proceedBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"})
	if err := ExpectVisible(proceedBtn, 15000); err != nil {
		return fmt.Errorf("Proceed button not visible after adding mappings: %w", err)
	}
	// Wait until Proceed is enabled (it's disabled until at least one mapping exists)
	for i := 0; i < 10; i++ {
		if IsEnabled(proceedBtn) {
			break
		}
		Sleep(1000)
	}
	_ = proceedBtn.Click()
	log.Println("[bulkMigration] Step 1 (Mapping) → Proceed")
	Sleep(3000)

	// ── Step 2: Options — keep defaults, click Proceed ──
	log.Println("[bulkMigration] Step 2 (Options): keeping defaults")
	Screenshot(page, "debug-migration-options")
	proceedBtn2 := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"})
	if err := ExpectVisible(proceedBtn2, 10000); err != nil {
		return fmt.Errorf("Proceed button not visible on Options step: %w", err)
	}
	_ = proceedBtn2.Click()
	Sleep(3000)

	// ── Step 3: Review — select all rows and Submit ──
	log.Println("[bulkMigration] Step 3 (Review): selecting all and submitting")
	Sleep(3000)
	SelectAllTableRows(page)
	Sleep(1000)

	Screenshot(page, "debug-migration-review")

	submitBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Submit"})
	if err := ExpectVisible(submitBtn, 30000); err != nil {
		return fmt.Errorf("Submit button not visible on Review step: %w", err)
	}
	_ = submitBtn.Click()
	log.Println("[bulkMigration] Clicked Submit")
	Sleep(5000)

	// Handle any pre-check confirmation modal
	proceedModal := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"})
	if IsVisible(proceedModal) {
		_ = proceedModal.Click()
		log.Println("[bulkMigration] Confirmed pre-check modal")
		Sleep(3000)
	}

	return nil
}
