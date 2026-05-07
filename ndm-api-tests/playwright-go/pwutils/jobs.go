package pwutils

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/playwright-community/playwright-go"
)

type JobStatus struct {
	Status       string `json:"status"`
	RunID        string `json:"runId"`
	JobType      string `json:"jobType"`
	ConfigStatus string `json:"configStatus"`
	RunCount     int    `json:"runCount"`
	Debug        string `json:"debug"`
}

const getAllJobIDsJS = `async ({ jt }) => {
	const env = window.env || {};
	const base = env.VITE_JOBS_SERVICE_URL;
	if (!base) return JSON.stringify({ jobs: [], debug: "no VITE_JOBS_SERVICE_URL" });
	const projectId = localStorage.getItem("selected_project_id") || "";
	let token = "";
	for (const s of [sessionStorage, localStorage]) {
		for (let i = 0; i < s.length; i++) {
			const k = s.key(i);
			if (k.includes("token") || k.includes("oidc")) {
				const v = s.getItem(k) || "";
				try { const p = JSON.parse(v); if (p?.access_token) { token = p.access_token; break; } if (p?.accessToken) { token = p.accessToken; break; } }
				catch { if (v.startsWith("eyJ")) { token = v; break; } }
			}
		}
		if (token) break;
	}
	const h = { "Content-Type": "application/json", projectId };
	if (token) h["Authorization"] = "Bearer " + token;
	try {
		const r = await fetch(base + "/jobs?projectId=" + projectId, { headers: h, credentials: "include" });
		const j = await r.json();
		let items = Array.isArray(j?.data?.items) ? j.data.items : Array.isArray(j?.data) ? j.data : [];
		const matched = items.filter(job => {
			if (jt && !(job.jobType || "").toLowerCase().includes(jt.toLowerCase())) return false;
			return true;
		}).map(job => job.id || job.jobConfigId);
		return JSON.stringify({ jobs: matched, total: items.length });
	} catch (e) { return JSON.stringify({ jobs: [], debug: e.message }); }
}`

const pollJobStatusJS = `async ({ configId }) => {
	const env = window.env || {};
	const base = env.VITE_JOBS_SERVICE_URL;
	if (!base) return JSON.stringify({ status: "unknown", runId: "" });
	const projectId = localStorage.getItem("selected_project_id") || "";
	let token = "";
	for (const s of [sessionStorage, localStorage]) {
		for (let i = 0; i < s.length; i++) {
			const k = s.key(i);
			if (k.includes("token") || k.includes("oidc")) {
				const v = s.getItem(k) || "";
				try { const p = JSON.parse(v); if (p?.access_token) { token = p.access_token; break; } if (p?.accessToken) { token = p.accessToken; break; } }
				catch { if (v.startsWith("eyJ")) { token = v; break; } }
			}
		}
		if (token) break;
	}
	const h = { "Content-Type": "application/json", projectId };
	if (token) h["Authorization"] = "Bearer " + token;
	try {
		const r = await fetch(base + "/jobs/" + configId, { headers: h, credentials: "include" });
		const j = await r.json();
		const d = j?.data?.items || j?.data || j || {};
		const runs = Array.isArray(d.jobRuns) ? d.jobRuns : [];
		if (runs.length > 0) {
			const latest = runs[0];
			return JSON.stringify({
				status: (latest.status||"unknown").toLowerCase(),
				runId: latest.id||latest.jobRunId||"",
				jobType: (d.jobType||"").toLowerCase(),
				configStatus: (d.status||"").toLowerCase(),
				runCount: runs.length
			});
		}
		return JSON.stringify({
			status: "no_runs",
			runId: "",
			jobType: (d.jobType||"").toLowerCase(),
			configStatus: (d.status||"").toLowerCase(),
			runCount: 0
		});
	} catch (e) { return JSON.stringify({ status: "error", runId: "", debug: e.message }); }
}`

func EnsureEnvLoaded(page playwright.Page) {
	hasEnv, _ := page.Evaluate(`() => !!(window.env?.VITE_JOBS_SERVICE_URL)`)
	if b, ok := hasEnv.(bool); !ok || !b {
		page.Goto(FullURL("/home"), playwright.PageGotoOptions{
			Timeout:   playwright.Float(60000),
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		})
		Sleep(3000)
	}
}

func FetchAllJobIDs(page playwright.Page, jobType string) (map[string]bool, error) {
	EnsureEnvLoaded(page)
	raw, err := page.Evaluate(getAllJobIDsJS, map[string]interface{}{"jt": jobType})
	if err != nil {
		return nil, err
	}
	jsonStr, _ := raw.(string)
	var r struct {
		Jobs  []string `json:"jobs"`
		Total int      `json:"total"`
		Debug string   `json:"debug"`
	}
	json.Unmarshal([]byte(jsonStr), &r)
	if r.Debug != "" {
		log.Printf("[fetchAllJobIDs] debug: %s", r.Debug)
	}
	set := make(map[string]bool, len(r.Jobs))
	for _, id := range r.Jobs {
		set[id] = true
	}
	log.Printf("[fetchAllJobIDs] Found %d %s job(s) (total %d)", len(set), jobType, r.Total)
	return set, nil
}

func DiffJobIDs(before, after map[string]bool) []string {
	var newIDs []string
	for id := range after {
		if !before[id] {
			newIDs = append(newIDs, id)
		}
	}
	return newIDs
}

func PollJob(page playwright.Page, configID string) (*JobStatus, error) {
	EnsureEnvLoaded(page)
	raw, err := page.Evaluate(pollJobStatusJS, map[string]interface{}{"configId": configID})
	if err != nil {
		return nil, err
	}
	jsonStr, _ := raw.(string)
	var r JobStatus
	json.Unmarshal([]byte(jsonStr), &r)
	return &r, nil
}

func WaitForJobState(page playwright.Page, configID, target string, timeoutSec int) error {
	deadline := time.Now().Add(time.Duration(timeoutSec) * time.Second)
	runAppeared := false
	for time.Now().Before(deadline) {
		r, err := PollJob(page, configID)
		if err == nil {
			if r.RunCount == 0 && !runAppeared {
				log.Printf("[waitForJobState] %s: waiting for run to appear (configStatus=%s)", configID, r.ConfigStatus)
				SleepSec(10)
				continue
			}
			runAppeared = true
			log.Printf("[waitForJobState] %s: status=%s configStatus=%s runs=%d (target=%s)",
				configID, r.Status, r.ConfigStatus, r.RunCount, target)
			if strings.EqualFold(r.Status, target) {
				return nil
			}
			if r.Status == "errored" || r.Status == "failed" {
				return fmt.Errorf("job %s entered %s state", configID, r.Status)
			}
		}
		SleepSec(10)
	}
	if !runAppeared {
		return fmt.Errorf("job %s: no run appeared within %ds", configID, timeoutSec)
	}
	return fmt.Errorf("job %s did not reach %q within %ds", configID, target, timeoutSec)
}

func VerifyJobActiveNoRuns(page playwright.Page, jobConfigIDs []string) error {
	for _, configID := range jobConfigIDs {
		r, err := PollJob(page, configID)
		if err != nil {
			return fmt.Errorf("poll %s: %w", configID, err)
		}
		log.Printf("[verifyActiveNoRuns] %s: configStatus=%s jobType=%s runCount=%d",
			configID, r.ConfigStatus, r.JobType, r.RunCount)

		if !strings.EqualFold(r.ConfigStatus, "active") {
			return fmt.Errorf("job %s expected ACTIVE status, got %q", configID, r.ConfigStatus)
		}
		if r.RunCount != 0 {
			return fmt.Errorf("job %s expected 0 runs, got %d", configID, r.RunCount)
		}
	}
	return nil
}

func WaitForRunToAppear(page playwright.Page, configID string, timeoutSec int) (*JobStatus, error) {
	deadline := time.Now().Add(time.Duration(timeoutSec) * time.Second)
	for time.Now().Before(deadline) {
		r, err := PollJob(page, configID)
		if err == nil && r.RunCount > 0 {
			log.Printf("[waitForRun] %s: run appeared — status=%s runId=%s", configID, r.Status, r.RunID)
			return r, nil
		}
		SleepSec(10)
	}
	return nil, fmt.Errorf("job %s: no run appeared within %ds", configID, timeoutSec)
}
