package pages

import (
	"fmt"
	"strings"

	"ndm-ui-tests/config"

	"github.com/playwright-community/playwright-go"
)

// LoginPage models the NDM login screen (Keycloak-backed).
type LoginPage struct {
	page playwright.Page
}

func NewLoginPage(page playwright.Page) *LoginPage {
	return &LoginPage{page: page}
}

// Navigate opens the NDM base URL and waits for the login form to appear.
// NDM redirects to Keycloak, so we wait for any URL under the CP and for
// the username input to be visible rather than waiting for full page load.
func (p *LoginPage) Navigate() error {
	// Use a generous timeout for initial navigation — NDM + Keycloak redirect
	// can take 15-30s on first load.
	navTimeout := float64(60000)

	if _, err := p.page.Goto(config.BaseURL, playwright.PageGotoOptions{
		Timeout:   playwright.Float(navTimeout),
		WaitUntil: playwright.WaitUntilStateCommit, // just wait for first byte, not full load
	}); err != nil {
		return fmt.Errorf("navigate to %s: %w", config.BaseURL, err)
	}

	// Wait for the login form — this handles the Keycloak redirect gracefully
	_, err := p.page.WaitForSelector(
		`input[name="username"], input[type="email"], input[id="username"]`,
		playwright.PageWaitForSelectorOptions{
			Timeout: playwright.Float(navTimeout),
			State:   playwright.WaitForSelectorStateVisible,
		},
	)
	if err != nil {
		return fmt.Errorf("login form did not appear at %s: %w", p.page.URL(), err)
	}
	return nil
}

// Login fills in credentials and submits the Keycloak login form.
// After submit it waits for the NDM dashboard to load.
func (p *LoginPage) Login(email, password string) error {
	if err := p.submitCredentials(email, password); err != nil {
		return err
	}
	// Wait for NDM dashboard to appear after login.
	_, err := p.page.WaitForSelector(
		`nav, [data-testid="dashboard"], .sidebar, [class*="sidebar"], [class*="nav"]`,
		playwright.PageWaitForSelectorOptions{
			Timeout: playwright.Float(60000),
			State:   playwright.WaitForSelectorStateVisible,
		},
	)
	if err != nil {
		return fmt.Errorf("dashboard did not appear after login (current URL: %s): %w", p.page.URL(), err)
	}
	return nil
}

// LoginWithTempPassword handles the first-login flow for a freshly-created
// user. After submitting the temporary password, Keycloak shows an "Update
// Password" form. This method:
//
//  1. Fills the temp password and submits.
//  2. Detects the "Update Password" / "New Password" form.
//  3. Fills the new password + confirmation.
//  4. Submits → waits for the NDM dashboard to load.
//
// Returns the new password that was set.
func (p *LoginPage) LoginWithTempPassword(email, tempPassword, newPassword string) (string, error) {
	// 1. Submit temp credentials.
	if err := p.submitCredentials(email, tempPassword); err != nil {
		return "", fmt.Errorf("submit temp credentials: %w", err)
	}

	// Check for Keycloak error (invalid credentials / account locked).
	p.page.WaitForTimeout(1000)
	if errMsg, _ := p.page.Locator(
		`#kc-error-message, [class*="alert-error"], [class*="kc-feedback-text"]`,
	).First().InnerText(); errMsg != "" {
		return "", fmt.Errorf("Keycloak login error for %s: %s", email, errMsg)
	}

	// 2. Wait for either the dashboard or the "Update Password" form.
	//    We poll both signals separately (can't mix CSS + text= engines).
	passwordChangeDetected := false
	for elapsed := 0.0; elapsed < 15000; elapsed += 500 {
		// Dashboard loaded?
		if strings.Contains(p.page.URL(), "/home") {
			return newPassword, nil
		}
		// Password-change form visible?
		if v, _ := p.page.Locator(`input[id="password-new"]`).First().IsVisible(); v {
			passwordChangeDetected = true
			break
		}
		if v, _ := p.page.Locator(`input[name="password-new"]`).First().IsVisible(); v {
			passwordChangeDetected = true
			break
		}
		p.page.WaitForTimeout(500)
	}

	// Re-check dashboard after the loop (in case it loaded late).
	if !passwordChangeDetected && strings.Contains(p.page.URL(), "/home") {
		return newPassword, nil
	}

	// 3. We're on the Update Password page. Fill new password + confirm.
	newPwdField := p.page.Locator(
		`input[id="password-new"], input[name="password-new"]`,
	).First()
	confirmPwdField := p.page.Locator(
		`input[id="password-confirm"], input[name="password-confirm"]`,
	).First()

	if v, _ := newPwdField.IsVisible(); !v {
		return "", fmt.Errorf("neither dashboard nor Update Password form appeared (URL: %s)", p.page.URL())
	}

	if err := newPwdField.Fill(newPassword); err != nil {
		return "", fmt.Errorf("fill new password: %w", err)
	}
	if err := confirmPwdField.Fill(newPassword); err != nil {
		return "", fmt.Errorf("fill confirm password: %w", err)
	}
	if err := p.page.Locator(
		`button[type="submit"], input[type="submit"]`,
	).Click(); err != nil {
		return "", fmt.Errorf("submit new password: %w", err)
	}

	// 4. Wait for NDM dashboard.
	_, err := p.page.WaitForSelector(
		`nav, [data-testid="dashboard"], .sidebar, [class*="sidebar"]`,
		playwright.PageWaitForSelectorOptions{
			Timeout: playwright.Float(30000),
			State:   playwright.WaitForSelectorStateVisible,
		},
	)
	if err != nil {
		return "", fmt.Errorf("dashboard did not appear after password change (URL: %s): %w",
			p.page.URL(), err)
	}
	return newPassword, nil
}

// submitCredentials fills email + password and clicks the login button.
// Shared by Login() and LoginWithTempPassword().
func (p *LoginPage) submitCredentials(email, password string) error {
	if err := p.page.Locator(
		`input[name="username"], input[type="email"], input[id="username"]`,
	).Fill(email); err != nil {
		return fmt.Errorf("fill username: %w", err)
	}
	if err := p.page.Locator(
		`input[name="password"], input[type="password"], input[id="password"]`,
	).Fill(password); err != nil {
		return fmt.Errorf("fill password: %w", err)
	}
	if err := p.page.Locator(
		`button[type="submit"], input[type="submit"], button[id="kc-login"]`,
	).Click(); err != nil {
		return fmt.Errorf("click submit: %w", err)
	}
	return nil
}

