package pwutils

import (
	"fmt"
	"log"
	"regexp"

	"github.com/playwright-community/playwright-go"
)

// RunBulkMigration drives the Bulk Migrate wizard:
//
//	Step 1 (Mapping): select "Start Now", pick dest file server,
//	    for each source→dest pair: select source path dropdown,
//	    select dest path dropdown, click "+ Add Mapping".
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

	// ── Job Schedule: select "Start Now" ──
	startNow := page.GetByText("Start Now")
	if IsVisible(startNow) {
		_ = startNow.Click()
		Sleep(1000)
		log.Println("[bulkMigration] Selected 'Start Now'")
	}

	// ── Select Destination File Server dropdown ──
	destDropdown := page.GetByText("Select Destination File Server").First()
	if IsVisible(destDropdown) {
		_ = destDropdown.Click()
		Sleep(1000)
		destOption := page.GetByText(destFsName, playwright.PageGetByTextOptions{Exact: playwright.Bool(false)})
		if IsVisible(destOption.First()) {
			_ = destOption.First().Click()
			log.Printf("[bulkMigration] Selected destination file server: %s", destFsName)
			Sleep(2000)
		} else {
			log.Printf("[bulkMigration] WARNING: destination %q not found in dropdown", destFsName)
		}
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

		// Click "Select Source Path" dropdown and pick the source path
		srcDropdown := page.GetByText("Select Source Path").First()
		if err := ExpectVisible(srcDropdown, 10000); err != nil {
			log.Printf("[bulkMigration] 'Select Source Path' dropdown not visible")
			continue
		}
		_ = srcDropdown.Click()
		Sleep(1000)

		srcOption := page.GetByText(srcPath, playwright.PageGetByTextOptions{Exact: playwright.Bool(false)})
		if !IsVisible(srcOption.First()) {
			log.Printf("[bulkMigration] Source path %q not found in dropdown", srcPath)
			page.Keyboard().Press("Escape")
			Sleep(500)
			continue
		}
		_ = srcOption.First().Click()
		log.Printf("[bulkMigration] Selected source path: %s", srcPath)
		Sleep(1000)

		// Click "Select Destination Path" dropdown and pick the dest path
		destPathDropdown := page.GetByText("Select Destination Path").First()
		if err := ExpectVisible(destPathDropdown, 10000); err != nil {
			log.Printf("[bulkMigration] 'Select Destination Path' dropdown not visible")
			continue
		}
		_ = destPathDropdown.Click()
		Sleep(1000)

		destPathOption := page.GetByText(destPath, playwright.PageGetByTextOptions{Exact: playwright.Bool(false)})
		if !IsVisible(destPathOption.First()) {
			log.Printf("[bulkMigration] Destination path %q not found in dropdown", destPath)
			page.Keyboard().Press("Escape")
			Sleep(500)
			continue
		}
		_ = destPathOption.First().Click()
		log.Printf("[bulkMigration] Selected destination path: %s", destPath)
		Sleep(1000)

		// Click "+ Add Mapping" to add the row
		addMappingBtn := page.GetByText("Add Mapping")
		if err := ExpectVisible(addMappingBtn, 10000); err != nil {
			log.Printf("[bulkMigration] 'Add Mapping' button not visible")
			continue
		}
		_ = addMappingBtn.Click()
		log.Printf("[bulkMigration] Added mapping: %s → %s", srcPath, destPath)
		Sleep(2000)
	}

	Screenshot(page, "debug-migration-mappings-added")

	// ── Click Proceed to go to Step 2 (Options) ──
	proceedBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"})
	if err := ExpectVisible(proceedBtn, 10000); err != nil {
		return fmt.Errorf("Proceed button not visible after adding mappings: %w", err)
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

	// Handle any confirmation/pre-check modal
	proceedModal := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"})
	if IsVisible(proceedModal) {
		_ = proceedModal.Click()
		log.Println("[bulkMigration] Confirmed pre-check modal")
		Sleep(3000)
	}

	return nil
}
