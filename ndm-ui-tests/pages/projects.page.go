package pages

import (
	"fmt"
	"log"
	"strings"

	"github.com/playwright-community/playwright-go"
)

// SwitchToProject uses the header project-switcher dropdown to change the
// active project. The dropdown is triggered by clicking the "Project" area
// in the top-right header bar. A right-side panel appears with a search
// box, radio-button list, and Switch/Cancel buttons.
func SwitchToProject(page playwright.Page, projectName string) error {
	log.Printf("[SwitchToProject] switching to project %q", projectName)

	// 1. Open the project switcher panel by clicking the "Project" area.
	headerTriggers := []string{
		`[data-testid="project-switcher"]`,
		`[data-testid="project-dropdown"]`,
		`header >> text=Project`,
		`text=Project`,
	}
	clicked := false
	for _, sel := range headerTriggers {
		loc := page.Locator(sel).First()
		if visible, _ := loc.IsVisible(); !visible {
			continue
		}
		if err := loc.Click(); err == nil {
			clicked = true
			break
		}
	}
	if !clicked {
		return fmt.Errorf("could not click project switcher trigger")
	}

	page.WaitForTimeout(2000)

	// 2. Wait for the panel to appear (has "Search Projects" placeholder or "Switch" button).
	switchBtn := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Switch"})
	if err := switchBtn.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(10000),
	}); err != nil {
		return fmt.Errorf("project switcher panel did not open: %w", err)
	}

	// 3. Type the project name in the search box to filter the list.
	searchBox := page.GetByPlaceholder("Search Projects")
	if visible, _ := searchBox.IsVisible(); visible {
		_ = searchBox.Fill(projectName)
		page.WaitForTimeout(1500)
	}

	// 4. Click the radio button / row for the target project.
	projectRow := page.Locator(fmt.Sprintf(`text=%s`, projectName)).First()
	if err := projectRow.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(10000),
	}); err != nil {
		return fmt.Errorf("project %q not found in switcher list: %w", projectName, err)
	}
	if err := projectRow.Click(); err != nil {
		return fmt.Errorf("click project %q in list: %w", projectName, err)
	}
	page.WaitForTimeout(500)

	// 5. Click "Switch".
	if err := switchBtn.Click(); err != nil {
		return fmt.Errorf("click Switch button: %w", err)
	}

	// 6. Wait for the panel to close and the page to settle.
	page.WaitForTimeout(3000)
	log.Printf("[SwitchToProject] switched to project %q", projectName)
	return nil
}

// ProjectsPage models the NDM Settings → Projects tab.
//
// Real layout (NDM 2026.05 build, confirmed from screenshots):
//   - URL:        <base>/settings  (Projects is a TAB, not its own route)
//   - Header:     Settings | Users | Projects | SMTP
//   - List:       Name | Description | Created On (UTC) | Created By | ⋯
//   - Top-right:  [ Add Project ] button (blue)
//   - Row menu:   ⋯ → "Edit Project"
//
// Selector strategy: prefer stable data-testid attributes (NDM can add
// these in the React source), fall back to visible text. This makes the
// tests survive copy-changes while still working today.
type ProjectsPage struct {
	page playwright.Page
}

func NewProjectsPage(page playwright.Page) *ProjectsPage {
	return &ProjectsPage{page: page}
}

// Navigate opens the Settings drawer and switches to the Projects tab.
func (p *ProjectsPage) Navigate() error {
	if err := openSettingsDrawer(p.page); err != nil {
		return err
	}
	if err := clickSettingsTab(p.page, "Projects"); err != nil {
		return err
	}
	_, err := p.page.WaitForSelector(
		`[data-testid="add-project"], button:has-text("Add Project")`,
		playwright.PageWaitForSelectorOptions{
			State:   playwright.WaitForSelectorStateVisible,
			Timeout: playwright.Float(30000),
		})
	return err
}

// Create opens the Add Project dialog, fills name + description and submits.
//
// Detection of "success" is by form closure (the "Add Project" button
// reappears in the toolbar) rather than the new project's row showing up
// — projects can land on page 2+ when the list is large, and waiting for
// the row would time out unnecessarily.
func (p *ProjectsPage) Create(name, description string) error {
	if err := p.page.Locator(
		`[data-testid="add-project"], button:has-text("Add Project")`).First().Click(); err != nil {
		return fmt.Errorf("click Add Project: %w", err)
	}

	// Wait for the create form to render.
	if _, err := p.page.WaitForSelector(
		`[data-testid="project-form-heading"], text=Add Project, text=Project Name`,
		playwright.PageWaitForSelectorOptions{
			State:   playwright.WaitForSelectorStateVisible,
			Timeout: playwright.Float(10000),
		},
	); err != nil {
		// Non-fatal: maybe the form is already up; continue.
	}

	if err := fillByLabelOrTestID(p.page, "project-name", "Project Name", name); err != nil {
		return fmt.Errorf("fill Project Name: %w", err)
	}
	if description != "" {
		_ = fillByLabelOrTestID(p.page, "project-description", "Project Description", description)
	}

	if err := p.page.Locator(
		`[data-testid="submit-project"], button:has-text("Submit"):not([disabled])`).First().Click(); err != nil {
		return fmt.Errorf("click submit: %w", err)
	}

	// Wait for the form to close — i.e. the "Add Project" button comes back
	// in the toolbar. This is the most reliable signal that the project was
	// saved successfully, regardless of pagination.
	if _, err := p.page.WaitForSelector(
		`[data-testid="add-project"], button:has-text("Add Project")`,
		playwright.PageWaitForSelectorOptions{
			State:   playwright.WaitForSelectorStateVisible,
			Timeout: playwright.Float(15000),
		},
	); err != nil {
		return fmt.Errorf("project form did not close after submit (project %q may not have been created): %w", name, err)
	}
	return nil
}

// Exists returns true if a project with the given name appears in the list.
func (p *ProjectsPage) Exists(name string) (bool, error) {
	return p.page.Locator(fmt.Sprintf(`tr:has-text("%s")`, name)).First().IsVisible()
}

// Read clicks the project row to open its details.
func (p *ProjectsPage) Read(name string) error {
	return p.page.Locator(fmt.Sprintf(`tr:has-text("%s")`, name)).First().Click()
}

// Update opens the row's ⋯ menu, clicks Edit Project, renames + submits.
func (p *ProjectsPage) Update(oldName, newName string) error {
	if err := p.openRowMenu(oldName); err != nil {
		return err
	}
	if err := clickAny(p.page,
		`[data-testid="edit-project"]`,
		`text=Edit Project`,
	); err != nil {
		return fmt.Errorf("click Edit Project: %w", err)
	}

	// The Edit Project page has a Project Name field. In some builds it's
	// read-only — we attempt to clear+fill and ignore if disabled.
	nameInput := p.page.Locator(`input[name="project_name"], input[name="projectName"]`).First()
	_ = nameInput.Clear()
	_ = nameInput.Fill(newName)

	return p.page.Locator(
		`[data-testid="submit-project"], button:has-text("Submit")`).Click()
}

// Delete removes a project via the row menu.
func (p *ProjectsPage) Delete(name string) error {
	if err := p.openRowMenu(name); err != nil {
		return err
	}
	if err := clickAny(p.page,
		`[data-testid="delete-project"]`,
		`text=Delete Project`,
		`text=Delete`,
	); err != nil {
		return fmt.Errorf("click Delete: %w", err)
	}
	// Confirmation dialog
	if err := p.page.Locator(
		`[data-testid="confirm-delete"], button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Delete")`,
	).First().Click(); err != nil {
		// Some builds delete immediately without confirmation; that's fine
	}
	_, err := p.page.WaitForSelector(fmt.Sprintf(`tr:has-text("%s")`, name),
		playwright.PageWaitForSelectorOptions{
			State:   playwright.WaitForSelectorStateDetached,
			Timeout: playwright.Float(15000),
		})
	return err
}

// IsCreateButtonVisible returns whether the role can see "Add Project".
// Used in RBAC tests for Project Admin / Project Viewer.
func (p *ProjectsPage) IsCreateButtonVisible() (bool, error) {
	return p.page.Locator(
		`[data-testid="add-project"], button:has-text("Add Project")`).First().IsVisible()
}

func (p *ProjectsPage) openRowMenu(projectName string) error {
	row := p.page.Locator(fmt.Sprintf(`tr:has-text("%s")`, projectName)).First()
	// The "⋯" cell sits at the end of the row. Try data-testid, aria-label,
	// then fall back to the last button in the row.
	candidates := []string{
		fmt.Sprintf(`[data-testid="row-menu-%s"]`, strings.ToLower(projectName)),
		`[data-testid="row-menu"]`,
		`button[aria-label*="action" i]`,
		`button[aria-label*="more" i]`,
		`button:has(svg)`,
	}
	for _, sel := range candidates {
		btn := row.Locator(sel).Last()
		if visible, _ := btn.IsVisible(); visible {
			return btn.Click()
		}
	}
	return fmt.Errorf("could not find ⋯ menu on row %q", projectName)
}
