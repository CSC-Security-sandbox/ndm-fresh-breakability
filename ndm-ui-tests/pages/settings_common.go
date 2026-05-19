package pages

import (
	"fmt"
	"os"
	"strings"

	"ndm-ui-tests/config"

	"github.com/playwright-community/playwright-go"
)

// openSettingsDrawer navigates to the NDM home page and opens the
// Settings drawer (right-side panel) by clicking the gear icon.
//
// NDM 2026.05 layout:
//   - Login lands on  https://<cp>/home
//   - Settings is a MUI Drawer (MuiDrawer-anchorRight) — not its own URL
//   - The trigger is a gear/cog button in the top-right header
//
// Selector strategy — try in order:
//  1. data-testid="settings-button" (works after the UI rebuild that
//     added the testid; preferred long-term).
//  2. Common a11y locators (aria-label, title).
//  3. Brute-force: click each visible icon-button near the top of the page
//     and check whether the Settings drawer rendered. This works against
//     today's UI build that has no data-testid yet.
func openSettingsDrawer(page playwright.Page) error {
	// FAST PATH 1: If the drawer is already open (e.g. we just submitted
	// a project and the drawer never closed), do nothing — switching tabs
	// is the caller's job.
	if drawerOpen(page) {
		return nil
	}

	// FAST PATH 2: If we're already on /home, no need to re-navigate
	// (a navigation would dismount the React tree and lose our state).
	currentURL := page.URL()
	onHome := strings.Contains(currentURL, "/home")
	if !onHome {
		if _, err := page.Goto(config.BaseURL+"/home",
			playwright.PageGotoOptions{WaitUntil: playwright.WaitUntilStateCommit}); err != nil {
			return fmt.Errorf("goto /home: %w", err)
		}
	}

	// Wait for the top header to actually render so we have icon buttons
	// to enumerate. Without this the page can return zero buttons on the
	// first query because React hasn't mounted yet.
	if _, err := page.WaitForSelector(`button:has(svg)`,
		playwright.PageWaitForSelectorOptions{
			State:   playwright.WaitForSelectorStateAttached,
			Timeout: playwright.Float(30000),
		}); err != nil {
		return fmt.Errorf("waiting for header to render: %w", err)
	}

	// Re-check after navigation/render — the drawer might already be visible.
	if drawerOpen(page) {
		return nil
	}

	// 1 & 2: deterministic selectors — fast path when the UI has IDs.
	known := []string{
		`[data-testid="settings-button"]`,
		`[data-testid="open-settings"]`,
		`button[aria-label*="setting" i]`,
		`button[aria-label*="cog" i]`,
		`button[title*="setting" i]`,
	}
	for _, sel := range known {
		btn := page.Locator(sel).First()
		if visible, _ := btn.IsVisible(); !visible {
			continue
		}
		if err := btn.Click(); err != nil {
			continue
		}
		if waitForDrawer(page, 6000) == nil {
			return nil
		}
		_ = page.Keyboard().Press("Escape")
	}

	// 3. Brute-force: walk every visible icon-button on the page.
	//    Each click is followed by a drawer-presence check; if the wrong
	//    button opens a different panel (help, profile, project switcher)
	//    we press Escape and try the next one.
	all, err := page.Locator(`button:has(svg)`).All()
	if err != nil {
		return fmt.Errorf("locate icon buttons: %w", err)
	}

	candidates := 0
	for i, btn := range all {
		visible, _ := btn.IsVisible()
		if !visible {
			continue
		}
		candidates++
		// Debug: snapshot the button's outerHTML so we know what we clicked.
		// (Comment out after diagnosis if too noisy.)
		if html, herr := btn.Evaluate(`el => el.outerHTML`, nil); herr == nil {
			if s, ok := html.(string); ok && len(s) < 200 {
				fmt.Printf("[openSettingsDrawer] try #%d button: %s\n", i, s)
			} else {
				fmt.Printf("[openSettingsDrawer] try #%d button (size %d)\n", i, len(s))
			}
		}

		if err := btn.Click(); err != nil {
			fmt.Printf("[openSettingsDrawer] click #%d failed: %v\n", i, err)
			continue
		}
		if waitForDrawer(page, 4000) == nil {
			fmt.Printf("[openSettingsDrawer] button #%d OPENED the drawer\n", i)
			return nil
		}
		fmt.Printf("[openSettingsDrawer] button #%d did NOT open the drawer; pressing Escape\n", i)
		// Wrong button — close any popover/drawer it might have opened.
		_ = page.Keyboard().Press("Escape")
		_ = page.Keyboard().Press("Escape")
	}

	// Final desperate try: take a screenshot for debugging.
	_ = os.MkdirAll(config.ScreenshotDir, 0o755)
	_, _ = page.Screenshot(playwright.PageScreenshotOptions{
		Path:     playwright.String(config.ScreenshotDir + "/no-settings-trigger.png"),
		FullPage: playwright.Bool(true),
	})

	return fmt.Errorf(
		"could not find Settings trigger after clicking %d visible icon "+
			"buttons (page URL: %s). Screenshot saved to "+
			"%s/no-settings-trigger.png. "+
			`Add data-testid="settings-button" to the gear icon in `+
			"services/datamigrator-ui/src/components/top-nav-bar/setting/Settings.tsx",
		candidates, page.URL(), config.ScreenshotDir)
}

// drawerSignals is a list of selectors any of which becoming visible
// indicates that the Settings drawer is open.
//
// We can't combine `text=` and CSS in a single Playwright locator via
// comma, so we check each one separately.
var drawerSignals = []string{
	`[class*="MuiDrawer-anchorRight"]`,                 // the drawer container
	`[role="dialog"]:has-text("Settings")`,             // accessible name
	`text=Settings`,                                    // drawer heading
	`text=Add User`,                                    // unique button on Users tab
	`text=Add Project`,                                 // unique button on Projects tab
	`text=SMTP`,                                        // SMTP tab text
}

// drawerOpen returns true if the Settings drawer is currently rendered.
func drawerOpen(page playwright.Page) bool {
	for _, sel := range drawerSignals {
		if v, _ := page.Locator(sel).First().IsVisible(); v {
			return true
		}
	}
	return false
}

// waitForDrawer polls drawerOpen() until either it returns true or the
// timeout expires.
func waitForDrawer(page playwright.Page, timeoutMs float64) error {
	deadline := timeoutMs
	const step = 200.0
	for elapsed := 0.0; elapsed < deadline; elapsed += step {
		if drawerOpen(page) {
			return nil
		}
		page.WaitForTimeout(step)
	}
	return fmt.Errorf("drawer did not open within %.0fms", timeoutMs)
}


// clickSettingsTab clicks one of the tabs inside the Settings drawer:
// Users / Projects / SMTP.
//
// The bxp design-system's InnerTab.Button doesn't render with role="tab",
// so we target it by data-testid (preferred) or by clicking the button
// element that contains the matching tab text.
func clickSettingsTab(page playwright.Page, tab string) error {
	selectors := []string{
		fmt.Sprintf(`[data-testid="settings-tab-%s"]`, tab),
		fmt.Sprintf(`[role="tab"]:has-text("%s")`, tab),
		fmt.Sprintf(`button:has-text("%s")`, tab),
		fmt.Sprintf(`[class*="MuiDrawer-anchorRight"] :text-is("%s")`, tab),
	}
	for _, sel := range selectors {
		loc := page.Locator(sel).First()
		if visible, _ := loc.IsVisible(); !visible {
			continue
		}
		if err := loc.Click(); err == nil {
			return nil
		}
	}
	return fmt.Errorf("could not click %q tab in Settings drawer", tab)
}

// clickAny tries each selector in order and clicks the first one that's
// visible. Used in place of mixed CSS + Playwright text-engine selectors,
// which can't be combined via comma in a single locator string.
func clickAny(page playwright.Page, selectors ...string) error {
	for _, sel := range selectors {
		loc := page.Locator(sel).First()
		if visible, _ := loc.IsVisible(); !visible {
			continue
		}
		if err := loc.Click(); err == nil {
			return nil
		}
	}
	return fmt.Errorf("none of %d selectors matched a visible element: %v",
		len(selectors), selectors)
}

// fillByLabelOrTestID fills an input identified by a stable data-testid
// attribute (preferred) or its visible label (fallback).
func fillByLabelOrTestID(page playwright.Page, testID, label, value string) error {
	if testID != "" {
		byID := page.Locator(fmt.Sprintf(`[data-testid="%s"]`, testID)).First()
		if visible, _ := byID.IsVisible(); visible {
			return byID.Fill(value)
		}
	}
	if loc := page.GetByLabel(label); loc != nil {
		if err := loc.First().Fill(value); err == nil {
			return nil
		}
	}
	xp := fmt.Sprintf(`xpath=//*[normalize-space(text())="%s"]/following::input[1]`, label)
	return page.Locator(xp).First().Fill(value)
}
