package pages

import (
	"fmt"
	"log"
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
// NDM may redirect to Keycloak or show its own login form. A fresh Chrome
// profile can take 90-120s on the first load (redirect chain + JS bundle).
func (p *LoginPage) Navigate() error {
	// 120s timeout — first launch with a clean Chrome profile is slow.
	navTimeout := float64(120000)

	if _, err := p.page.Goto(config.BaseURL, playwright.PageGotoOptions{
		Timeout:   playwright.Float(navTimeout),
		WaitUntil: playwright.WaitUntilStateCommit,
	}); err != nil {
		return fmt.Errorf("navigate to %s: %w", config.BaseURL, err)
	}

	// Wait for any username/email input — covers Keycloak and NDM's own form.
	_, err := p.page.WaitForSelector(
		`input[name="username"], input[type="email"], input[id="username"], `+
			`input[name="email"], input[placeholder*="Email"], input[placeholder*="Username"]`,
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

// Login fills in credentials, submits the Keycloak form, and waits for
// the NDM dashboard to load. If Keycloak presents an "Update Password"
// form (common on fresh CP deployments), it automatically fills in the
// same password and submits.
func (p *LoginPage) Login(email, password string) error {
	if err := p.submitCredentials(email, password); err != nil {
		return err
	}

	log.Printf("[login] credentials submitted for %s, waiting for redirect…", email)

	// Poll for up to 30s: dashboard loaded, password-change form, or error.
	for elapsed := 0.0; elapsed < 30000; elapsed += 500 {
		url := p.page.URL()

		// NDM dashboard loaded — we're done.
		if strings.Contains(url, "/home") || strings.Contains(url, "/file-servers") {
			log.Printf("[login] dashboard reached (URL: %s)", url)
			return nil
		}

		// Keycloak "Update Password" page.
		if v, _ := p.page.Locator(`input[id="password-new"], input[name="password-new"]`).First().IsVisible(); v {
			log.Printf("[login] detected Keycloak password-change page — auto-filling same password")
			if err := p.handlePasswordChange(password); err != nil {
				return err
			}
			return p.waitForDashboard()
		}

		// Keycloak error (bad creds, locked account, etc.).
		if errMsg, _ := p.page.Locator(
			`#kc-error-message, [class*="alert-error"], [class*="kc-feedback-text"]`,
		).First().InnerText(); errMsg != "" {
			return fmt.Errorf("Keycloak error for %s: %s (URL: %s)", email, errMsg, url)
		}

		p.page.WaitForTimeout(500)
	}

	// Fallback: try the broader dashboard selector in case the URL didn't match.
	return p.waitForDashboard()
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
	if err := p.submitCredentials(email, tempPassword); err != nil {
		return "", fmt.Errorf("submit temp credentials: %w", err)
	}

	p.page.WaitForTimeout(1000)
	if errMsg, _ := p.page.Locator(
		`#kc-error-message, [class*="alert-error"], [class*="kc-feedback-text"]`,
	).First().InnerText(); errMsg != "" {
		return "", fmt.Errorf("Keycloak login error for %s: %s", email, errMsg)
	}

	for elapsed := 0.0; elapsed < 15000; elapsed += 500 {
		if strings.Contains(p.page.URL(), "/home") {
			return newPassword, nil
		}
		if v, _ := p.page.Locator(`input[id="password-new"], input[name="password-new"]`).First().IsVisible(); v {
			break
		}
		p.page.WaitForTimeout(500)
	}

	if strings.Contains(p.page.URL(), "/home") {
		return newPassword, nil
	}

	if err := p.handlePasswordChange(newPassword); err != nil {
		return "", err
	}
	if err := p.waitForDashboard(); err != nil {
		return "", err
	}
	return newPassword, nil
}

// handlePasswordChange fills the Keycloak "Update Password" form and submits.
func (p *LoginPage) handlePasswordChange(newPassword string) error {
	newPwdField := p.page.Locator(
		`input[id="password-new"], input[name="password-new"]`,
	).First()
	confirmPwdField := p.page.Locator(
		`input[id="password-confirm"], input[name="password-confirm"]`,
	).First()

	if v, _ := newPwdField.IsVisible(); !v {
		return fmt.Errorf("Update Password form not found (URL: %s)", p.page.URL())
	}

	if err := newPwdField.Fill(newPassword); err != nil {
		return fmt.Errorf("fill new password: %w", err)
	}
	if err := confirmPwdField.Fill(newPassword); err != nil {
		return fmt.Errorf("fill confirm password: %w", err)
	}
	if err := p.page.Locator(
		`button[type="submit"], input[type="submit"]`,
	).Click(); err != nil {
		return fmt.Errorf("submit new password: %w", err)
	}
	log.Printf("[login] password change submitted")
	return nil
}

// waitForDashboard waits for the NDM dashboard to load after login/password-change.
// It uses a combination of URL check and DOM selector to confirm we're on the app.
func (p *LoginPage) waitForDashboard() error {
	// First try URL-based detection (most reliable).
	for elapsed := 0.0; elapsed < 30000; elapsed += 500 {
		url := p.page.URL()
		if strings.Contains(url, "/home") || strings.Contains(url, "/file-servers") {
			log.Printf("[login] dashboard loaded (URL: %s)", url)
			return nil
		}
		// Still on Keycloak? Keep waiting.
		if strings.Contains(url, "/auth/") || strings.Contains(url, "/realms/") {
			p.page.WaitForTimeout(500)
			continue
		}
		// On NDM but not /home — also acceptable (could be a deep link).
		if !strings.Contains(url, "/auth/") {
			log.Printf("[login] left Keycloak, assuming dashboard loaded (URL: %s)", url)
			p.page.WaitForTimeout(2000)
			return nil
		}
		p.page.WaitForTimeout(500)
	}

	return fmt.Errorf("dashboard did not load within 30s (stuck at URL: %s)", p.page.URL())
}

// submitCredentials fills email + password and clicks the login button.
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

