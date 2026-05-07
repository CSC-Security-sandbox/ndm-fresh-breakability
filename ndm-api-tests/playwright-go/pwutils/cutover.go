package pwutils

import (
	"encoding/json"
	"fmt"
	"log"
	"regexp"

	"github.com/playwright-community/playwright-go"
)

func RunBulkCutover(page playwright.Page, srcFsID string) error {
	GotoWithRetry(page, FullURL(fmt.Sprintf("/file-server/%s", srcFsID)), 5)

	if err := ExpectVisible(page.GetByText("File Server Overview").First(), 30000); err != nil {
		return err
	}

	cutoverBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: regexp.MustCompile(`(?i)cutover`)})
	if err := ExpectVisible(cutoverBtn.First(), 30000); err != nil {
		return fmt.Errorf("cutover button not visible: %w", err)
	}
	_ = cutoverBtn.First().Click()

	_ = page.WaitForURL(regexp.MustCompile(`(?i)cutover`), playwright.PageWaitForURLOptions{Timeout: playwright.Float(15000)})
	Sleep(3000)

	SelectAllTableRows(page)
	Sleep(1000)

	submitBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Submit"})
	if err := ExpectVisible(submitBtn, 30000); err != nil {
		procBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"})
		if IsVisible(procBtn) {
			_ = procBtn.Click()
			Sleep(3000)
			SelectAllTableRows(page)
			Sleep(1000)
			submitBtn = page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Submit"})
		}
	}

	if IsVisible(submitBtn) {
		_ = submitBtn.Click()
		log.Println("[bulkCutover] Clicked Submit")
		Sleep(5000)
	}

	confirmBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Proceed"})
	if IsVisible(confirmBtn) {
		_ = confirmBtn.Click()
		log.Println("[bulkCutover] Confirmed modal")
		Sleep(3000)
	}

	_ = ExpectVisible(page.GetByText(regexp.MustCompile(`(?i)cutover.*created|bulk cutover.*created`)).First(), 15000)
	log.Println("[bulkCutover] Cutover job created")
	return nil
}

const jobRunActionJS = `async ({ runId, action }) => {
	const env = window.env || {};
	const base = env.VITE_JOBS_SERVICE_URL;
	if (!base) return JSON.stringify({ success: false, debug: "no VITE_JOBS_SERVICE_URL" });
	const projectId = localStorage.getItem("selected_project_id") || "";
	let token = "";
	for (const s of [sessionStorage, localStorage]) {
		for (let i = 0; i < s.length; i++) {
			const k = s.key(i);
			if (k.includes("token")||k.includes("oidc")) {
				const v = s.getItem(k)||"";
				try { const p = JSON.parse(v); if (p?.access_token) { token = p.access_token; break; } if (p?.accessToken) { token = p.accessToken; break; } }
				catch { if (v.startsWith("eyJ")) { token = v; break; } }
			}
		}
		if (token) break;
	}
	const h = { "Content-Type": "application/json", projectId };
	if (token) h["Authorization"] = "Bearer " + token;
	try {
		const r = await fetch(base + "/job-run/cutover/approve", {
			method: "PUT", headers: h, credentials: "include",
			body: JSON.stringify({ action, jobRunId: runId }),
		});
		return JSON.stringify({ success: r.ok, status: r.status });
	} catch (e) { return JSON.stringify({ success: false, debug: e.message }); }
}`

func ApproveCutover(page playwright.Page, runID string) error {
	EnsureEnvLoaded(page)
	raw, err := page.Evaluate(jobRunActionJS, map[string]interface{}{
		"runId":  runID,
		"action": "APPROVED",
	})
	if err != nil {
		return fmt.Errorf("evaluate: %w", err)
	}
	jsonStr, _ := raw.(string)
	var r struct {
		Success bool   `json:"success"`
		Debug   string `json:"debug"`
	}
	json.Unmarshal([]byte(jsonStr), &r)
	if !r.Success {
		return fmt.Errorf("approve cutover %s failed: %s", runID, r.Debug)
	}
	log.Printf("[approveCutover] %s: approved", runID)
	return nil
}
