package fixtures

import (
	"fmt"
	"testing"
	"time"

	"ndm-ui-tests/config"
	"ndm-ui-tests/pages"

	"github.com/playwright-community/playwright-go"
)

// AuthFixture embeds BrowserFixture and adds a pre-logged-in page.
type AuthFixture struct {
	*BrowserFixture
	LoginPage *pages.LoginPage
}

// NewAuthFixture creates a browser, navigates to NDM and logs in
// with the supplied credentials. Fails the test immediately on error.
//
// On a fresh CP with zero projects, the UI shows a "Create First Project"
// screen that blocks all routes. This fixture auto-creates a default
// project so subsequent navigation (file servers, discovery, etc.) works.
func NewAuthFixture(t *testing.T, email, password string) *AuthFixture {
	t.Helper()
	f := NewBrowser(t)

	loginPage := pages.NewLoginPage(f.Page)
	if err := loginPage.Navigate(); err != nil {
		f.Screenshot("login-navigate-error")
		t.Fatalf("failed to open NDM: %v", err)
	}

	if err := loginPage.Login(email, password); err != nil {
		f.Screenshot("login-error")
		t.Fatalf("login failed for %s: %v", email, err)
	}

	f.Screenshot("post-login")
	t.Logf("[auth] logged in — URL: %s", f.Page.URL())

	if err := ensureProjectExists(t, f); err != nil {
		f.Screenshot("create-first-project-error")
		t.Fatalf("failed to handle Create First Project screen: %v", err)
	}

	return &AuthFixture{BrowserFixture: f, LoginPage: loginPage}
}

// NewAdminFixture logs in as the default app admin.
func NewAdminFixture(t *testing.T) *AuthFixture {
	return NewAuthFixture(t, config.Username, config.Password)
}

// ensureProjectExists detects the "Create First Project" screen that NDM
// shows when zero projects exist (fresh CP). If detected, it creates a
// default project so the normal Layout (sidebar, routes) becomes available.
func ensureProjectExists(t *testing.T, f *BrowserFixture) error {
	t.Helper()
	page := f.Page

	// Give the page a moment to settle after login redirect.
	page.WaitForTimeout(3000)

	// Check for the "Create First Project" screen.
	// The screen shows a card with "Create A New Project" text and a
	// "Create Project" button (see CreateFirstProject.tsx / DefaultProjectScreen.tsx).
	createBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{
		Name: "Create Project",
	})
	visible, _ := createBtn.IsVisible()
	if !visible {
		t.Log("[auth] normal layout detected — no 'Create First Project' screen")
		return nil
	}

	t.Log("[auth] 'Create First Project' screen detected — auto-creating default project…")
	f.Screenshot("create-first-project-detected")

	// Click "Create Project" to reveal the form.
	if err := createBtn.Click(); err != nil {
		return fmt.Errorf("click Create Project button: %w", err)
	}
	page.WaitForTimeout(2000)
	f.Screenshot("create-first-project-form")

	// Fill the Project Name field (FormFieldInputNew with placeholder="Project Name").
	nameField := page.GetByPlaceholder("Project Name")
	if err := nameField.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(15000),
	}); err != nil {
		// Fallback: try by label.
		nameField = page.GetByLabel("Project Name")
		if err2 := nameField.WaitFor(playwright.LocatorWaitForOptions{
			State:   playwright.WaitForSelectorStateVisible,
			Timeout: playwright.Float(10000),
		}); err2 != nil {
			return fmt.Errorf("Project Name field not found: %w (also tried label: %v)", err, err2)
		}
	}

	projectName := fmt.Sprintf("e2e-default-%d", time.Now().UnixMilli())
	if err := nameField.Fill(projectName); err != nil {
		return fmt.Errorf("fill Project Name: %w", err)
	}

	// Submit the form.
	submitBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{
		Name: "Create",
	})
	if err := submitBtn.Click(); err != nil {
		return fmt.Errorf("click Create: %w", err)
	}

	// Wait for the normal layout to appear (sidebar / nav).
	_, err := page.WaitForSelector(
		`nav, [class*="sidebar"], [class*="side-bar"], [data-testid="sidebar"]`,
		playwright.PageWaitForSelectorOptions{
			State:   playwright.WaitForSelectorStateVisible,
			Timeout: playwright.Float(30000),
		},
	)
	if err != nil {
		return fmt.Errorf("normal layout did not appear after project creation (URL: %s): %w",
			page.URL(), err)
	}

	t.Logf("[auth] project %q created — normal layout loaded (URL: %s)", projectName, page.URL())
	f.Screenshot("post-project-creation")
	return nil
}

