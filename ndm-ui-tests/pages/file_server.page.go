package pages

import (
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"ndm-ui-tests/config"

	"github.com/playwright-community/playwright-go"
)

type FileServerPage struct {
	page playwright.Page
}

func NewFileServerPage(page playwright.Page) *FileServerPage {
	return &FileServerPage{page: page}
}

// CreateNFSFileServer runs the 3-step wizard and returns the UUID.
func (p *FileServerPage) CreateNFSFileServer(name, host, nfsUser, nfsPass string, minWorkers int) (string, error) {
	url := config.BaseURL + "/new-file-server"
	if _, err := p.page.Goto(url, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(60000),
	}); err != nil {
		return "", fmt.Errorf("goto new-file-server: %w", err)
	}
	_ = p.page.WaitForURL(regexp.MustCompile(`new-file-server`), playwright.PageWaitForURLOptions{
		Timeout: playwright.Float(15000),
	})
	p.sleep(3000)
	p.screenshot("fs-step1-loaded")

	// ── Step 1: Server Name ─────────────────────────────────────────────
	nameField := p.page.GetByPlaceholder("Name")
	if err := p.expectVisible(nameField, 15000); err != nil {
		return "", fmt.Errorf("step1: Name field not visible: %w", err)
	}
	_ = nameField.Fill(name)
	_ = p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"}).Click()
	p.sleep(2000)
	p.screenshot("fs-step2-loaded")

	// ── Step 2: Credentials ─────────────────────────────────────────────
	hostField := p.page.GetByRole("textbox", playwright.PageGetByRoleOptions{Name: "Host Name"})
	if err := p.expectVisible(hostField, 10000); err != nil {
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
		15000,
	); err != nil {
		return "", fmt.Errorf("step3: Compatible Workers label not visible: %w", err)
	}

	workerNames := p.page.GetByText(regexp.MustCompile(`(?i)nfs-worker`))
	_ = workerNames.First().WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(15000),
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
func (p *FileServerPage) CreateSMBFileServer(name, host, smbUser, smbPass string, minWorkers int) (string, error) {
	url := config.BaseURL + "/new-file-server"
	if _, err := p.page.Goto(url, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(60000),
	}); err != nil {
		return "", fmt.Errorf("goto new-file-server: %w", err)
	}
	_ = p.page.WaitForURL(regexp.MustCompile(`new-file-server`), playwright.PageWaitForURLOptions{
		Timeout: playwright.Float(15000),
	})
	p.sleep(3000)
	p.screenshot("smb-step1-loaded")

	// ── Step 1: Server Name ─────────────────────────────────────────────
	nameField := p.page.GetByPlaceholder("Name")
	if err := p.expectVisible(nameField, 15000); err != nil {
		return "", fmt.Errorf("step1: Name field not visible: %w", err)
	}
	_ = nameField.Fill(name)
	_ = p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"}).Click()
	p.sleep(2000)
	p.screenshot("smb-step2-loaded")

	// ── Step 2: Credentials ─────────────────────────────────────────────
	hostField := p.page.GetByRole("textbox", playwright.PageGetByRoleOptions{Name: "Host Name"})
	if err := p.expectVisible(hostField, 10000); err != nil {
		return "", fmt.Errorf("step2: Host Name field not visible: %w", err)
	}
	_ = hostField.Fill(host)

	// Expand the SMB accordion.
	_ = p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "SMB"}).First().Click()
	p.sleep(1000)

	_ = p.page.GetByPlaceholder("Username").Fill(smbUser)
	if smbPass != "" {
		_ = p.page.GetByPlaceholder("Password").Fill(smbPass)
	}
	p.screenshot("smb-step2-filled")

	_ = p.page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"}).Click()
	p.sleep(3000)
	p.screenshot("smb-step3-loaded")

	// ── Step 3: Workers ─────────────────────────────────────────────────
	if err := p.expectVisible(
		p.page.GetByText(regexp.MustCompile(`(?i)Compatible Workers`)).First(),
		15000,
	); err != nil {
		return "", fmt.Errorf("step3: Compatible Workers label not visible: %w", err)
	}

	workerNames := p.page.GetByText(regexp.MustCompile(`(?i)worker`))
	_ = workerNames.First().WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(15000),
	})
	p.sleep(2000)

	workerCount, _ := workerNames.Count()
	log.Printf("[CreateSMBFileServer] found %d worker(s)", workerCount)

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
			continue
		}
		if m["isOffline"] == true || m["isDisabled"] == true {
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
		return "", fmt.Errorf("step3: no online workers available to toggle")
	}
	log.Printf("[CreateSMBFileServer] %d worker(s) associated", toggled)
	p.screenshot("smb-step3-workers-toggled")

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
	url := config.BaseURL + "/new-file-server"
	if _, err := p.page.Goto(url, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(60000),
	}); err != nil {
		return "", fmt.Errorf("goto new-file-server: %w", err)
	}
	_ = p.page.WaitForURL(regexp.MustCompile(`new-file-server`), playwright.PageWaitForURLOptions{
		Timeout: playwright.Float(15000),
	})
	p.sleep(3000)
	p.screenshot("isilon-step1-loaded")

	// ── Step 1: Server Type ────────────────────────────────────────────
	nameField := p.page.GetByPlaceholder("Name")
	if err := p.expectVisible(nameField, 15000); err != nil {
		return "", fmt.Errorf("step1: Name field not visible: %w", err)
	}
	_ = nameField.Fill(name)

	// Select "Dell PowerScale (Isilon)" from Server Type dropdown.
	serverTypeDropdown := p.page.Locator(`[name="serverType"], [role="combobox"]`).First()
	if p.isVisible(serverTypeDropdown) {
		_ = serverTypeDropdown.Click()
		p.sleep(500)
	} else {
		// Fallback: click any dropdown-like element near "Server Type"
		p.page.GetByText("Server Type").First().Click()
		p.sleep(500)
	}
	isilonOption := p.page.GetByText("Dell PowerScale (Isilon)", playwright.PageGetByTextOptions{
		Exact: playwright.Bool(false),
	}).First()
	if err := p.expectVisible(isilonOption, 5000); err != nil {
		return "", fmt.Errorf("step1: Isilon option not visible in dropdown: %w", err)
	}
	_ = isilonOption.Click()
	p.sleep(1000)

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
	if err := p.expectVisible(acceptBtn, 15000); err == nil {
		p.screenshot("isilon-certificate-dialog")
		_ = acceptBtn.Click()
		p.sleep(3000)
	}

	p.screenshot("isilon-step2-loaded")

	// ── Step 2: Access Zones / Credentials ─────────────────────────────
	// Wait for the Access Zones table to render.
	if err := p.expectVisible(
		p.page.GetByText("Access Zones").First(), 15000,
	); err != nil {
		return "", fmt.Errorf("step2: Access Zones table not visible: %w", err)
	}
	p.sleep(2000)

	// Select the first access zone checkbox (e.g., "MyZone").
	zoneCBs := p.page.Locator(`tbody tr [role="checkbox"], tbody tr input[type="checkbox"]`)
	cbCount, _ := zoneCBs.Count()
	if cbCount > 0 {
		firstCB := zoneCBs.First()
		checked, _ := firstCB.GetAttribute("aria-checked")
		if checked != "true" {
			_ = firstCB.Click()
			p.sleep(1000)
		}
	} else {
		log.Printf("[CreateIsilonFileServer] WARNING: no zone checkboxes found")
	}

	// Select NFS IP from the dropdown in the selected zone row.
	if nfsIP != "" {
		nfsIPDropdowns := p.page.Locator(`tbody tr`).First().Locator(`select, [role="combobox"], [class*="dropdown"]`)
		// Try clicking any dropdown trigger that looks like the NFS IP selector.
		nfsIPTrigger := p.page.Locator(`tbody tr`).First().Locator(`text=Select NFS IP, text=NFS IP`).First()
		if !p.isVisible(nfsIPTrigger) {
			// Fallback: find the NFS IP column dropdown.
			ddCount, _ := nfsIPDropdowns.Count()
			if ddCount > 0 {
				nfsIPTrigger = nfsIPDropdowns.First()
			}
		}
		if p.isVisible(nfsIPTrigger) {
			_ = nfsIPTrigger.Click()
			p.sleep(500)
			// Pick the matching IP from the dropdown options.
			ipOption := p.page.GetByText(nfsIP, playwright.PageGetByTextOptions{
				Exact: playwright.Bool(false),
			}).First()
			if err := p.expectVisible(ipOption, 5000); err == nil {
				_ = ipOption.Click()
				p.sleep(500)
			} else {
				log.Printf("[CreateIsilonFileServer] NFS IP %q not found in dropdown, selecting first option", nfsIP)
				// Select whatever first option is available.
				firstOpt := p.page.Locator(`[role="option"], [role="listbox"] li`).First()
				if p.isVisible(firstOpt) {
					_ = firstOpt.Click()
					p.sleep(500)
				}
			}
		}
	}

	// Fill NFS Username in the zone row.
	if nfsUser != "" {
		nfsUserField := p.page.Locator(`tbody tr`).First().GetByPlaceholder("NFS Username")
		if p.isVisible(nfsUserField) {
			_ = nfsUserField.Fill(nfsUser)
		}
	}

	p.screenshot("isilon-step2-filled")
	_ = p.clickProceed()
	p.sleep(3000)
	p.screenshot("isilon-step3-loaded")

	// ── Step 3: Workers ────────────────────────────────────────────────
	// The left sidebar shows access zones; the right shows workers for the
	// selected zone. Toggle workers on.

	// Wait for the worker table to appear.
	_ = p.page.GetByText(regexp.MustCompile(`(?i)Workers`)).First().WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(15000),
	})
	p.sleep(2000)

	// Find worker rows by matching "worker" text in the table.
	workerNames := p.page.GetByText(regexp.MustCompile(`(?i)worker`))
	_ = workerNames.First().WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(15000),
	})
	p.sleep(1000)

	workerCount, _ := workerNames.Count()
	log.Printf("[CreateIsilonFileServer] found %d worker(s)", workerCount)

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
			log.Printf("[CreateIsilonFileServer] worker %d: already ON", i)
			continue
		}
		if m["isOffline"] == true || m["isDisabled"] == true {
			log.Printf("[CreateIsilonFileServer] worker %d: offline/disabled, skipping", i)
			continue
		}
		clicked, _ := el.Evaluate(fsToggleClickJS, nil)
		if cb, ok := clicked.(bool); ok && cb {
			toggled++
			log.Printf("[CreateIsilonFileServer] worker %d: toggled ON", i)
			p.sleep(1000)
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

// navigateToFileServer goes to the file server list, finds the row
// by name, clicks it, and returns the UUID from the resulting URL.
// Retries navigation up to 5 times for eventual consistency.
func (p *FileServerPage) navigateToFileServer(name string) (string, error) {
	re := regexp.MustCompile(`/file-server/([a-f0-9-]+)`)

	nameLink := p.page.GetByText(name, playwright.PageGetByTextOptions{
		Exact: playwright.Bool(true),
	})

	for attempt := 0; attempt < 5; attempt++ {
		p.page.Goto(config.BaseURL+"/file-server", playwright.PageGotoOptions{
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
			Timeout:   playwright.Float(30000),
		})
		p.sleep(5000)

		if p.isVisible(nameLink.First()) {
			break
		}
		log.Printf("[navigateToFileServer] attempt %d: %q not visible in list, retrying…", attempt+1, name)
	}

	if err := p.expectVisible(nameLink.First(), 15000); err != nil {
		p.screenshot("fs-name-not-found")
		return "", fmt.Errorf("file server %q not found in list", name)
	}
	_ = nameLink.First().Click()

	_ = p.page.WaitForURL(regexp.MustCompile(`/file-server/[a-f0-9-]+`), playwright.PageWaitForURLOptions{
		Timeout: playwright.Float(15000),
	})

	m := re.FindStringSubmatch(p.page.URL())
	if len(m) < 2 {
		return "", fmt.Errorf("could not extract file server ID from %s", p.page.URL())
	}
	log.Printf("[navigateToFileServer] ID: %s", m[1])
	return m[1], nil
}

// WaitForFileServerActive polls the file server overview page until the
// "Bulk Discover" button is visible and enabled (server is Active with
// export paths retrieved).
func (p *FileServerPage) WaitForFileServerActive(fsID string, timeoutMs float64) error {
	deadline := time.Now().Add(time.Duration(timeoutMs) * time.Millisecond)
	attempt := 0

	for time.Now().Before(deadline) {
		attempt++
		p.page.Goto(config.BaseURL+"/file-server/"+fsID, playwright.PageGotoOptions{
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
			Timeout:   playwright.Float(30000),
		})
		p.sleep(5000)

		overview := p.page.GetByText("File Server Overview").First()
		if !p.isVisible(overview) {
			log.Printf("[WaitForFileServerActive] attempt %d: overview not visible", attempt)
			p.sleep(10000)
			continue
		}

		bulkBtn := p.page.GetByRole("button", playwright.PageGetByRoleOptions{
			Name: "Bulk Discover",
		})
		if p.isVisible(bulkBtn) {
			disabled, _ := bulkBtn.IsDisabled()
			if !disabled {
				log.Printf("[WaitForFileServerActive] file server active on attempt %d", attempt)
				p.screenshot("fs-active")
				return nil
			}
			log.Printf("[WaitForFileServerActive] attempt %d: Bulk Discover disabled", attempt)
		} else {
			log.Printf("[WaitForFileServerActive] attempt %d: Bulk Discover not visible", attempt)
		}

		p.sleep(15000)
	}

	p.screenshot("fs-not-active-timeout")
	return fmt.Errorf("file server %s did not become active within %.0fs", fsID, timeoutMs/1000)
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
	path := fmt.Sprintf("test-results/screenshots/%s.png", name)
	_, _ = p.page.Screenshot(playwright.PageScreenshotOptions{
		Path:     playwright.String(path),
		FullPage: playwright.Bool(true),
	})
	log.Printf("[screenshot] saved → %s", path)
}
