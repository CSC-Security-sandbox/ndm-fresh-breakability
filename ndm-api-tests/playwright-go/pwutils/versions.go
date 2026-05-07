package pwutils

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/playwright-community/playwright-go"
)

func VerifyVersions(page playwright.Page) error {
	log.Println("[versions] Checking NDM versions via About page...")
	EnsureEnvLoaded(page)

	raw, err := page.Evaluate(`async () => {
		const env = window.env || {};
		const base = env.VITE_ADMIN_SERVICE_URL || env.VITE_CONFIG_SERVICE_URL;
		if (!base) return JSON.stringify({ error: "no admin service url" });
		const projectId = localStorage.getItem("selected_project_id") || "";
		let token = "";
		for (const s of [sessionStorage, localStorage]) {
			for (let i = 0; i < s.length; i++) {
				const k = s.key(i);
				if (k.includes("token")||k.includes("oidc")) {
					const v = s.getItem(k)||"";
					try { const p = JSON.parse(v); if (p?.access_token) { token = p.access_token; break; } }
					catch { if (v.startsWith("eyJ")) { token = v; break; } }
				}
			}
			if (token) break;
		}
		const h = { "Content-Type": "application/json", projectId };
		if (token) h["Authorization"] = "Bearer " + token;
		try {
			const r = await fetch(base + "/api/v1/about-ndm", { headers: h, credentials: "include" });
			const j = await r.json();
			return JSON.stringify(j);
		} catch (e) { return JSON.stringify({ error: e.message }); }
	}`)
	if err != nil {
		return fmt.Errorf("evaluate: %w", err)
	}
	jsonStr, _ := raw.(string)
	truncated := jsonStr
	if len(truncated) > 500 {
		truncated = truncated[:500] + "..."
	}
	log.Printf("[versions] API response: %s", truncated)

	if strings.Contains(jsonStr, `"error"`) {
		return fmt.Errorf("about-ndm API error: %s", truncated)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &resp); err == nil {
		if data, ok := resp["data"].(map[string]interface{}); ok {
			if items, ok := data["items"].(map[string]interface{}); ok {
				if build, ok := items["build"].(map[string]interface{}); ok {
					if cpv, ok := build["controlPlaneVersion"].(map[string]interface{}); ok {
						log.Printf("[versions] Control Plane version: %v", cpv["version"])
					}
					if wv, ok := build["workerVersion"].(map[string]interface{}); ok {
						log.Printf("[versions] Worker version: %v", wv["version"])
					}
				}
			}
		}
	}

	log.Println("[versions] Version check passed")
	return nil
}
