# NDM UI Tests — Playwright (Go)

End-to-end UI tests for the NetApp Data Migrator (NDM) using
[playwright-go](https://github.com/playwright-community/playwright-go).

## Structure

```
UI-tests/
├── config/          ← Base URL, credentials, browser settings
├── fixtures/        ← Browser + auth setup/teardown helpers
├── pages/           ← Page Object Model for each NDM screen
│   ├── login.page.go
│   ├── accounts.page.go
│   ├── projects.page.go
│   ├── users.page.go
│   └── roles.page.go
├── helpers/         ← Test setup/teardown utilities (create project+user+role)
├── tests/           ← Test files (one per flow group)
│   ├── account_crud_test.go
│   ├── project_crud_test.go
│   ├── user_roles_test.go
│   └── rbac_test.go
└── test-results/    ← Screenshots + videos (auto-created)
```

## Prerequisites

```bash
# Install Playwright browsers (run once)
go run github.com/playwright-community/playwright-go/cmd/playwright@latest install --with-deps chromium
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NDM_BASE_URL` | `http://172.30.203.15` | NDM Control Plane URL |
| `NDM_USERNAME` | `admin@datamigrator.local` | App Admin email |
| `NDM_PASSWORD` | `Welcome@1234` | App Admin password |
| `NDM_PROJECT_ADMIN_EMAIL` | `projectadmin@test.com` | Project Admin email (pre-created) |
| `NDM_PROJECT_ADMIN_PASS` | `Test@1234` | Project Admin password |
| `NDM_PROJECT_VIEWER_EMAIL` | `projectviewer@test.com` | Project Viewer email (pre-created) |
| `NDM_PROJECT_VIEWER_PASS` | `Test@1234` | Project Viewer password |
| `NDM_HEADLESS` | `true` | Run browser headless (`false` to see browser) |
| `NDM_SLOWMO` | `0` | Slow down operations by N ms (useful for debugging) |
| `NDM_TIMEOUT` | `30000` | Default element timeout in ms |

## Running Tests

```bash
# All tests
go test ./tests/... -v

# Specific flow
go test ./tests/... -v -run TestAccount
go test ./tests/... -v -run TestProject
go test ./tests/... -v -run TestRBAC
go test ./tests/... -v -run TestBatchRole

# Visible browser (for debugging)
NDM_HEADLESS=false NDM_SLOWMO=500 go test ./tests/... -v -run TestRBAC_ProjectViewer

# With custom CP URL
NDM_BASE_URL=http://172.30.203.15 go test ./tests/... -v
```

## Covered Flows

| Flow | Test File | Tests |
|---|---|---|
| 2.1 Account CRUD | `account_crud_test.go` | Create, Read, Update, Delete |
| 2.2 Project CRUD | `project_crud_test.go` | Create, Read, Update, Delete |
| 2.3 Project Assignment | `user_roles_test.go` | Assign user to project |
| 2.4 Role CRUD | `user_roles_test.go` | Create, Update, Delete role |
| 2.5 Batch Role Assignment | `user_roles_test.go` | Assign 3 users in one operation |
| 2.6 RBAC — App Admin | `rbac_test.go` | Can create project, user, see all projects |
| 2.7 RBAC — Project Admin | `rbac_test.go` | Cannot create project/user; can assign roles in own project |
| 2.8 RBAC — Project Viewer | `rbac_test.go` | Cannot create anything; no file server / job buttons |
| 2.9 Cross-Project Isolation | `rbac_test.go` | Project Admin blocked from Project B resources |

## Test Artifacts

- **Screenshots** are saved to `test-results/screenshots/` on failure
- **Videos** are recorded to `test-results/videos/` for every test
