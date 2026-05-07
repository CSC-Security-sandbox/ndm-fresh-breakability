package pwutils

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/playwright-community/playwright-go"
)

const StorageStatePath = "tests/.auth/user.json"

func Authenticate(browser playwright.Browser, cfg Config) error {
	log.Println("[auth] Starting Keycloak authentication...")

	user := cfg.User
	if user == "" {
		user = "admin@datamigrator.local"
	}
	pass := cfg.Password
	if pass == "" {
		pass = "welcome"
	}

	const maxRetries = 3
	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		log.Printf("[auth] Attempt %d/%d", attempt, maxRetries)
		err := doAuthenticate(browser, cfg.BaseURL, user, pass)
		if err == nil {
			log.Println("[auth] Authentication successful")
			return nil
		}
		lastErr = err
		log.Printf("[auth] Attempt %d failed: %v", attempt, err)
		if attempt < maxRetries {
			SleepSec(5)
		}
	}
	return fmt.Errorf("authentication failed after %d attempts: %w", maxRetries, lastErr)
}

func doAuthenticate(browser playwright.Browser, baseURL, user, pass string) error {
	ctx, err := browser.NewContext(playwright.BrowserNewContextOptions{
		IgnoreHttpsErrors: playwright.Bool(true),
	})
	if err != nil {
		return fmt.Errorf("new context: %w", err)
	}
	defer ctx.Close()

	page, err := ctx.NewPage()
	if err != nil {
		return fmt.Errorf("new page: %w", err)
	}

	if _, err = page.Goto(baseURL, playwright.PageGotoOptions{
		Timeout:   playwright.Float(90000),
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
	}); err != nil {
		return fmt.Errorf("goto base url: %w", err)
	}

	if err = ExpectVisible(page.Locator("#username"), 60000); err != nil {
		return fmt.Errorf("username field not visible: %w", err)
	}

	_ = page.Locator("#username").Fill(user)
	_ = page.Locator("#password").Fill(pass)
	_ = page.Locator("#kc-login").Click()

	if err = page.WaitForURL("**/home", playwright.PageWaitForURLOptions{
		Timeout: playwright.Float(60000),
	}); err != nil {
		return fmt.Errorf("wait for home: %w", err)
	}
	if err = ExpectVisible(page.GetByRole("heading", playwright.PageGetByRoleOptions{Name: "Home"}), 30000); err != nil {
		return fmt.Errorf("home heading: %w", err)
	}

	_ = os.MkdirAll(filepath.Dir(StorageStatePath), 0o755)
	if _, err = ctx.StorageState(StorageStatePath); err != nil {
		return fmt.Errorf("save storage state: %w", err)
	}
	return nil
}

func NewAuthPage(browser playwright.Browser) (playwright.Page, playwright.BrowserContext, error) {
	ctx, err := browser.NewContext(playwright.BrowserNewContextOptions{
		StorageStatePath:  playwright.String(StorageStatePath),
		IgnoreHttpsErrors: playwright.Bool(true),
	})
	if err != nil {
		return nil, nil, err
	}
	page, err := ctx.NewPage()
	if err != nil {
		return nil, nil, err
	}
	return page, ctx, nil
}
