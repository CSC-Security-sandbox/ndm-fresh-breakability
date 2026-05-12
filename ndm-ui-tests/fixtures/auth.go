package fixtures

import (
	"testing"

	"ndm-ui-tests/config"
	"ndm-ui-tests/pages"
)

// AuthFixture embeds BrowserFixture and adds a pre-logged-in page.
type AuthFixture struct {
	*BrowserFixture
	LoginPage *pages.LoginPage
}

// NewAuthFixture creates a browser, navigates to NDM and logs in
// with the supplied credentials. Fails the test immediately on error.
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

	return &AuthFixture{BrowserFixture: f, LoginPage: loginPage}
}

// NewAdminFixture logs in as the default app admin.
func NewAdminFixture(t *testing.T) *AuthFixture {
	return NewAuthFixture(t, config.Username, config.Password)
}

