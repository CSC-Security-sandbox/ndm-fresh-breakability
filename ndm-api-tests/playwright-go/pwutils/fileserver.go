package pwutils

import (
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/playwright-community/playwright-go"
)

func CreateFileServer(page playwright.Page, name, host, protocol, username, password string, minWorkers int) error {
	if _, err := page.Goto(FullURL("/home"), playwright.PageGotoOptions{
		Timeout:   playwright.Float(60000),
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
	}); err != nil {
		return fmt.Errorf("goto home: %w", err)
	}
	if err := ExpectVisible(page.GetByRole("heading", playwright.PageGetByRoleOptions{Name: "Home"}), 30000); err != nil {
		return fmt.Errorf("home heading: %w", err)
	}

	if err := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Add File Server"}).Click(); err != nil {
		return fmt.Errorf("click add file server: %w", err)
	}
	_ = page.WaitForURL(regexp.MustCompile(`new-file-server`), playwright.PageWaitForURLOptions{Timeout: playwright.Float(15000)})
	Sleep(3000)

	// Step 0 — Server Name
	nameField := page.GetByPlaceholder("Name")
	if err := ExpectVisible(nameField, 15000); err != nil {
		return fmt.Errorf("name field: %w", err)
	}
	_ = nameField.Fill(name)
	_ = page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"}).Click()
	Sleep(2000)

	// Step 1 — Credentials
	hostField := page.GetByRole("textbox", playwright.PageGetByRoleOptions{Name: "Host Name"})
	if err := ExpectVisible(hostField, 10000); err != nil {
		return fmt.Errorf("host field: %w", err)
	}
	_ = hostField.Fill(host)

	if protocol == "NFS" {
		_ = page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "NFS"}).First().Click()
		Sleep(1000)
		_ = page.GetByPlaceholder("Username").Fill(username)
		if password != "" {
			_ = page.GetByPlaceholder("Password").Fill(password)
		}
	} else {
		_ = page.GetByRole("radio", playwright.PageGetByRoleOptions{Name: "SMB"}).Click()
		Sleep(1000)
		_ = page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "SMB"}).First().Click()
		Sleep(1000)
		_ = page.GetByPlaceholder("Username").Fill(username)
		if password != "" {
			_ = page.GetByPlaceholder("Password").Fill(password)
		}
	}

	_ = page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"}).Click()
	Sleep(3000)

	// Step 2 — Workers: toggle online workers
	if err := ExpectVisible(page.GetByText(regexp.MustCompile(`(?i)Compatible Workers`)).First(), 15000); err != nil {
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
	Sleep(2000)

	workerCount, _ := workerNames.Count()
	log.Printf("[createFileServer] Found %d worker(s)", workerCount)

	toggled := 0
	for i := 0; i < workerCount; i++ {
		el := workerNames.Nth(i)
		if !IsVisible(el) {
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
			Sleep(1000)
		}
	}

	if toggled == 0 {
		Screenshot(page, "debug-no-online-workers")
		return fmt.Errorf("no online workers available")
	}
	if toggled < minWorkers {
		Screenshot(page, "debug-not-enough-workers")
		log.Printf("[createFileServer] WARNING: only %d worker(s) associated, wanted %d", toggled, minWorkers)
	}
	log.Printf("[createFileServer] %d worker(s) associated (min required: %d)", toggled, minWorkers)

	// Click Finish with retry
	const maxRetries = 3
	for attempt := 1; attempt <= maxRetries; attempt++ {
		log.Printf("[createFileServer] Attempt %d/%d — clicking Finish...", attempt, maxRetries)
		finishBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Finish"})
		_ = ExpectVisible(finishBtn, 10000)
		_ = finishBtn.Click()

		loadingBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Loading"})
		if err := ExpectVisible(loadingBtn, 10000); err == nil {
			log.Printf("[createFileServer] Attempt %d: validation started", attempt)
		}

		deadline := time.Now().Add(2 * time.Minute)
		outcome := "timeout"
		for time.Now().Before(deadline) {
			if !strings.Contains(page.URL(), "new-file-server") {
				outcome = "redirected"
				break
			}
			if IsVisible(page.GetByText("Configuration Successfully saved").First()) {
				outcome = "success_toast"
				break
			}
			if IsVisible(page.GetByText("Error creating file server").First()) ||
				IsVisible(page.GetByText("File Server Name already exists").First()) {
				outcome = "error_toast"
				break
			}
			if IsVisible(page.GetByText(regexp.MustCompile(`(?i)Failed to perform validaton`)).First()) ||
				IsVisible(page.GetByText(regexp.MustCompile(`(?i)Worker.*not responding`)).First()) {
				outcome = "validation_error"
				break
			}
			Sleep(3000)
		}

		log.Printf("[createFileServer] Attempt %d: outcome = %s", attempt, outcome)

		if outcome == "redirected" || outcome == "success_toast" {
			Sleep(3000)
			log.Printf("[createFileServer] File server %q created successfully", name)
			return nil
		}
		if outcome == "error_toast" {
			Screenshot(page, "debug-create-error")
			return fmt.Errorf("file server creation failed (fatal error)")
		}

		Screenshot(page, fmt.Sprintf("debug-validation-attempt-%d", attempt))
		if attempt < maxRetries {
			closeBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Close"})
			if IsVisible(closeBtn.First()) {
				_ = closeBtn.First().Click()
				Sleep(1000)
			}
			backBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Back"})
			if IsVisible(backBtn) {
				_ = backBtn.Click()
				Sleep(2000)
				_ = page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"}).Click()
				Sleep(3000)
			}
			Sleep(5000)
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

func NavigateToFileServer(page playwright.Page, srvName string) (string, error) {
	re := regexp.MustCompile(`/file-server/([a-f0-9-]+)`)
	if m := re.FindStringSubmatch(page.URL()); len(m) > 1 {
		return m[1], nil
	}

	GotoWithRetry(page, FullURL("/file-server"), 5)

	nameLink := page.GetByText(srvName, playwright.PageGetByTextOptions{Exact: playwright.Bool(true)})
	for attempt := 0; attempt < 5; attempt++ {
		if IsVisible(nameLink.First()) {
			break
		}
		GotoWithRetry(page, FullURL("/file-server"), 1)
	}

	if err := ExpectVisible(nameLink.First(), 15000); err != nil {
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
