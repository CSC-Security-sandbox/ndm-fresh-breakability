// Package tests — User Management UI E2E flows.
//
// Focused smoke flow:
//   1. Login as default App Admin (handled by fixtures.NewAdminFixture)
//   2. Settings → Users → Add User × 3
//        a. App Admin       (App Admin checkbox ticked)
//        b. Project Admin   (plain)
//        c. Project Viewer  (plain)
//      Each captures the temporary password from the success dialog.
//   3. Settings → Projects → Add Project → fill + Submit
//   4. Edit the new project → Associate Users
//        - projectadmin user as "Project Admin"
//        - projectviewer user as "Project Viewer"
//      → + Add for each → Submit once.
package tests

import (
	"fmt"
	"testing"
	"time"

	"ndm-ui-tests/fixtures"
	"ndm-ui-tests/pages"

	"github.com/stretchr/testify/require"
)

// createdUser holds the data we know about a user just created via the UI.
type createdUser struct {
	Label     string // friendly name for logs: "App Admin", "Project Admin", "Project Viewer"
	FirstName string
	LastName  string
	Email     string
	IsAppAdmin bool
	TempPass  string
}

// TestUserManagement_CreateThreeRoleUsers creates three users via the
// Settings → Users → Add User flow and prints each temporary password.
//
// NOTE: project-scoped roles ("Project Admin" / "Project Viewer") can only
// be assigned through Edit Project → Associate Users; the Add User form
// only exposes the "App Admin" toggle. So users 2 and 3 are created
// plain here — their role assignment happens in the "Associate Users"
// step later in this same test.
func TestUserManagement_CreateThreeRoleUsers(t *testing.T) {
	f := fixtures.NewAdminFixture(t)
	// Close is idempotent — this defer is a safety net in case the test
	// fails before the explicit f.Close() call further down.
	defer f.Close()

	um := pages.NewUserManagementPage(f.Page)

	// Unix-ms suffix keeps each run idempotent — emails are unique so
	// the test can be re-run without manually deleting prior users.
	uid := time.Now().UnixMilli()
	users := []createdUser{
		{
			Label:      "App Admin",
			FirstName:  "App",
			LastName:   "Admin",
			Email:      fmt.Sprintf("appadmin-%d@netapp.com", uid),
			IsAppAdmin: true,
		},
		{
			Label:      "Project Admin",
			FirstName:  "Project",
			LastName:   "Admin",
			Email:      fmt.Sprintf("projectadmin-%d@netapp.com", uid),
			IsAppAdmin: false,
		},
		{
			Label:      "Project Viewer",
			FirstName:  "Project",
			LastName:   "Viewer",
			Email:      fmt.Sprintf("projectviewer-%d@netapp.com", uid),
			IsAppAdmin: false,
		},
	}

	for i := range users {
		u := &users[i]
		t.Logf("[create %-14s] %s %s  email=%s  isAppAdmin=%t",
			u.Label, u.FirstName, u.LastName, u.Email, u.IsAppAdmin)

		pwd, err := um.AddUser(u.FirstName, u.LastName, u.Email, u.IsAppAdmin)
		require.NoErrorf(t, err, "Add User failed for %s", u.Email)
		require.NotEmptyf(t, pwd,
			"temporary password should be returned for %s", u.Email)
		u.TempPass = pwd
	}

	// Print captured credentials so they can be reused by manual / future tests.
	t.Log("──────────────────────────────────────────────────────────────")
	t.Log(" Created users (temporary passwords below):")
	t.Log("──────────────────────────────────────────────────────────────")
	for _, u := range users {
		t.Logf("  %-15s  email=%s  tempPassword=%q", u.Label, u.Email, u.TempPass)
		// Also emit on stdout so plain `go test` (no -v) picks it up via grep.
		fmt.Printf("[USER CREATED] role=%-15s email=%s tempPassword=%s\n",
			u.Label, u.Email, u.TempPass)
	}
	t.Log("──────────────────────────────────────────────────────────────")

	// ─────────────────────────────────────────────────────────────────
	// Create a project (Settings → Projects → Add Project).
	// The drawer is already open after the user-creation loop, so
	// ProjectsPage.Navigate is a no-op — it just switches the active tab.
	// ─────────────────────────────────────────────────────────────────
	projectsPage := pages.NewProjectsPage(f.Page)
	require.NoError(t, projectsPage.Navigate(), "switch to Projects tab")

	// Keep the project name SHORT — the Projects table truncates long names
	// and Playwright can't match text that's not in the DOM. Use last 6
	// digits of the timestamp for uniqueness.
	shortUID := fmt.Sprintf("%d", uid%1000000)
	projectName := fmt.Sprintf("uitest-%s", shortUID)
	t.Logf("[create project] %s", projectName)
	require.NoErrorf(t,
		projectsPage.Create(projectName, "Created by TestUserManagement_CreateThreeRoleUsers"),
		"Add Project failed for %s", projectName,
	)
	fmt.Printf("[PROJECT CREATED] name=%s\n", projectName)

	// ─────────────────────────────────────────────────────────────────
	// Edit the project and associate two users:
	//   1. Project Admin   → Project Admin role
	//   2. Project Viewer  → Project Viewer role
	// The App Admin user already has the App-Admin role assigned at
	// creation, so no project association is needed for them.
	// ─────────────────────────────────────────────────────────────────
	assocs := []pages.UserRoleAssoc{
		{Email: users[1].Email, Role: "Project Admin"},  // projectadmin-<uid>
		{Email: users[2].Email, Role: "Project Viewer"}, // projectviewer-<uid>
	}
	t.Logf("[associate] %s ← %d users", projectName, len(assocs))
	for _, a := range assocs {
		t.Logf("  • %s as %s", a.Email, a.Role)
	}
	require.NoErrorf(t,
		um.AssignUsersToProject(projectName, assocs),
		"failed to associate users on project %s", projectName,
	)
	for _, a := range assocs {
		fmt.Printf("[ASSOCIATED] project=%s user=%s role=%s\n",
			projectName, a.Email, a.Role)
	}

	// Close the App Admin browser — we're done with admin tasks.
	f.Close()

	// ─────────────────────────────────────────────────────────────────
	// Login as each non-App-Admin user with their temporary password.
	// Keycloak forces a password change on first login. The flow:
	//   1. Open new browser → navigate to NDM login
	//   2. Enter temp password → submit
	//   3. "Update Password" form appears → fill new + confirm → submit
	//   4. Lands on NDM home page → dashboard visible → success
	// ─────────────────────────────────────────────────────────────────
	newPassword := "UiTest@1234" // the permanent password we set for test users

	for _, u := range users[1:] { // skip App Admin (index 0)
		t.Logf("[first-login] %s (%s) with tempPassword", u.Label, u.Email)

		browser := fixtures.NewBrowser(t)
		defer browser.Close() // safety net — idempotent

		loginPage := pages.NewLoginPage(browser.Page)

		if err := loginPage.Navigate(); err != nil {
			browser.Screenshot("first-login-nav-failed-" + u.Label)
			browser.Close()
			require.NoErrorf(t, err, "navigate to NDM login for %s", u.Email)
		}

		actualPassword, err := loginPage.LoginWithTempPassword(u.Email, u.TempPass, newPassword)
		if err != nil {
			browser.Screenshot("first-login-failed-" + u.Label)
			browser.Close()
			require.NoErrorf(t, err, "first login failed for %s (%s)", u.Label, u.Email)
		}

		t.Logf("[first-login] %s landed on dashboard — password changed to %q", u.Label, actualPassword)
		fmt.Printf("[FIRST LOGIN OK] role=%-15s email=%s newPassword=%s\n",
			u.Label, u.Email, actualPassword)

		browser.Close()
	}
}
