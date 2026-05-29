package pages

import (
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"
	"time"

	"ndm-ui-tests/config"

	"github.com/playwright-community/playwright-go"
)

type FileServerPage struct {
	page             playwright.Page
	screenshotPrefix string
}

func NewFileServerPage(page playwright.Page, prefix ...string) *FileServerPage {
	p := &FileServerPage{page: page}
	if len(prefix) > 0 && prefix[0] != "" {
		p.screenshotPrefix = prefix[0]
	}
	return p
}

// CreateNFSFileServer runs the 3-step wizard and returns the UUID.
func (p *FileServerPage) CreateNFSFileServer(name, host, nfsUser, nfsPass string, minWorkers int) (string, error) {
	// Wait for the app-level loading screen ("Authenticated, checking permissions...")
	// which appears after login before the React app is fully ready.
	p.waitForAppReady()

	url := config.BaseURL + "/new-file-server"
	if _, err := p.page.Goto(url, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(90000),
	}); err != nil {
		return "", fmt.Errorf("goto new-file-server: %w", err)
	}
	_ = p.page.WaitForURL(regexp.MustCompile(`new-file-server`), playwright.PageWaitForURLOptions{
		Timeout: playwright.Float(60000),
	})
	p.sleep(5000)
	p.screenshot("fs-step1-loaded")

	// ── Step 1: Server Name ─────────────────────────────────────────────
	nameField := p.page.GetByPlaceholder("Name")
	if err := p.expectVisible(nameField, 45000); err != nil {
		return "", fmt.Errorf("step1: Name field not visible: %w", err)
	}
	_ = nameField.Fill(name)
	_ = p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"}).Click()
	p.sleep(2000)
	p.screenshot("fs-step2-loaded")

	// ── Step 2: Credentials ─────────────────────────────────────────────
	hostField := p.page.GetByRole("textbox", playwright.PageGetByRoleOptions{Name: "Host Name"})
	if err := p.expectVisible(hostField, 30000); err != nil {
		return "", fmt.Errorf("step2: Host Name field not visible: %w", err)
	}
	_ = hostField.Fill(host)

	// Expand the NFS accordion — it renders as a button with accessible name "NFS".
	_ = p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "NFS"}).First().Click()
	p.sleep(1000)

	_ = p.page.GetByPlaceholder("Username").Fill(nfsUser)
	if nfsPass != "" {
		_ = p.page.GetByPlaceholder("Password").Fill(nfsPass)
	}
	p.screenshot("fs-step2-filled")

	_ = p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"}).Click()
	p.sleep(3000)
	p.screenshot("fs-step3-loaded")

	// ── Step 3: Workers ─────────────────────────────────────────────────
	if err := p.expectVisible(
		p.page.GetByText(regexp.MustCompile(`(?i)Compatible Workers`)).First(),
		30000,
	); err != nil {
		return "", fmt.Errorf("step3: Compatible Workers label not visible: %w", err)
	}

	workerNames := p.page.GetByText(regexp.MustCompile(`(?i)nfs-worker`))
	_ = workerNames.First().WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(30000),
	})
	p.sleep(2000)

	workerCount, _ := workerNames.Count()
	log.Printf("[createFileServer] found %d worker(s)", workerCount)

	toggled := 0
	for i := 0; i < workerCount; i++ {
		el := workerNames.Nth(i)
		if !p.isVisible(el) {
			continue
		}
		info, err := el.Evaluate(fsToggleInspectJS, nil)
		if err != nil {
			continue
		}
		m, ok := info.(map[string]interface{})
		if !ok || m["found"] != true {
			continue
		}
		if m["isAlreadyOn"] == true {
			toggled++
			log.Printf("[createFileServer] worker %d: already ON", i)
			continue
		}
		if m["isOffline"] == true || m["isDisabled"] == true {
			log.Printf("[createFileServer] worker %d: offline/disabled, skipping", i)
			continue
		}
		clicked, _ := el.Evaluate(fsToggleClickJS, nil)
		if cb, ok := clicked.(bool); ok && cb {
			toggled++
			log.Printf("[createFileServer] worker %d: toggled ON", i)
			p.sleep(1000)
		}
	}

	if toggled == 0 {
		p.screenshot("fs-step3-no-online-workers")
		return "", fmt.Errorf("step3: no online workers available to toggle")
	}
	if toggled < minWorkers {
		log.Printf("[createFileServer] WARNING: only %d worker(s) associated, wanted %d", toggled, minWorkers)
	}
	log.Printf("[createFileServer] %d worker(s) associated", toggled)

	p.screenshot("fs-step3-workers-toggled")

	// Click Finish and wait for redirect/success.
	finishBtn := p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Finish"})
	if err := p.expectVisible(finishBtn, 10000); err != nil {
		return "", fmt.Errorf("step3: Finish button not visible: %w", err)
	}
	_ = finishBtn.Click()

	deadline := time.Now().Add(2 * time.Minute)
	outcome := "timeout"
	for time.Now().Before(deadline) {
		if !strings.Contains(p.page.URL(), "new-file-server") {
			outcome = "redirected"
			break
		}
		if p.isVisible(p.page.GetByText("Configuration Successfully saved").First()) {
			outcome = "success_toast"
			break
		}
		if p.isVisible(p.page.GetByText("Error creating file server").First()) ||
			p.isVisible(p.page.GetByText("File Server Name already exists").First()) {
			outcome = "error_toast"
			break
		}
		p.sleep(3000)
	}
	log.Printf("[createFileServer] finish outcome: %s", outcome)

	if outcome == "error_toast" {
		p.screenshot("fs-create-error")
		return "", fmt.Errorf("file server creation failed (error toast)")
	}
	if outcome == "timeout" {
		p.screenshot("fs-create-timeout")
		return "", fmt.Errorf("file server creation timed out waiting for redirect")
	}

	p.sleep(3000)
	p.screenshot("fs-after-finish")

	// Find the file server ID by navigating to the list.
	fsID, err := p.navigateToFileServer(name)
	if err != nil {
		return "", fmt.Errorf("find new file server ID: %w", err)
	}
	return fsID, nil
}

// CreateSMBFileServer runs the 3-step wizard for an SMB file server
// and returns the UUID. Same wizard as NFS but expands the SMB accordion.
func (p *FileServerPage) CreateSMBFileServer(name, host, adServerIP, smbUser, smbPass string, minWorkers int) (string, error) {
	p.waitForAppReady()

	url := config.BaseURL + "/new-file-server"
	if _, err := p.page.Goto(url, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(90000),
	}); err != nil {
		return "", fmt.Errorf("goto new-file-server: %w", err)
	}
	_ = p.page.WaitForURL(regexp.MustCompile(`new-file-server`), playwright.PageWaitForURLOptions{
		Timeout: playwright.Float(60000),
	})
	p.sleep(5000)
	p.screenshot("smb-step1-loaded")

	// ── Step 1: Server Name ─────────────────────────────────────────────
	nameField := p.page.GetByPlaceholder("Name")
	if err := p.expectVisible(nameField, 60000); err != nil {
		return "", fmt.Errorf("step1: Name field not visible: %w", err)
	}
	_ = nameField.Fill(name)
	p.sleep(500)
	// Dismiss any autocomplete dropdown that appears.
	_ = p.page.Keyboard().Press("Escape")
	p.sleep(500)

	_ = p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"}).Click()
	p.sleep(3000)
	p.screenshot("smb-step2-loaded")

	// ── Step 2: Credentials ─────────────────────────────────────────────
	hostField := p.page.GetByPlaceholder("Host Name")
	if !p.isVisible(hostField) {
		hostField = p.page.GetByRole("textbox", playwright.PageGetByRoleOptions{Name: "Host Name"})
	}
	if err := p.expectVisible(hostField, 30000); err != nil {
		return "", fmt.Errorf("step2: Host Name field not visible: %w", err)
	}
	_ = hostField.Fill(host)
	p.sleep(500)

	// Select SMB radio button in Protocol Selection (NFS is default).
	// Use JS to find and click the SMB radio reliably.
	_, _ = p.page.Evaluate(`() => {
		const radios = document.querySelectorAll('input[type="radio"]');
		for (const r of radios) {
			const label = r.closest('label') || r.parentElement;
			if (label && label.textContent.trim().includes('SMB')) {
				r.click();
				return true;
			}
		}
		const spans = document.querySelectorAll('span, label');
		for (const s of spans) {
			if (s.textContent.trim() === 'SMB') {
				s.click();
				return true;
			}
		}
		return false;
	}`)
	p.sleep(1000)
	p.screenshot("smb-step2-protocol-selected")

	// Expand the SMB accordion to reveal credential fields.
	// The accordion header "SMB" is rendered as a clickable section below
	// Protocol Selection. Use GetByRole("button") to target the accordion
	// header (not the radio, which has role="radio").
	smbAccordion := p.page.GetByRole("button", playwright.PageGetByRoleOptions{
		Name:  "SMB",
		Exact: playwright.Bool(true),
	}).First()
	if p.isVisible(smbAccordion) {
		_ = smbAccordion.Click()
		p.sleep(1000)
	}

	// If the Username field is still not visible, try scrolling down and
	// clicking any remaining SMB-labelled expandable section.
	smbUserField := p.page.GetByPlaceholder("Username").Last()
	if !p.isVisible(smbUserField) {
		p.page.Locator(`text=SMB`).Last().Click()
		p.sleep(1000)
	}

	p.screenshot("smb-step2-accordion-expanded")

	// Fill AD Server IP.
	if adServerIP != "" {
		adIPField := p.page.GetByPlaceholder("AD Server IP").First()
		if p.isVisible(adIPField) {
			_ = adIPField.Fill(adServerIP)
			log.Printf("[CreateSMBFileServer] AD Server IP set: %s", adServerIP)
			p.sleep(500)
		}
	}

	// Fill SMB Username and Password.
	_ = p.page.GetByPlaceholder("Username").Last().Fill(smbUser)
	p.sleep(500)
	_ = p.page.GetByPlaceholder("Password").Last().Fill(smbPass)
	p.sleep(500)

	p.screenshot("smb-step2-filled")

	// Wait for AD Server IP auto-discovery and Proceed to become enabled.
	proceedBtn := p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"})
	for attempt := 0; attempt < 10; attempt++ {
		disabled, _ := proceedBtn.IsDisabled()
		if !disabled {
			break
		}
		log.Printf("[CreateSMBFileServer] Proceed still disabled, waiting (attempt %d/10)…", attempt+1)
		p.sleep(3000)
	}

	disabled, _ := proceedBtn.IsDisabled()
	if disabled {
		p.screenshot("smb-step2-proceed-disabled")
		return "", fmt.Errorf("step2: Proceed button never became enabled — check credentials")
	}

	_ = proceedBtn.Click()
	p.sleep(3000)
	p.screenshot("smb-step3-loaded")

	// ── Step 3: Workers ─────────────────────────────────────────────────
	// The SMB wizard step 3 uses the same bxp/ag-grid component as the NFS
	// wizard — NOT a plain <tbody><tr> table. Use the same text-match + JS
	// toggle approach that CreateNFSFileServer uses successfully.
	//
	// Wait for the "SMB Compatible Workers" heading to confirm the grid loaded.
	if err := p.expectVisible(
		p.page.GetByText(regexp.MustCompile(`(?i)SMB Compatible Workers`)).First(),
		30000,
	); err != nil {
		return "", fmt.Errorf("step3: SMB Compatible Workers label not visible: %w", err)
	}

	// Workers are listed by their hostname label (e.g. "smb-worker-4").
	workerNames := p.page.GetByText(regexp.MustCompile(`(?i)smb-worker`))
	_ = workerNames.First().WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(30000),
	})
	p.sleep(2000)

	workerCount, _ := workerNames.Count()
	log.Printf("[CreateSMBFileServer] step3: %d worker label(s) found", workerCount)

	toggled := 0
	for i := 0; i < workerCount; i++ {
		el := workerNames.Nth(i)
		if !p.isVisible(el) {
			continue
		}
		info, err := el.Evaluate(fsToggleInspectJS, nil)
		if err != nil {
			continue
		}
		m, ok := info.(map[string]interface{})
		if !ok || m["found"] != true {
			continue
		}
		if m["isAlreadyOn"] == true {
			toggled++
			log.Printf("[CreateSMBFileServer] worker %d: already ON", i)
			continue
		}
		if m["isOffline"] == true || m["isDisabled"] == true {
			log.Printf("[CreateSMBFileServer] worker %d: offline/disabled, skipping", i)
			continue
		}
		clicked, _ := el.Evaluate(fsToggleClickJS, nil)
		if cb, ok := clicked.(bool); ok && cb {
			toggled++
			log.Printf("[CreateSMBFileServer] worker %d: toggled ON", i)
			p.sleep(1000)
		}
	}

	if toggled == 0 {
		p.screenshot("smb-step3-no-online-workers")
		return "", fmt.Errorf("step3: no online SMB workers available to toggle")
	}
	if toggled < minWorkers {
		log.Printf("[CreateSMBFileServer] WARNING: only %d worker(s) associated, wanted %d", toggled, minWorkers)
	}
	log.Printf("[CreateSMBFileServer] %d worker(s) associated", toggled)
	p.screenshot("smb-step3-workers-toggled")

	// Brief pause so the form registers the worker toggle before Finish fires.
	p.sleep(2000)

	// Click Finish and wait for redirect/success.
	// Use 4 minutes — with workers associated NDM validates the SMB connection
	// and scans export paths which can take 2–3 minutes.
	finishBtn := p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Finish"})
	if err := p.expectVisible(finishBtn, 10000); err != nil {
		return "", fmt.Errorf("step3: Finish button not visible: %w", err)
	}
	_ = finishBtn.Click()

	deadline := time.Now().Add(4 * time.Minute)
	outcome := "timeout"
	for time.Now().Before(deadline) {
		if !strings.Contains(p.page.URL(), "new-file-server") {
			outcome = "redirected"
			break
		}
		if p.isVisible(p.page.GetByText("Configuration Successfully saved").First()) {
			outcome = "success_toast"
			break
		}
		if p.isVisible(p.page.GetByText("Error creating file server").First()) ||
			p.isVisible(p.page.GetByText("File Server Name already exists").First()) {
			outcome = "error_toast"
			break
		}
		p.sleep(3000)
	}
	log.Printf("[CreateSMBFileServer] finish outcome: %s", outcome)


	if outcome == "error_toast" {
		p.screenshot("smb-create-error")
		return "", fmt.Errorf("SMB file server creation failed (error toast)")
	}
	if outcome == "timeout" {
		p.screenshot("smb-create-timeout")
		return "", fmt.Errorf("SMB file server creation timed out")
	}

	p.sleep(3000)
	p.screenshot("smb-after-finish")

	fsID, err := p.navigateToFileServer(name)
	if err != nil {
		return "", fmt.Errorf("find new SMB file server ID: %w", err)
	}
	return fsID, nil
}

// CreateIsilonFileServer runs the 3-step wizard for Dell PowerScale (Isilon)
// file servers and returns the UUID.
//
// Step 1: Name, Server Type = "Dell PowerScale (Isilon)", Management Console
// Step 1→2 transition: Certificate Details dialog → "Accept and Continue"
// Step 2: Access Zones table — select zone, NFS IP dropdown, NFS Username
// Step 3: Workers — toggle worker association per access zone → Finish
func (p *FileServerPage) CreateIsilonFileServer(name, mgmtHost, mgmtUser, mgmtPass, nfsIP, nfsUser string, minWorkers int) (string, error) {
	p.waitForAppReady()

	url := config.BaseURL + "/new-file-server"
	if _, err := p.page.Goto(url, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(90000),
	}); err != nil {
		return "", fmt.Errorf("goto new-file-server: %w", err)
	}
	_ = p.page.WaitForURL(regexp.MustCompile(`new-file-server`), playwright.PageWaitForURLOptions{
		Timeout: playwright.Float(60000),
	})
	p.sleep(5000)
	p.screenshot("isilon-step1-loaded")

	// ── Step 1: Server Type ────────────────────────────────────────────
	nameField := p.page.GetByPlaceholder("Name")
	if err := p.expectVisible(nameField, 60000); err != nil {
		return "", fmt.Errorf("step1: Name field not visible: %w", err)
	}
	_ = nameField.Fill(name)

	// Select "Dell PowerScale (Isilon)" from Server Type dropdown.
	// Try native <select> first, then click-based approach as fallback.
	selected := false

	// Approach 1: native <select> element.
	sel := p.page.Locator(`select`).First()
	if p.isVisible(sel) {
		_, err := sel.SelectOption(playwright.SelectOptionValues{
			Labels: playwright.StringSlice("Dell PowerScale (Isilon)"),
		})
		if err == nil {
			selected = true
			log.Printf("[CreateIsilonFileServer] selected Isilon via native <select>")
		} else {
			log.Printf("[CreateIsilonFileServer] native select failed: %v — trying click approach", err)
		}
	}

	// Approach 2: click-based custom dropdown.
	if !selected {
		p.page.GetByText("Other NAS").First().Click()
		p.sleep(1000)
		p.screenshot("isilon-dropdown-opened")

		isilonOption := p.page.GetByText("Dell PowerScale (Isilon)", playwright.PageGetByTextOptions{
			Exact: playwright.Bool(false),
		}).First()
		if err := p.expectVisible(isilonOption, 10000); err != nil {
			p.screenshot("isilon-dropdown-no-option")
			return "", fmt.Errorf("step1: Isilon option not visible in dropdown: %w", err)
		}
		_ = isilonOption.Click()
		selected = true
	}
	p.sleep(2000)
	p.screenshot("isilon-step1-type-selected")

	// Management Console fields appear after selecting Isilon.
	hostField := p.page.GetByPlaceholder("Host")
	if !p.isVisible(hostField) {
		hostField = p.page.GetByRole("textbox", playwright.PageGetByRoleOptions{Name: "Host"})
	}
	if err := p.expectVisible(hostField, 10000); err != nil {
		return "", fmt.Errorf("step1: Management Console Host not visible: %w", err)
	}
	_ = hostField.Fill(mgmtHost)

	userField := p.page.GetByPlaceholder("Username")
	if p.isVisible(userField) {
		_ = userField.Fill(mgmtUser)
	}
	passField := p.page.GetByPlaceholder("Password")
	if p.isVisible(passField) && mgmtPass != "" {
		_ = passField.Fill(mgmtPass)
	}

	p.screenshot("isilon-step1-filled")
	_ = p.clickProceed()
	p.sleep(3000)

	// ── Certificate Dialog ─────────────────────────────────────────────
	// A self-signed certificate dialog may appear after Proceed.
	acceptBtn := p.page.GetByRole("button", playwright.PageGetByRoleOptions{
		Name: "Accept and Continue",
	})
	if err := p.expectVisible(acceptBtn, 30000); err == nil {
		p.screenshot("isilon-certificate-dialog")
		_ = acceptBtn.Click()
		p.sleep(3000)
	}

	p.screenshot("isilon-step2-loaded")

	// ── Step 2: Access Zones / Credentials ─────────────────────────────
	// Wait for the Access Zones heading to render.
	if err := p.expectVisible(
		p.page.GetByText("Access Zones").First(), 30000,
	); err != nil {
		return "", fmt.Errorf("step2: Access Zones not visible: %w", err)
	}
	p.sleep(3000)

	// The grid uses custom div-based components (no HTML <table>). Dump the
	// actual DOM structure around zone names for debugging.
	domDump, _ := p.page.Evaluate(`() => {
		const result = {
			tables: document.querySelectorAll('table').length,
			inputCheckboxes: document.querySelectorAll('input[type="checkbox"]').length,
			roleCheckboxes: document.querySelectorAll('[role="checkbox"]').length,
			agCheckboxes: document.querySelectorAll('.ag-checkbox-input, .ag-selection-checkbox').length,
			selects: document.querySelectorAll('select').length,
			allInputs: document.querySelectorAll('input').length,
			roleRows: document.querySelectorAll('[role="row"]').length,
			roleGridcells: document.querySelectorAll('[role="gridcell"]').length,
		};
		// Find the element containing zone name text and dump its ancestry.
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			const txt = walker.currentNode.textContent.trim();
			if (txt === 'MyZone' || txt === 'System') {
				let el = walker.currentNode.parentElement;
				const chain = [];
				for (let i = 0; i < 10 && el; i++) {
					chain.push(el.tagName + '.' + (el.className || '').toString().substring(0, 80) +
						(el.getAttribute('role') ? '[role=' + el.getAttribute('role') + ']' : ''));
					el = el.parentElement;
				}
				result['zone_' + txt] = chain;
				if (!result.zoneParentHTML) {
					const p = walker.currentNode.parentElement;
					const row = p?.closest('[role="row"]') || p?.parentElement?.parentElement;
					result.zoneParentHTML = row ? row.outerHTML.substring(0, 1000) : p?.parentElement?.innerHTML?.substring(0, 500);
				}
				break;
			}
		}
		return result;
	}`)
	log.Printf("[CreateIsilonFileServer] step2 DOM dump: %v", domDump)

	// Strategy: click the checkbox for the first zone row.
	// Try multiple approaches since the grid uses custom components.
	zoneChecked := false

	// Approach 1: ag-grid checkbox input (hidden but clickable).
	agCbResult, _ := p.page.Evaluate(`() => {
		const cbs = document.querySelectorAll('.ag-checkbox-input, .ag-selection-checkbox input, [role="row"] input[type="checkbox"]');
		if (cbs.length > 0) {
			cbs[0].click();
			return { method: 'ag-checkbox-input', count: cbs.length, clicked: true };
		}
		return { method: 'ag-checkbox-input', count: 0 };
	}`)
	log.Printf("[CreateIsilonFileServer] ag-checkbox attempt: %v", agCbResult)
	if m, ok := agCbResult.(map[string]interface{}); ok && m["clicked"] == true {
		zoneChecked = true
	}

	// Approach 2: role="checkbox" elements.
	if !zoneChecked {
		roleCbResult, _ := p.page.Evaluate(`() => {
			const cbs = document.querySelectorAll('[role="checkbox"]');
			if (cbs.length > 0) {
				cbs[0].click();
				return { method: 'role-checkbox', count: cbs.length, clicked: true };
			}
			return { method: 'role-checkbox', count: 0 };
		}`)
		log.Printf("[CreateIsilonFileServer] role-checkbox attempt: %v", roleCbResult)
		if m, ok := roleCbResult.(map[string]interface{}); ok && m["clicked"] == true {
			zoneChecked = true
		}
	}

	// Approach 3: Any generic input[type="checkbox"] on the page.
	if !zoneChecked {
		genericCb, _ := p.page.Evaluate(`() => {
			const cbs = document.querySelectorAll('input[type="checkbox"]');
			if (cbs.length > 0) {
				cbs[0].click();
				return { method: 'generic-checkbox', count: cbs.length, clicked: true };
			}
			return { method: 'generic-checkbox', count: 0 };
		}`)
		log.Printf("[CreateIsilonFileServer] generic-checkbox attempt: %v", genericCb)
		if m, ok := genericCb.(map[string]interface{}); ok && m["clicked"] == true {
			zoneChecked = true
		}
	}

	// Approach 4: Find the first zone name text and click the checkbox area
	// to its left using coordinates. Works regardless of DOM structure.
	if !zoneChecked {
		// Find the first visible zone name in the grid.
		zoneNameLoc := p.page.Locator(`text=MyZone`).First()
		if !p.isVisible(zoneNameLoc) {
			zoneNameLoc = p.page.Locator(`text=System`).First()
		}
		// As last resort find any text that appears after the column headers.
		if !p.isVisible(zoneNameLoc) {
			zoneNameLoc = p.page.Locator(`text=Name`).First()
		}
		if p.isVisible(zoneNameLoc) {
			box, err := zoneNameLoc.BoundingBox()
			if err == nil && box != nil {
				// The checkbox is to the left of the zone name.
				cbX := box.X - 30
				cbY := box.Y + box.Height/2
				_ = p.page.Mouse().Click(cbX, cbY)
				log.Printf("[CreateIsilonFileServer] coordinate click at (%.0f, %.0f) — left of zone at (%.0f, %.0f)", cbX, cbY, box.X, box.Y)
				zoneChecked = true
			}
		}
	}

	if !zoneChecked {
		p.screenshot("isilon-step2-no-checkbox")
		return "", fmt.Errorf("step2: could not find or click any zone checkbox")
	}

	p.sleep(2000)
	p.screenshot("isilon-step2-zone-checked")

	// After checking the zone, the NFS IP dropdown and NFS Username fields
	// should become editable. The grid uses custom React dropdown components
	// (not <select>), with data-testid attributes like "table-cell-column-*-row-*".

	// Dump the cells in the checked row to understand the NFS IP dropdown.
	cellDump, _ := p.page.Evaluate(`() => {
		const rows = document.querySelectorAll('[data-testid^="table-row-"]');
		for (const row of rows) {
			const cb = row.querySelector('input[type="checkbox"]');
			if (!cb || !cb.checked) continue;
			const cells = row.querySelectorAll('[data-testid^="table-cell-"]');
			const result = [];
			cells.forEach(c => {
				result.push({
					testid: c.getAttribute('data-testid'),
					text: c.textContent.substring(0, 50).trim(),
					html: c.innerHTML.substring(0, 300)
				});
			});
			return { checkedRow: row.getAttribute('data-testid'), cellCount: cells.length, cells: result };
		}
		return { noCheckedRow: true };
	}`)
	log.Printf("[CreateIsilonFileServer] checked row cells: %v", cellDump)

	if nfsIP != "" {
		// The NFS IP dropdown is a MUI Autocomplete (not a <select>).
		// Find the checked row's zone name, then target the NFS IP cell's input.
		zoneName, _ := p.page.Evaluate(`() => {
			const rows = document.querySelectorAll('[data-testid^="table-row-"]');
			for (const row of rows) {
				const cb = row.querySelector('input[type="checkbox"]');
				if (cb && cb.checked) {
					const tid = row.getAttribute('data-testid');
					return tid.replace('table-row-', '');
				}
			}
			return '';
		}`)
		zoneStr := fmt.Sprintf("%v", zoneName)
		log.Printf("[CreateIsilonFileServer] checked zone name: %q", zoneStr)

		// Build the data-testid for the NFS IP cell.
		nfsIPCellTestID := fmt.Sprintf("table-cell-column-NFS IP-row-%s", zoneStr)
		nfsIPCell := p.page.Locator(fmt.Sprintf(`[data-testid="%s"]`, nfsIPCellTestID))
		nfsIPInput := nfsIPCell.Locator(`input`).First()

		if !p.isVisible(nfsIPInput) {
			// Fallback: find any MUI Autocomplete input inside an NFS IP-labelled cell.
			nfsIPInput = p.page.Locator(`[data-testid*="NFS IP"] input`).First()
		}

		nfsIPSet := false
		if p.isVisible(nfsIPInput) {
			// Click the input to open the MUI Autocomplete dropdown.
			_ = nfsIPInput.Click()
			p.sleep(1000)
			p.screenshot("isilon-step2-nfsip-dropdown-open")

			// MUI Autocomplete options appear in a listbox with role="option".
			options := p.page.Locator(`[role="option"]`)
			optCount, _ := options.Count()
			log.Printf("[CreateIsilonFileServer] MUI dropdown options: %d", optCount)

			// Log all available options for debugging.
			for i := 0; i < optCount; i++ {
				optText, _ := options.Nth(i).TextContent()
				log.Printf("[CreateIsilonFileServer]   option %d: %q", i, strings.TrimSpace(optText))
			}

			// Click the option matching the target IP.
			for i := 0; i < optCount; i++ {
				optText, _ := options.Nth(i).TextContent()
				if strings.Contains(optText, nfsIP) {
					_ = options.Nth(i).Click()
					nfsIPSet = true
					log.Printf("[CreateIsilonFileServer] NFS IP selected: %s", nfsIP)
					break
				}
			}

			// If exact match not found, select the first non-empty option.
			if !nfsIPSet && optCount > 0 {
				_ = options.First().Click()
				firstText, _ := options.First().TextContent()
				nfsIPSet = true
				log.Printf("[CreateIsilonFileServer] NFS IP selected (first available): %s", strings.TrimSpace(firstText))
			}

			// If no options appeared, try typing the IP to filter.
			if !nfsIPSet {
				_ = nfsIPInput.Fill(nfsIP)
				p.sleep(1000)
				options2 := p.page.Locator(`[role="option"]`)
				opt2Count, _ := options2.Count()
				if opt2Count > 0 {
					_ = options2.First().Click()
					nfsIPSet = true
					log.Printf("[CreateIsilonFileServer] NFS IP selected after typing: %s", nfsIP)
				}
			}
		} else {
			log.Printf("[CreateIsilonFileServer] WARNING: NFS IP input not found")
		}

		if !nfsIPSet {
			log.Printf("[CreateIsilonFileServer] WARNING: NFS IP could not be selected")
		}
		p.sleep(1000)
	}

	// Fill NFS Username.
	if nfsUser != "" {
		nfsUserField := p.page.GetByPlaceholder("NFS Username").First()
		if p.isVisible(nfsUserField) {
			_ = nfsUserField.Fill(nfsUser)
			log.Printf("[CreateIsilonFileServer] NFS Username filled: %s", nfsUser)
		} else {
			log.Printf("[CreateIsilonFileServer] WARNING: NFS Username placeholder not found")
		}
		p.sleep(500)
	}

	p.screenshot("isilon-step2-filled")

	// Wait for Proceed to enable, then click.
	proceedBtn := p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"})
	for attempt := 0; attempt < 15; attempt++ {
		dis, _ := proceedBtn.IsDisabled()
		if !dis {
			log.Printf("[CreateIsilonFileServer] Proceed enabled at attempt %d", attempt+1)
			break
		}
		log.Printf("[CreateIsilonFileServer] Proceed still disabled (attempt %d/15)", attempt+1)
		p.sleep(2000)
	}

	dis, _ := proceedBtn.IsDisabled()
	if dis {
		p.screenshot("isilon-step2-proceed-stuck")
		return "", fmt.Errorf("step2: Proceed button never became enabled — check zone selection and NFS credentials")
	}

	_ = proceedBtn.Click()
	p.sleep(3000)
	p.screenshot("isilon-step3-loaded")

	// ── Step 3: Workers ────────────────────────────────────────────────
	// Step 3 shows a left sidebar with access zones and a worker grid on the
	// right. The grid uses custom div components (no HTML <table>).
	p.sleep(2000)

	// Look for toggle switches anywhere on the page (the grid uses [role="switch"]
	// or custom toggle components, NOT inside <table>).
	workerToggles := p.page.Locator(`[role="switch"]`)
	_ = workerToggles.First().WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(30000),
	})
	p.sleep(1000)

	workerCount, _ := workerToggles.Count()
	log.Printf("[CreateIsilonFileServer] found %d worker toggle(s) via [role=switch]", workerCount)

	toggled := 0
	for i := 0; i < workerCount; i++ {
		toggle := workerToggles.Nth(i)
		if !p.isVisible(toggle) {
			continue
		}
		ariaChecked, _ := toggle.GetAttribute("aria-checked")
		if ariaChecked == "true" {
			toggled++
			log.Printf("[CreateIsilonFileServer] worker %d: already ON", i+1)
			continue
		}
		_ = toggle.Click()
		toggled++
		log.Printf("[CreateIsilonFileServer] worker %d: toggled ON", i+1)
		p.sleep(1000)
	}

	// Fallback: use the JS-based approach to find toggles near worker names.
	if toggled == 0 {
		workerNames := p.page.GetByText(regexp.MustCompile(`(?i)worker-`))
		wCount, _ := workerNames.Count()
		log.Printf("[CreateIsilonFileServer] fallback: found %d worker name(s)", wCount)

		for i := 0; i < wCount; i++ {
			el := workerNames.Nth(i)
			if !p.isVisible(el) {
				continue
			}
			info, err := el.Evaluate(fsToggleInspectJS, nil)
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
			clicked, _ := el.Evaluate(fsToggleClickJS, nil)
			if cb, ok := clicked.(bool); ok && cb {
				toggled++
				log.Printf("[CreateIsilonFileServer] worker %d: toggled ON (JS fallback)", i+1)
				p.sleep(1000)
			}
		}
	}

	if toggled == 0 {
		p.screenshot("isilon-step3-no-online-workers")
		return "", fmt.Errorf("step3: no online workers available to toggle")
	}
	if toggled < minWorkers {
		log.Printf("[CreateIsilonFileServer] WARNING: only %d worker(s) associated, wanted %d", toggled, minWorkers)
	}
	log.Printf("[CreateIsilonFileServer] %d worker(s) associated", toggled)

	p.screenshot("isilon-step3-workers-toggled")

	// Click Finish and wait for redirect/success.
	finishBtn := p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Finish"})
	if err := p.expectVisible(finishBtn, 10000); err != nil {
		return "", fmt.Errorf("step3: Finish button not visible: %w", err)
	}
	_ = finishBtn.Click()

	deadline := time.Now().Add(2 * time.Minute)
	outcome := "timeout"
	for time.Now().Before(deadline) {
		if !strings.Contains(p.page.URL(), "new-file-server") {
			outcome = "redirected"
			break
		}
		if p.isVisible(p.page.GetByText("Configuration Successfully saved").First()) {
			outcome = "success_toast"
			break
		}
		if p.isVisible(p.page.GetByText("Error creating file server").First()) ||
			p.isVisible(p.page.GetByText("File Server Name already exists").First()) {
			outcome = "error_toast"
			break
		}
		p.sleep(3000)
	}
	log.Printf("[CreateIsilonFileServer] finish outcome: %s", outcome)

	if outcome == "error_toast" {
		p.screenshot("isilon-create-error")
		return "", fmt.Errorf("Isilon file server creation failed (error toast)")
	}
	if outcome == "timeout" {
		p.screenshot("isilon-create-timeout")
		return "", fmt.Errorf("Isilon file server creation timed out waiting for redirect")
	}

	p.sleep(3000)
	p.screenshot("isilon-after-finish")

	fsID, err := p.navigateToFileServer(name)
	if err != nil {
		return "", fmt.Errorf("find new Isilon file server ID: %w", err)
	}
	return fsID, nil
}

// waitForAppReady waits for the NDM app-level loading screen to disappear.
// After login the app shows "Authenticated, checking permissions, kindly wait..."
// which must clear before any navigation is reliable.
func (p *FileServerPage) waitForAppReady() {
	loadingMsg := p.page.Locator(`text=checking permissions`)
	for i := 0; i < 20; i++ {
		if v, _ := loadingMsg.First().IsVisible(); !v {
			return
		}
		log.Printf("[waitForAppReady] app still loading, waiting (attempt %d/20)…", i+1)
		p.sleep(3000)
	}
}

// navigateToFileServer goes to the file server list, finds the row
// by name, clicks it, and returns the UUID from the resulting URL.
// Retries navigation up to 5 times for eventual consistency.
//
// For Isilon (expandable rows), the first click expands the row to show
// access zone sub-rows. Clicking a zone sub-row navigates to a detail URL
// like /file-server/{zoneId}?zone=...&fileServerId={fsId}. In that case
// the fileServerId query parameter is returned.
func (p *FileServerPage) navigateToFileServer(name string) (string, error) {
	// Check if we're already on a file server detail page (redirect from wizard).
	if fsID := p.extractFileServerID(p.page.URL()); fsID != "" {
		log.Printf("[navigateToFileServer] already on detail page, ID: %s", fsID)
		return fsID, nil
	}

	// Wait for the loading screen to clear before navigating to the list.
	p.waitForAppReady()

	nameLink := p.page.GetByText(name, playwright.PageGetByTextOptions{
		Exact: playwright.Bool(true),
	})

	for attempt := 0; attempt < 5; attempt++ {
		p.page.Goto(config.BaseURL+"/file-server", playwright.PageGotoOptions{
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
			Timeout:   playwright.Float(30000),
		})
		p.sleep(5000)
		p.waitForAppReady()

		if p.isVisible(nameLink.First()) {
			break
		}
		log.Printf("[navigateToFileServer] attempt %d: %q not visible in list, retrying…", attempt+1, name)
	}

	if err := p.expectVisible(nameLink.First(), 30000); err != nil {
		p.screenshot("fs-name-not-found")
		return "", fmt.Errorf("file server %q not found in list", name)
	}

	// Click the name link.
	_ = nameLink.First().Click()
	p.sleep(3000)

	// Check if navigation succeeded (standard file servers).
	if fsID := p.extractFileServerID(p.page.URL()); fsID != "" {
		log.Printf("[navigateToFileServer] ID: %s", fsID)
		return fsID, nil
	}

	// URL didn't change — likely an expandable row (e.g. Isilon).
	// The first click expanded the row. Now look for zone sub-rows and
	// click the first one to navigate to the detail page.
	log.Printf("[navigateToFileServer] row expanded (Isilon), looking for zone sub-rows…")
	p.screenshot("fs-row-expanded")

	// Zone sub-rows appear as clickable links like "MyZone (NFS)" below the
	// parent row. Find and click the first one.
	zoneLink := p.page.Locator(`a[href*="fileServerId"]`).First()
	if p.isVisible(zoneLink) {
		_ = zoneLink.Click()
		p.sleep(3000)
		if fsID := p.extractFileServerID(p.page.URL()); fsID != "" {
			log.Printf("[navigateToFileServer] ID (via zone link): %s", fsID)
			return fsID, nil
		}
	}

	// Fallback: look for any visible sub-row text containing "(NFS)" or "(SMB)"
	// and click it.
	zoneSubRow := p.page.GetByText(regexp.MustCompile(`\(NFS\)|\(SMB\)`)).First()
	if p.isVisible(zoneSubRow) {
		_ = zoneSubRow.Click()
		p.sleep(3000)
		if fsID := p.extractFileServerID(p.page.URL()); fsID != "" {
			log.Printf("[navigateToFileServer] ID (via zone text): %s", fsID)
			return fsID, nil
		}
	}

	// Try clicking the name link again (it may have collapsed/re-expanded).
	_ = nameLink.First().Click()
	p.sleep(3000)
	if fsID := p.extractFileServerID(p.page.URL()); fsID != "" {
		log.Printf("[navigateToFileServer] ID (second click): %s", fsID)
		return fsID, nil
	}

	p.screenshot("fs-navigate-failed")
	return "", fmt.Errorf("could not extract file server ID from %s", p.page.URL())
}

// extractFileServerID extracts the file server UUID from a URL.
// For standard file servers: /file-server/{id} → returns {id}.
// For Isilon zone URLs: /file-server/{zoneId}?zone=...&fileServerId=...
// → returns the path {zoneId} (the zone overview has export paths).
func (p *FileServerPage) extractFileServerID(rawURL string) string {
	re := regexp.MustCompile(`/file-server/([a-f0-9-]{20,})`)
	if m := re.FindStringSubmatch(rawURL); len(m) >= 2 {
		return m[1]
	}
	return ""
}

// WaitForFileServerActive polls the file server overview page until it is
// ready for migration — the "Bulk Migrate" button is visible and enabled,
// meaning the file server is Active and its export paths have been retrieved.
func (p *FileServerPage) WaitForFileServerActive(fsID string, timeoutMs float64) error {
	deadline := time.Now().Add(time.Duration(timeoutMs) * time.Millisecond)
	attempt := 0

	for time.Now().Before(deadline) {
		attempt++
		p.page.Goto(config.BaseURL+"/file-server/"+fsID, playwright.PageGotoOptions{
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
			Timeout:   playwright.Float(30000),
		})
		// Wait for app-level loading screen to clear, then give React time to render.
		p.waitForAppReady()
		p.sleep(8000)

		overview := p.page.GetByText("File Server Overview").First()
		if !p.isVisible(overview) {
			log.Printf("[WaitForFileServerActive] attempt %d: overview not visible, retrying…", attempt)
			p.sleep(10000)
			continue
		}

		// Check "Bulk Migrate" button (data-testid added in JobsAction.tsx; falls back to role).
		migrateBtn := p.page.Locator(`[data-testid="btn-bulk-migrate"]`)
		if !p.isVisible(migrateBtn) {
			migrateBtn = p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Bulk Migrate"})
		}
		if p.isVisible(migrateBtn) {
			disabled, _ := migrateBtn.IsDisabled()
			if !disabled {
				log.Printf("[WaitForFileServerActive] file server ready for migration (attempt %d)", attempt)
				p.screenshot("fs-active")
				return nil
			}
			log.Printf("[WaitForFileServerActive] attempt %d: Bulk Migrate button still disabled", attempt)
		} else {
			log.Printf("[WaitForFileServerActive] attempt %d: Bulk Migrate button not visible", attempt)
		}

		p.sleep(15000)
	}

	p.screenshot("fs-not-active-timeout")
	return fmt.Errorf("file server %s did not become ready for migration within %.0fs", fsID, timeoutMs/1000)
}

// ── JS helpers for worker toggle ─────────────────────────────────────────────

const fsToggleInspectJS = `(nameEl) => {
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

const fsToggleClickJS = `(nameEl) => {
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

// ── Go helpers ───────────────────────────────────────────────────────────────

func (p *FileServerPage) clickProceed() error {
	btn := p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"})
	if err := p.expectVisible(btn, 10000); err != nil {
		return fmt.Errorf("Proceed button not visible: %w", err)
	}
	return btn.Click()
}

func (p *FileServerPage) sleep(ms float64) {
	p.page.WaitForTimeout(ms)
}

func (p *FileServerPage) isVisible(loc playwright.Locator) bool {
	v, _ := loc.IsVisible()
	return v
}

func (p *FileServerPage) expectVisible(loc playwright.Locator, timeoutMs float64) error {
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

func (p *FileServerPage) screenshot(name string) {
	if p.screenshotPrefix != "" {
		name = p.screenshotPrefix + "-" + name
	}
	dir := "test-results/screenshots"
	_ = os.MkdirAll(dir, 0o755)
	path := fmt.Sprintf("%s/%s.png", dir, name)
	_, _ = p.page.Screenshot(playwright.PageScreenshotOptions{
		Path:     playwright.String(path),
		FullPage: playwright.Bool(true),
	})
	log.Printf("[screenshot] saved → %s", path)
}
