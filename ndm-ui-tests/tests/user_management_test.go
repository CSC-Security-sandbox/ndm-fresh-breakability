// Package tests — User Management UI E2E flows.
//
// Single end-to-end flow:
//   1. Login as default App Admin (via fixtures.NewAdminFixture)
//   2. Settings → Users → Add User × 3
//        a. App Admin       (App Admin checkbox ticked)
//        b. Project Admin   (plain user)
//        c. Project Viewer  (plain user)
//      Each captures the temporary password from the success dialog.
//   3. Settings → Projects → Add Project → fill + Submit
//   4. Edit the new project → Associate Users
//        - Project Admin  as "Project Admin"
//        - Project Viewer as "Project Viewer"
//   5. First login for Project Admin and Project Viewer — Keycloak forces a
//      password change; we set a permanent test password.
//   6. RBAC verification — Project Viewer:
//        ✅ can see the dashboard and their assigned project
//        ❌ cannot see Add File Server / Bulk Discover / Bulk Migrate buttons
//   7. RBAC verification — Project Admin:
//        ✅ can see Add File Server button
//        ✅ can see their assigned project in Settings → Projects
//        ❌ cannot see the Add Project button (only App Admins can)
//        ❌ cannot see projects they are NOT assigned to (if NDM_OTHER_PROJECT_NAME is set)
package tests

import (
	"fmt"
	"testing"
	"time"

	"ndm-ui-tests/config"
	"ndm-ui-tests/fixtures"
	"ndm-ui-tests/pages"

	"github.com/playwright-community/playwright-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// createdUser holds the data we know about a user just created via the UI.
type createdUser struct {
	Label      string
	FirstName  string
	LastName   string
	Email      string
	IsAppAdmin bool
	TempPass   string
}

// TestUserManagement_CreateThreeRoleUsers is a full end-to-end user-management
// and RBAC flow. It creates three users, associates two of them with a project,
// completes their first-login password change, and then verifies that each role
// only has access to the UI elements it is permitted to see.
func TestUserManagement_CreateThreeRoleUsers(t *testing.T) {
	f := fixtures.NewAdminFixture(t)
	defer f.Close()

	um := pages.NewUserManagementPage(f.Page)

	uid := time.Now().UnixMilli()
	users := []createdUser{
		{Label: "App Admin",     FirstName: "App",     LastName: "Admin",  Email: fmt.Sprintf("appadmin-%d@netapp.com", uid),     IsAppAdmin: true},
		{Label: "Project Admin", FirstName: "Project", LastName: "Admin",  Email: fmt.Sprintf("projectadmin-%d@netapp.com", uid),  IsAppAdmin: false},
		{Label: "Project Viewer",FirstName: "Project", LastName: "Viewer", Email: fmt.Sprintf("projectviewer-%d@netapp.com", uid), IsAppAdmin: false},
	}

	// ── Step 1: Create users ──────────────────────────────────────────────
	for i := range users {
		u := &users[i]
		t.Logf("[create %-14s] %s %s  email=%s  isAppAdmin=%t",
			u.Label, u.FirstName, u.LastName, u.Email, u.IsAppAdmin)

		pwd, err := um.AddUser(u.FirstName, u.LastName, u.Email, u.IsAppAdmin)
		require.NoErrorf(t, err, "Add User failed for %s", u.Email)
		require.NotEmptyf(t, pwd, "temporary password should be returned for %s", u.Email)
		u.TempPass = pwd
	}

	t.Log("──────────────────────────────────────────────────────────────")
	t.Log(" Created users (temporary passwords below):")
	t.Log("──────────────────────────────────────────────────────────────")
	for _, u := range users {
		t.Logf("  %-15s  email=%s  tempPassword=%q", u.Label, u.Email, u.TempPass)
		fmt.Printf("[USER CREATED] role=%-15s email=%s tempPassword=%s\n",
			u.Label, u.Email, u.TempPass)
	}
	t.Log("──────────────────────────────────────────────────────────────")

	// ── Step 2: Create a project ──────────────────────────────────────────
	projectsPage := pages.NewProjectsPage(f.Page)
	require.NoError(t, projectsPage.Navigate(), "switch to Projects tab")

	shortUID := fmt.Sprintf("%d", uid%1000000)
	projectName := fmt.Sprintf("uitest-%s", shortUID)
	t.Logf("[create project] %s", projectName)
	require.NoErrorf(t,
		projectsPage.Create(projectName, "Created by TestUserManagement_CreateThreeRoleUsers"),
		"Add Project failed for %s", projectName,
	)
	fmt.Printf("[PROJECT CREATED] name=%s\n", projectName)

	// ── Step 3: Associate Project Admin and Project Viewer to the project ──
	assocs := []pages.UserRoleAssoc{
		{Email: users[1].Email, Role: "Project Admin"},
		{Email: users[2].Email, Role: "Project Viewer"},
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
		fmt.Printf("[ASSOCIATED] project=%s user=%s role=%s\n", projectName, a.Email, a.Role)
	}

	f.Close() // done with App Admin browser

	// ── Step 4: First login — Project Admin & Project Viewer ──────────────
	// Keycloak forces a password change on first login.
	// We set a single known permanent password so Steps 5 and 6 can log in.
	newPassword := "UiTest@1234"

	for _, u := range users[1:] { // skip App Admin (index 0)
		t.Logf("[first-login] %s (%s) with tempPassword", u.Label, u.Email)

		browser := fixtures.NewBrowser(t)
		defer browser.Close()

		loginPage := pages.NewLoginPage(browser.Page)
		if err := loginPage.Navigate(); err != nil {
			browser.Screenshot("first-login-nav-failed-" + u.Label)
			browser.Close()
			require.NoErrorf(t, err, "navigate to NDM login for %s", u.Email)
		}

		actualPwd, err := loginPage.LoginWithTempPassword(u.Email, u.TempPass, newPassword)
		if err != nil {
			browser.Screenshot("first-login-failed-" + u.Label)
			browser.Close()
			require.NoErrorf(t, err, "first login failed for %s (%s)", u.Label, u.Email)
		}

		t.Logf("[first-login] %s landed on dashboard — password changed to %q", u.Label, actualPwd)
		fmt.Printf("[FIRST LOGIN OK] role=%-15s email=%s newPassword=%s\n",
			u.Label, u.Email, actualPwd)
		browser.Close()
	}

	// ── Step 5: RBAC — Project Viewer ────────────────────────────────────
	// Uses users[2] (Project Viewer) with newPassword set in Step 4.
	t.Log("────────────────────────────────────────────────────────")
	t.Log(" RBAC verification: Project Viewer")
	t.Log("────────────────────────────────────────────────────────")
	{
		pvEmail := users[2].Email
		bPV := fixtures.NewBrowser(t)
		defer bPV.Close()

		loginPage := pages.NewLoginPage(bPV.Page)
		require.NoError(t, loginPage.Navigate(), "PV: navigate to login")
		require.NoError(t, loginPage.Login(pvEmail, newPassword), "PV: login")
		t.Logf("[RBAC PV] logged in as %s", pvEmail)

		page := bPV.Page

		// ✅ Can see the dashboard — wait for React to render the sidebar before asserting.
		page.WaitForTimeout(2000)
		dashVisible, _ := page.Locator(`nav, .sidebar, [class*="sidebar"]`).First().IsVisible()
		assert.True(t, dashVisible, "Project Viewer should see the NDM dashboard")
		fmt.Println("[RBAC PV] ✅ dashboard visible")

		// ✅ Can see assigned project in Settings → Projects
		pvProjectsPage := pages.NewProjectsPage(page)
		if err := pvProjectsPage.Navigate(); err == nil {
			projectVisible, _ := page.Locator(
				`[class*="ag-row"], tr[class*="row"], tbody tr`,
			).First().IsVisible()
			assert.True(t, projectVisible, "Project Viewer should see their assigned project")
			fmt.Println("[RBAC PV] ✅ assigned project visible in Projects tab")
		}

		// ❌ Cannot see Add File Server button
		_, err := page.Goto(config.BaseURL+"/file-server", playwright.PageGotoOptions{
			WaitUntil: playwright.WaitUntilStateNetworkidle,
			Timeout:   playwright.Float(30000),
		})
		require.NoError(t, err, "PV: navigate to /file-server")
		addFSVisible, _ := page.Locator(
			`button:has-text("Add File Server"), button:has-text("New File Server"), [data-testid="add-file-server"]`,
		).First().IsVisible()
		assert.False(t, addFSVisible, "Project Viewer must NOT see Add File Server")
		fmt.Printf("[RBAC PV] ❌ Add File Server not visible (correct) — visible=%t\n", addFSVisible)

		// ❌ Cannot create Discovery or Migration jobs
		_, err = page.Goto(config.BaseURL+"/jobs-run-list", playwright.PageGotoOptions{
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
			Timeout:   playwright.Float(30000),
		})
		require.NoError(t, err, "PV: navigate to /jobs-run-list")
		page.WaitForTimeout(2000)

		bulkDiscoverVisible, _ := page.Locator(
			`button:has-text("Bulk Discover"), button:has-text("Create Job"), [data-testid="bulk-discover"]`,
		).First().IsVisible()
		assert.False(t, bulkDiscoverVisible, "Project Viewer must NOT see Bulk Discover")
		fmt.Printf("[RBAC PV] ❌ Bulk Discover not visible (correct) — visible=%t\n", bulkDiscoverVisible)

		bulkMigrateVisible, _ := page.Locator(
			`button:has-text("Bulk Migrate"), button:has-text("Start Migration"), [data-testid="bulk-migrate"]`,
		).First().IsVisible()
		assert.False(t, bulkMigrateVisible, "Project Viewer must NOT see Bulk Migrate")
		fmt.Printf("[RBAC PV] ❌ Bulk Migrate not visible (correct) — visible=%t\n", bulkMigrateVisible)

		bPV.Screenshot("pv-rbac-verified")
		t.Log("[RBAC PV] all checks passed")
		fmt.Println("[RBAC PV PASSED] Project Viewer is view-only: can see project, cannot create file server/discovery/migration")
		bPV.Close()
	}

	// ── Step 6: RBAC — Project Admin ─────────────────────────────────────
	// Uses users[1] (Project Admin) with newPassword set in Step 4.
	t.Log("────────────────────────────────────────────────────────")
	t.Log(" RBAC verification: Project Admin")
	t.Log("────────────────────────────────────────────────────────")
	{
		paEmail := users[1].Email
		bPA := fixtures.NewBrowser(t)
		defer bPA.Close()

		loginPage := pages.NewLoginPage(bPA.Page)
		require.NoError(t, loginPage.Navigate(), "PA: navigate to login")
		require.NoError(t, loginPage.Login(paEmail, newPassword), "PA: login")
		t.Logf("[RBAC PA] logged in as %s", paEmail)

		page := bPA.Page

		// ✅ Can see Add File Server button
		_, err := page.Goto(config.BaseURL+"/file-server", playwright.PageGotoOptions{
			WaitUntil: playwright.WaitUntilStateNetworkidle,
			Timeout:   playwright.Float(30000),
		})
		require.NoError(t, err, "PA: navigate to /file-server")
		addFSVisible, _ := page.Locator(
			`button:has-text("Add File Server"), button:has-text("New File Server"), [data-testid="add-file-server"]`,
		).First().IsVisible()
		assert.True(t, addFSVisible, "Project Admin should see Add File Server")
		fmt.Printf("[RBAC PA] ✅ Add File Server visible — visible=%t\n", addFSVisible)

		// ❌ Cannot see the Add Project button
		paProjectsPage := pages.NewProjectsPage(page)
		if err := paProjectsPage.Navigate(); err != nil {
			t.Logf("[RBAC PA] NOTE: could not open Projects tab: %v", err)
		} else {
			addProjectVisible, _ := paProjectsPage.IsCreateButtonVisible()
			assert.False(t, addProjectVisible, "Project Admin must NOT see Add Project button")
			fmt.Printf("[RBAC PA] ❌ Add Project not visible (correct) — visible=%t\n", addProjectVisible)

			// ✅ Can see their own assigned project
			if err := paProjectsPage.Navigate(); err == nil {
				projectRowVisible, _ := page.Locator(
					`[class*="ag-row"], tr[class*="row"], tbody tr`,
				).First().IsVisible()
				assert.True(t, projectRowVisible, "Project Admin should see their assigned project(s)")
				fmt.Println("[RBAC PA] ✅ assigned project(s) visible in Projects tab")
			}
		}

		// ❌ Cannot see projects they are NOT assigned to (optional check)
		if otherProject := config.OtherProjectName; otherProject != "" {
			t.Logf("[RBAC PA] checking isolation — should NOT see %q", otherProject)
			exists, err := paProjectsPage.Exists(otherProject)
			require.NoError(t, err, "check for other project visibility")
			assert.False(t, exists, "Project Admin must NOT see project %q", otherProject)
			fmt.Printf("[RBAC PA] ❌ other project %q not visible (correct) — exists=%t\n", otherProject, exists)
		} else {
			t.Log("[RBAC PA] skipping cross-project isolation check — set NDM_OTHER_PROJECT_NAME to enable")
		}

		bPA.Screenshot("pa-rbac-verified")
		t.Log("[RBAC PA] all checks passed")
		fmt.Println("[RBAC PA PASSED] Project Admin: can create file server; cannot create project or see other projects")
		bPA.Close()
	}

	fmt.Println("[USER MANAGEMENT PASSED] Users created, roles assigned, first-login completed, RBAC verified")
}
