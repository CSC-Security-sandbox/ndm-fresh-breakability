package pages

import (
	"fmt"
	"os"
	"strings"
	"time"

	"ndm-ui-tests/config"

	"github.com/playwright-community/playwright-go"
)

// UserManagementPage models the NDM Settings → Users / Projects screens
// as seen in the 2026.05 build. Layout reference:
//
//   ┌─ Settings ───────────────────────────────────────────────┐
//   │  Users  Projects  SMTP                                   │
//   │  ─────                                                   │
//   │  Users (N)                              [Add User]       │
//   │  Name | Role | Email | Created | Status | ⋯              │
//   └──────────────────────────────────────────────────────────┘
//
// The Add User flow opens a modal with First Name / Last Name / Email
// fields and an "App Admin" checkbox. On submit, a "User Added
// Successfully" modal returns a temporary password.
//
// Project-scoped role assignment is done from Settings → Projects → ⋯ →
// Edit Project → Associate Users (User + Role + "+ Add" + Submit).
type UserManagementPage struct {
	page playwright.Page
}

func NewUserManagementPage(page playwright.Page) *UserManagementPage {
	return &UserManagementPage{page: page}
}

// ── Navigation ───────────────────────────────────────────────────────────────

// GoToUsersTab opens the Settings drawer and clicks the Users tab.
func (p *UserManagementPage) GoToUsersTab() error {
	if err := openSettingsDrawer(p.page); err != nil {
		return err
	}
	if err := p.clickTab("Users"); err != nil {
		return err
	}
	return p.waitForVisible(`[data-testid="add-user"], button:has-text("Add User")`, 30000)
}

// GoToProjectsTab opens the Settings drawer and clicks the Projects tab.
func (p *UserManagementPage) GoToProjectsTab() error {
	if err := openSettingsDrawer(p.page); err != nil {
		return err
	}
	if err := p.clickTab("Projects"); err != nil {
		return err
	}
	return p.waitForVisible(`[data-testid="add-project"], button:has-text("Add Project")`, 30000)
}

// clickTab delegates to the shared settings-tab helper.
func (p *UserManagementPage) clickTab(name string) error {
	return clickSettingsTab(p.page, name)
}

// ── Add User ─────────────────────────────────────────────────────────────────

// AddUser opens the Add User modal, fills the form, submits, captures the
// temporary password from the success dialog, closes it, and returns the
// password. Pass isAppAdmin=true to tick the "App Admin" checkbox at create.
func (p *UserManagementPage) AddUser(firstName, lastName, email string, isAppAdmin bool) (string, error) {
	if err := p.GoToUsersTab(); err != nil {
		return "", err
	}

	if err := p.page.Locator(`button:has-text("Add User")`).Click(); err != nil {
		return "", fmt.Errorf("click Add User: %w", err)
	}

	// Wait for modal
	if err := p.waitForVisible(`text=Add User >> .. >> text=First Name`, 10000); err != nil {
		// Some renderings don't expose the heading via chaining — fall back
		_ = p.waitForVisible(`text=First Name`, 10000)
	}

	if err := fillByLabelOrTestID(p.page, "first-name", "First Name", firstName); err != nil {
		return "", err
	}
	if err := fillByLabelOrTestID(p.page, "last-name", "Last Name", lastName); err != nil {
		return "", err
	}
	if err := fillByLabelOrTestID(p.page, "email", "Email", email); err != nil {
		return "", err
	}

	if isAppAdmin {
		if err := p.page.Locator(
			`[data-testid="is-app-admin"], label:has-text("App Admin")`).First().Click(); err != nil {
			return "", fmt.Errorf("toggle App Admin: %w", err)
		}
	}

	if err := p.page.Locator(
		`[data-testid="submit-user"], button:has-text("Submit")`).Click(); err != nil {
		return "", fmt.Errorf("click Submit: %w", err)
	}

	// Wait for the success dialog.
	successSel := []string{
		`[data-testid="temporary-password-heading"]`,
		`text=User Added Successfully`,
		`text=Password Reset Successfully`,
	}
	gotSuccess := false
	for _, sel := range successSel {
		if err := p.waitForVisible(sel, 5000); err == nil {
			gotSuccess = true
			break
		}
	}
	if !gotSuccess {
		return "", fmt.Errorf("success dialog did not appear")
	}

	// Read the masked temporary password input.
	pwInput := p.page.Locator(`[data-testid="temporary-password"]`).First()
	if visible, _ := pwInput.IsVisible(); !visible {
		// Fallback when data-testid isn't on the build yet
		pwInput = p.page.Locator(`input[name="password"]`).Last()
	}
	pw, err := pwInput.InputValue()
	if err != nil {
		return "", fmt.Errorf("read temporary password: %w", err)
	}

	if err := p.closeSuccessDialog(); err != nil {
		return pw, err
	}
	return strings.TrimSpace(pw), nil
}

func (p *UserManagementPage) closeSuccessDialog() error {
	// The Close button is the PRIMARY styled button at the bottom of the
	// "User Added Successfully" card. It does NOT have aria-label="Close"
	// (that's the search-clear ✕). We distinguish by:
	//   - no aria-label attribute
	//   - visible text is exactly "Close"
	//
	// The selector `button:not([aria-label]):has-text("Close")` targets it
	// perfectly and avoids the search-clear icon button.
	btn := p.page.Locator(`button:not([aria-label]):has-text("Close")`).First()
	return btn.Click(playwright.LocatorClickOptions{
		Timeout: playwright.Float(5000),
	})
}

// ── Assign role to a user via Edit Project → Associate Users ────────────────

// UserRoleAssoc describes one row to add in the Associate Users table.
type UserRoleAssoc struct {
	Email string // user's email address
	Role  string // e.g. "Project Admin" / "Project Viewer"
}

// AssignUserToProject is a convenience wrapper around AssignUsersToProject
// for the single-user case. It opens Edit Project, adds the user with the
// given role and submits.
func (p *UserManagementPage) AssignUserToProject(projectName, userEmail, roleName string) error {
	return p.AssignUsersToProject(projectName, []UserRoleAssoc{{Email: userEmail, Role: roleName}})
}

// AssignUsersToProject opens the Edit Project dialog for projectName, adds
// every (user, role) pair to the Associate Users table by clicking + Add
// after each pair, then submits the form once at the end.
//
// This mirrors the manual flow visible in the UI screen recording:
//
//	1. ⋯ menu → Edit Project
//	2. Select User → Select Role → + Add   (repeat for each user)
//	3. Submit
func (p *UserManagementPage) AssignUsersToProject(projectName string, assocs []UserRoleAssoc) error {
	if len(assocs) == 0 {
		return fmt.Errorf("no user/role pairs supplied")
	}

	// 1. Open the Edit Project dialog for projectName.
	if err := p.openEditProject(projectName); err != nil {
		return err
	}

	// 2. Add each user/role pair via the dropdowns + "+ Add".
	for i, a := range assocs {
		if err := p.addAssociation(a.Email, a.Role); err != nil {
			return fmt.Errorf("association #%d (%s as %s): %w", i+1, a.Email, a.Role, err)
		}
	}

	// 3. Submit the Edit Project form once.
	if err := p.page.Locator(
		`[data-testid="submit-project"], button:has-text("Submit")`).Last().Click(); err != nil {
		return fmt.Errorf("click Submit on Edit Project: %w", err)
	}

	// After submit the dialog closes and the Projects list reappears.
	return p.waitForVisible(`[data-testid="add-project"], button:has-text("Add Project")`, 30000)
}

// openEditProject navigates to the Projects tab and opens Edit Project
// for the row matching projectName.
//
// Because the project list is paginated (10 rows per page) and this test
// creates many projects across runs, the newly created project may be on
// page 2+. We handle this by:
//   1. Sorting by "Created On" descending (newest first) — the column
//      header is clicked until the arrow points down.
//   2. Then looking for the project row on page 1.
//   3. If still not visible, paginate forward until we find it.
func (p *UserManagementPage) openEditProject(projectName string) error {
	if err := p.GoToProjectsTab(); err != nil {
		return err
	}

	// Use the table's search/filter to jump directly to the project
	// instead of sorting + paginating (which is slow with many projects).
	searchBtn := p.page.Locator(`[data-testid="search"], [aria-label="Search"], button:has(svg)`).
		Locator("xpath=ancestor-or-self::*[contains(@class,'Search') or @aria-label='Search']").First()

	// The table has a search icon (magnifying glass) next to "Add Project".
	// Click it to reveal the search input, then type the project name.
	searchIcon := p.page.Locator(
		`[data-testid="search-button"], [aria-label*="search" i], [aria-label*="Search"]`,
	).First()
	if visible, _ := searchIcon.IsVisible(); visible {
		_ = searchIcon.Click()
		p.page.WaitForTimeout(300)
	}
	_ = searchBtn // suppress unused

	// Try to find and fill the search input
	searchInput := p.page.Locator(
		`input[placeholder*="Search"], input[placeholder*="search"], input[type="search"], [data-testid="search-input"]`,
	).First()
	if visible, _ := searchInput.IsVisible(); visible {
		_ = searchInput.Fill(projectName)
		p.page.WaitForTimeout(500) // let the filter apply
	}

	// After search, the table shows only the matching project.
	// The ⋯ button is the three-dot icon at the far right of the data row.
	//
	// From the debug screenshot we know the page structure:
	//   - Search input (with ✕ clear button + ↻ refresh button)
	//   - "Add Project" button
	//   - Header row (Name | Description | Created On | Created By)
	//   - ONE data row: "uitest-648891 | ... | ... | si82974@... | ⋯"
	//
	// The ⋯ is the ONLY button whose text content is "⋯" or "..." or
	// is completely empty AND sits inside the data area (below the header).
	// Most reliably: it's a button whose accessible name contains "action"
	// OR we can find it by locating the project name text and going to the
	// nearest sibling button.
	p.page.WaitForTimeout(800)

	// Approach: find the element containing the project name text inside
	// the table, then look for the ⋯ button in the same row-container.
	// The bxp table renders each row as a <div> with display:contents or
	// similar — the ⋯ button is a sibling or cousin of the name cell.
	menuBtn := p.page.Locator(fmt.Sprintf(
		`xpath=//*[contains(text(), "%s")]/ancestor::*[contains(@class, "row") or contains(@class, "Row") or self::tr][1]//button[contains(@class, "icon") or @variant="icon"]`,
		projectName,
	)).First()

	if v, _ := menuBtn.IsVisible(); !v {
		// Fallback: the text might be in a <td> or <div> inside a row.
		// Go broader: find the text, walk up to the nearest parent that
		// also contains a button with an SVG.
		menuBtn = p.page.Locator(fmt.Sprintf(
			`xpath=//*[contains(text(), "%s")]/ancestor::*[.//button[.//svg]][1]//button[.//svg][last()]`,
			projectName,
		)).First()
	}

	if v, _ := menuBtn.IsVisible(); !v {
		// Last resort: just click the ⋯ character if it's rendered as text
		menuBtn = p.page.Locator(`text=⋯, text=...`).First()
	}

	if v, _ := menuBtn.IsVisible(); !v {
		_ = os.MkdirAll(config.ScreenshotDir, 0o755)
		_, _ = p.page.Screenshot(playwright.PageScreenshotOptions{
			Path:     playwright.String(config.ScreenshotDir + "/no-menu-btn.png"),
			FullPage: playwright.Bool(true),
		})
		return fmt.Errorf("project %q found via search but ⋯ button not visible", projectName)
	}

	fmt.Printf("[openEditProject] clicking ⋯ button\n")
	_ = menuBtn.Hover()
	p.page.WaitForTimeout(300)
	if err := menuBtn.Click(playwright.LocatorClickOptions{
		Force:   playwright.Bool(true),
		Timeout: playwright.Float(5000),
	}); err != nil {
		return fmt.Errorf("open row menu for project %q: %w", projectName, err)
	}

	if err := clickAny(p.page,
		`[data-testid="edit-project"]`,
		`text=Edit Project`,
	); err != nil {
		return fmt.Errorf("click Edit Project: %w", err)
	}

	if err := p.waitForVisible(`text=Associate Users`, 30000); err != nil {
		return fmt.Errorf("Associate Users section did not appear: %w", err)
	}
	return nil
}

// addAssociation fills the User + Role combo-boxes inside an already-open
// Edit Project dialog and clicks "+ Add" to promote the pair into the
// table below. The form is NOT submitted by this method.
func (p *UserManagementPage) addAssociation(userEmail, roleName string) error {
	fmt.Printf("[addAssociation] user=%s role=%s\n", userEmail, roleName)

	// Guard: verify the Edit Project form is still open before each step.
	// If it isn't, fail loudly rather than time out on a phantom click.
	formStillOpen := func(checkpoint string) error {
		v, _ := p.page.Locator(`text=Associate Users`).First().IsVisible()
		if !v {
			return fmt.Errorf("Edit Project dialog closed unexpectedly at %s", checkpoint)
		}
		return nil
	}
	if err := formStillOpen("start"); err != nil {
		return err
	}

	if err := p.selectComboValue("User", userEmail); err != nil {
		return fmt.Errorf("select user %q: %w", userEmail, err)
	}
	if err := formStillOpen("after user select"); err != nil {
		return err
	}

	if err := p.selectComboValue("Role", roleName); err != nil {
		return fmt.Errorf("select role %q: %w", roleName, err)
	}
	if err := formStillOpen("after role select"); err != nil {
		return err
	}

	// Scope to the Edit Project dialog and click the enabled "Add" button
	// whose visible text is exactly "Add" (excludes "Add User" / "Add Project").
	// Click the "+ Add" button. It's the button with text "Add" that
	// sits after "Associate Users" heading. We use XPath to anchor on
	// the heading and find the first following button with "Add" text.
	fmt.Printf("[addAssociation] clicking + Add button\n")
	addBtn := p.page.Locator(
		`xpath=//*[normalize-space(text())="Associate Users"]` +
			`/following::button[.//text()[normalize-space()="Add"]][1]`,
	).First()
	if v, _ := addBtn.IsVisible(); !v {
		addBtn = p.page.Locator(`[data-testid="associate-add"]`).First()
	}
	if err := addBtn.Click(playwright.LocatorClickOptions{
		Timeout: playwright.Float(5000),
	}); err != nil {
		return fmt.Errorf("click + Add: %w", err)
	}

	fmt.Printf("[addAssociation] + Add clicked, waiting for row\n")
	p.page.WaitForTimeout(500)

	// Confirm the association row appeared. The bxp SubTable may use
	// <div>s not <tr>s, so just check if the user email is visible
	// somewhere in the associations area.
	userVisible, _ := p.page.GetByText(userEmail, playwright.PageGetByTextOptions{
		Exact: playwright.Bool(false),
	}).First().IsVisible()
	if !userVisible {
		return fmt.Errorf("association row for %s did not appear after clicking + Add", userEmail)
	}
	fmt.Printf("[addAssociation] OK user=%s role=%s\n", userEmail, roleName)
	return nil
}

// selectComboValue picks `value` from the combobox identified by `label`.
//
// Verifies each step:
//
//  1. Click the labelled field → wait for the popup's Search input.
//  2. Fill (NOT type into focus) the Search input explicitly → wait for
//     the matching option row to render.
//  3. Click the option whose visible text equals `value`, scoped to
//     the popup (not the field that's already showing the value).
//
// We never press Enter while a search input is focused — that auto-
// submits the surrounding Edit Project form and closes the dialog.
// selectComboValue picks `value` from the Associate Users combobox
// identified by `label` ("User" or "Role").
//
// The NDM source wraps each FormFieldSelect in a <Box> with:
//   - id="associate-user-select"  (for the User field)
//   - id="associate-role-select"  (for the Role field)
//
// We scope all interactions inside that container so we can't
// accidentally interact with elements outside the dropdown.
// selectComboValue picks `value` from the Associate Users combobox
// identified by `label` ("User" or "Role").
//
// The approach is dead simple and works on the current deployed build
// without any data-testid changes:
//
//  1. Find the label text ("User" or "Role") on the page.
//  2. Click the "Select..." placeholder immediately below it.
//  3. If a Search input appears, type the value to filter.
//  4. Click the matching option text.
func (p *UserManagementPage) selectComboValue(label, value string) error {
	fmt.Printf("[selectComboValue] label=%q value=%q\n", label, value)

	// 1. Find the label, then click the "Select..." placeholder next to it
	//    to open the dropdown. The "Select..." is the first sibling-or-
	//    descendant placeholder after the label text.
	selectPlaceholder := p.page.Locator(fmt.Sprintf(
		`xpath=//*[normalize-space(text())=%q]`+
			`/following::*[contains(text(), "Select")][1]`,
		label,
	)).First()

	if v, _ := selectPlaceholder.IsVisible(); !v {
		// Fallback: try data-testid wrappers (available after NDM rebuild).
		wrapperID := map[string]string{
			"User": "associate-user-select",
			"Role": "associate-role-select",
		}[label]
		if wrapperID != "" {
			selectPlaceholder = p.page.Locator(
				fmt.Sprintf(`#%s, [data-testid="%s"]`, wrapperID, wrapperID),
			).First()
		}
	}

	if err := selectPlaceholder.Click(playwright.LocatorClickOptions{
		Timeout: playwright.Float(5000),
	}); err != nil {
		return fmt.Errorf("open %q dropdown: %w", label, err)
	}

	// 2. If a Search input appeared (User dropdown is searchable), type to filter.
	p.page.WaitForTimeout(300)
	search := p.page.Locator(`input[placeholder="Search"]`).First()
	if v, _ := search.IsVisible(); v {
		_ = search.Fill(value)
		p.page.WaitForTimeout(400)
	}

	// 3. Click the matching option.
	option := p.page.GetByText(value, playwright.PageGetByTextOptions{
		Exact: playwright.Bool(true),
	}).First()
	if err := option.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(5000),
	}); err != nil {
		return fmt.Errorf("option %q not visible in %q dropdown: %w", value, label, err)
	}
	if err := option.Click(); err != nil {
		return fmt.Errorf("click %q in %q dropdown: %w", value, label, err)
	}

	p.page.WaitForTimeout(200)
	return nil
}

// ── Lookups ──────────────────────────────────────────────────────────────────

// UserExists returns true if the user's email appears in the Users tab.
func (p *UserManagementPage) UserExists(email string) (bool, error) {
	if err := p.GoToUsersTab(); err != nil {
		return false, err
	}
	return p.page.Locator(fmt.Sprintf(`tr:has-text("%s")`, email)).First().IsVisible()
}

// GetUserRole returns the value of the Role column for the row whose Email
// matches. Empty string if not found.
func (p *UserManagementPage) GetUserRole(email string) (string, error) {
	if err := p.GoToUsersTab(); err != nil {
		return "", err
	}
	row := p.page.Locator(fmt.Sprintf(`tr:has-text("%s")`, email)).First()
	// Role is the second column (index 1 after Name)
	role, err := row.Locator(`td`).Nth(1).InnerText()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(role), nil
}

// ── helpers ──────────────────────────────────────────────────────────────────

func (p *UserManagementPage) fillByLabel(label, value string) error {
	// Use shared helper that also honours data-testid attributes.
	return fillByLabelOrTestID(p.page, "", label, value)
}

func (p *UserManagementPage) waitForVisible(selector string, timeoutMs float64) error {
	_, err := p.page.WaitForSelector(selector, playwright.PageWaitForSelectorOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(timeoutMs),
	})
	if err != nil {
		return fmt.Errorf("waiting for %q: %w", selector, err)
	}
	// Tiny stabilising pause for animations to settle
	time.Sleep(150 * time.Millisecond)
	return nil
}
