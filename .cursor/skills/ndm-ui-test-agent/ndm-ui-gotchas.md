# NDM UI Test — Solved Gotchas & Selector Reference

Detailed reference for the `ndm-ui-test-agent` skill. Contains every
selector problem encountered during development and the working solution.

---

## NDM Page Structure (2026.05 Build)

### Login
- URL: `<base>/keycloak/realms/datamigrator/protocol/openid-connect/auth?...`
- Username field: `input[name="username"]` or `input[id="username"]`
- Password field: `input[name="password"]` or `input[id="password"]`
- Submit: `button[type="submit"]` or `button[id="kc-login"]`
- After login: redirects to `<base>/home`

### First-Login Password Change
- After submitting temp password, Keycloak shows "Update Password" page
- New password: `input[id="password-new"]`
- Confirm: `input[id="password-confirm"]`
- Submit: `button[type="submit"]`
- Keycloak error banner: `#kc-error-message` or `[class*="alert-error"]`

### Home Page (`/home`)
- Header: NetApp logo + "Data Migrator" + Project switcher + gear + help + avatar
- Gear icon (Settings trigger): 3rd icon button from right in the header
  - No `aria-label` in current build
  - Recommended: add `data-testid="settings-button"`

### Settings Drawer
- Rendered as `MuiDrawer-anchorRight` (right-side overlay)
- NOT a separate URL — stays on `/home`
- Tabs: Users / Projects / SMTP (bxp `InnerTab.Button`, no `role="tab"`)
- Drawer detection signals (poll all, any match = open):
  ```
  [class*="MuiDrawer-anchorRight"]
  [role="dialog"]:has-text("Settings")
  text=Settings
  text=Add User
  text=Add Project
  text=SMTP
  ```

### Users Tab
- "Add User" button: `button:has-text("Add User")` or `[data-testid="add-user"]`
- Table columns: Name | Role | Email | Created | Created By | Status | ⋯
- Row ⋯ menu items: "Disable Access" / "Enable Access" / "Reset Password"

### Add User Modal
- Heading: "Add User"
- Fields: First Name, Last Name, Email (all `FormFieldInputNew`)
- Checkbox: "App Admin" (`Checkbox` component)
- Buttons: Cancel / Submit

### Success Dialog (after Add User)
- Heading: "User Added Successfully"
- Password field: `input[name="password"]` (masked, last input on page)
- Copy link: text "Copy"
- Close button: `button:has-text("Close")` — BUT there's also a search-clear
  icon with `aria-label="Close"`. Fix: `button:not([aria-label]):has-text("Close")`

### Projects Tab
- "Add Project" button: `button:has-text("Add Project")` or `[data-testid="add-project"]`
- Table: Name | Description | Created On (UTC) | Created By | ⋯
- Table paginates at 10 rows — use search to find specific projects
- Search icon: magnifying glass next to "Add Project"
- Search input: `input[placeholder*="Search"]` or `input[type="search"]`
- Row ⋯ menu: icon-only button with SVG, no text. Find via XPath anchored on project name text

### Add/Edit Project Form
- Heading: "Add Project" or "Edit Project"
- Project Name: `FormFieldInputNew` (disabled in edit mode)
- Project Description: `FormFieldTextArea` (optional)
- Associate Users section:
  - User dropdown: `FormFieldSelect` (searchable) — opens popup with Search input
  - Role dropdown: `FormFieldSelect` — options: "Project Admin" / "Project Viewer"
  - "+ Add" button: `button` with AddIcon SVG + text "Add" (disabled until both fields filled)
  - Associations table: shows added user/role pairs with X remove button
- Footer: Cancel / Submit

### Dropdown Interaction Pattern (FormFieldSelect)

The bxp `FormFieldSelect` is a custom component, NOT a native `<select>`.

**Working pattern:**
1. Find label text ("User" or "Role")
2. Find "Select..." placeholder below it via XPath
3. Click to open popup
4. If searchable: find `input[placeholder="Search"]`, fill value
5. Wait 400ms for filter
6. Click matching option via `GetByText(value, {exact: true})`
7. Wait 200ms for popup to close

**DO NOT:**
- Press Enter (submits the form)
- Use `[role="combobox"]` (doesn't exist)
- Use `[role="option"]` (doesn't exist — options are plain divs)

---

## Solved Selector Problems

### 1. Opening the Settings drawer
**Problem:** No `data-testid`, no `aria-label` on the gear icon.
**Solution:** Iterate all visible `button:has(svg)`, click each, check if drawer opened.
**Better:** Add `data-testid="settings-button"` to `Settings.tsx`.

### 2. Detecting drawer open
**Problem:** `[role="tab"]:has-text("Users")` doesn't match — bxp tabs don't use `role="tab"`.
**Solution:** Poll multiple signals: `text=SMTP`, `[class*="MuiDrawer-anchorRight"]`, `text=Settings`, etc.

### 3. Mixed CSS + text= selector
**Problem:** `[data-testid="X"], text=Foo` crashes Playwright.
**Solution:** Use `clickAny(page, `[data-testid="X"]`, `text=Foo`)` helper.

### 4. Multiple "Close" buttons
**Problem:** Dialog Close + search-clear ✕ both match `button:has-text("Close")`.
**Solution:** `button:not([aria-label]):has-text("Close")` — the dialog button has no `aria-label`.

### 5. Enter submits the form
**Problem:** Pressing Enter in the User dropdown's Search input submits the Edit Project form.
**Solution:** Never press Enter. Click the filtered option directly.

### 6. Project name truncated
**Problem:** Long names like `ui-project-1778506652807` render as `ui-project-...` in the DOM.
**Solution:** Use short names: `uitest-<6digits>` (≤13 chars).

### 7. Finding the ⋯ menu on a project row
**Problem:** `tr:has-text("projectName")` doesn't work — bxp uses `<div>` rows, not `<tr>`.
**Solution:** Use the search/filter to narrow to 1 row, then click the ⋯ via XPath anchored on the project name text.

### 8. "+ Add" button ambiguity
**Problem:** Page has "Add User", "Add Project", and the associate "+ Add" — all contain text "Add".
**Solution:** XPath: `//*[text()="Associate Users"]/following::button[.//text()[normalize-space()="Add"]][1]`

### 9. Dropdown picks wrong user (from previous test run)
**Problem:** Typing partial email matches users from earlier runs.
**Solution:** Use `GetByText(fullEmail, {exact: true})` after filtering via Search input.

---

## Recommended data-testid Attributes

Add these to `services/datamigrator-ui/src/` for stable selectors:

| Element | `data-testid` | React File |
|---------|--------------|-----------|
| Gear icon | `settings-button` | `top-nav-bar/setting/Settings.tsx` |
| Users tab | `settings-tab-Users` | `top-nav-bar/setting/SettingsContent.tsx` |
| Projects tab | `settings-tab-Projects` | `top-nav-bar/setting/SettingsContent.tsx` |
| SMTP tab | `settings-tab-SMTP` | `top-nav-bar/setting/SettingsContent.tsx` |
| Add User button | `add-user` | `ManageUsers/ManageUsers.tsx` |
| Add Project button | `add-project` | `ManageProjects/ManageProjects.tsx` |
| User dropdown (Associate) | `associate-user-select` | `ManageProjects/components/AssociateUsers.tsx` |
| Role dropdown (Associate) | `associate-role-select` | `ManageProjects/components/AssociateUsers.tsx` |
| + Add (Associate) | `associate-add` | `ManageProjects/components/AssociateUsers.tsx` |
| Remove association (X) | `remove-association` | `custom-cell-renderer/RemoveCellRenderer.tsx` |
| Submit (Add User) | `submit-user` | `ManageUsers/CreateUserForm.tsx` |
| Submit (Project) | `submit-project` | `ManageProjects/CreateProject.tsx` |
| Temp password input | `temporary-password` | `ManageUsers/TemporaryPassword.tsx` |
| Close (temp password) | `close-temporary-password` | `ManageUsers/TemporaryPassword.tsx` |
| First Name | `first-name` | `ManageUsers/CreateUserForm.tsx` |
| Last Name | `last-name` | `ManageUsers/CreateUserForm.tsx` |
| Email | `email` | `ManageUsers/CreateUserForm.tsx` |
| App Admin checkbox | `is-app-admin` | `ManageUsers/CreateUserForm.tsx` |
