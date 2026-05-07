package pwutils

import (
	"fmt"
	"log"
	"regexp"

	"github.com/playwright-community/playwright-go"
)

func RunBulkDiscovery(page playwright.Page, fsID string, exportPaths []string, maxPaths int) error {
	GotoWithRetry(page, FullURL(fmt.Sprintf("/file-server/%s", fsID)), 5)

	if err := ExpectVisible(page.GetByText("File Server Overview").First(), 30000); err != nil {
		return err
	}

	bulkBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Bulk Discover"})
	if err := ExpectVisible(bulkBtn, 30000); err != nil {
		return err
	}
	_ = bulkBtn.Click()
	_ = page.WaitForURL(regexp.MustCompile(`bulk-discover`), playwright.PageWaitForURLOptions{Timeout: playwright.Float(10000)})
	Sleep(3000)
	_ = ExpectVisible(page.GetByText("Export Path").First(), 15000)
	Sleep(2000)

	if len(exportPaths) > 0 {
		for _, ep := range exportPaths {
			pathText := page.GetByText(ep, playwright.PageGetByTextOptions{Exact: playwright.Bool(true)})
			if !IsVisible(pathText.First()) {
				continue
			}
			pathText.First().Evaluate(CheckboxClickJS, nil)
			log.Printf("[bulkDiscovery] Checked: %s", ep)
			Sleep(500)
		}
	} else {
		SelectFirstNRows(page, maxPaths)
	}

	submitBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Submit"})
	_ = submitBtn.Click()
	Sleep(3000)
	return nil
}

const CheckboxClickJS = `(el) => {
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

func SelectAllTableRows(page playwright.Page) {
	allCBs := page.Locator(`[role="checkbox"], input[type="checkbox"]`)
	count, _ := allCBs.Count()
	if count > 0 {
		_ = allCBs.First().Click()
		Sleep(1000)
		sap := page.GetByText("Select all pages")
		if IsVisible(sap) {
			_ = sap.Click()
			Sleep(1000)
		}
	}
}

func SelectFirstNRows(page playwright.Page, n int) {
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
			Sleep(300)
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
		if IsVisible(cb) {
			_ = cb.Click()
			checked++
			Sleep(300)
		}
	}
	log.Printf("[selectFirstNRows] Checked %d of %d row(s) (max %d)", checked, total, n)
}
