import { Page } from "@playwright/test";

const KEYCLOAK_AUTHORITY = "http://localhost:7080/realms/datamigrator";
const CLIENT_ID = "datamigrator-client";
const SESSION_STORAGE_KEY = `oidc.user:${KEYCLOAK_AUTHORITY}:${CLIENT_ID}`;

const MOCK_ACCESS_TOKEN = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJuYW1lIjoiVGVzdCBVc2VyIiwiZW1haWwiOiJ0ZXN0QG5ldGFwcC5jb20iLCJleHAiOjk5OTk5OTk5OTksImlhdCI6MTcwMDAwMDAwMCwiaXNzIjoiaHR0cDovL2xvY2FsaG9zdDo3MDgwL3JlYWxtcy9kYXRhbWlncmF0b3IiLCJhenAiOiJkYXRhbWlncmF0b3ItY2xpZW50IiwicmVhbG1fYWNjZXNzIjp7InJvbGVzIjpbInVzZXIiXX0sInNjb3BlIjoib3BlbmlkIHByb2ZpbGUgZW1haWwifQ.fake-signature";

function mockOidcUser() {
  return {
    id_token: MOCK_ACCESS_TOKEN,
    access_token: MOCK_ACCESS_TOKEN,
    token_type: "Bearer",
    scope: "openid profile email",
    profile: {
      sub: "test-user-id",
      name: "Test User",
      email: "test@netapp.com",
      email_verified: true,
    },
    expires_at: 9999999999,
    session_state: "mock-session-state",
  };
}

/**
 * Injects a mock OIDC session into sessionStorage and mocks the Keycloak
 * discovery + token endpoints so react-oidc-context thinks we're authenticated.
 */
export async function setupMockAuth(page: Page) {
  await page.addInitScript(
    ({ key, user }) => {
      sessionStorage.setItem(key, JSON.stringify(user));
    },
    { key: SESSION_STORAGE_KEY, user: mockOidcUser() }
  );

  await page.route(`${KEYCLOAK_AUTHORITY}/.well-known/openid-configuration`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        issuer: KEYCLOAK_AUTHORITY,
        authorization_endpoint: `${KEYCLOAK_AUTHORITY}/protocol/openid-connect/auth`,
        token_endpoint: `${KEYCLOAK_AUTHORITY}/protocol/openid-connect/token`,
        userinfo_endpoint: `${KEYCLOAK_AUTHORITY}/protocol/openid-connect/userinfo`,
        end_session_endpoint: `${KEYCLOAK_AUTHORITY}/protocol/openid-connect/logout`,
        jwks_uri: `${KEYCLOAK_AUTHORITY}/protocol/openid-connect/certs`,
        check_session_iframe: `${KEYCLOAK_AUTHORITY}/protocol/openid-connect/login-status-iframe.html`,
        revocation_endpoint: `${KEYCLOAK_AUTHORITY}/protocol/openid-connect/revoke`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      }),
    })
  );

  await page.route(`${KEYCLOAK_AUTHORITY}/protocol/openid-connect/**`, (route) => {
    const url = route.request().url();
    if (url.includes("/certs")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ keys: [] }) });
    }
    if (url.includes("/userinfo")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sub: "test-user-id", name: "Test User", email: "test@netapp.com" }),
      });
    }
    if (url.includes("/login-status-iframe")) {
      return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body></body></html>" });
    }
    return route.continue();
  });
}

const ADMIN_API = "http://localhost:3001/api/v1";
const REPORTS_API = "http://localhost:3003/api/v1";
const JOBS_API = "http://localhost:3006/api/v1";

const MOCK_ACCOUNT_ID = "acc-001";
const MOCK_PROJECT_ID = "proj-001";

/**
 * Mocks all backend API calls that the AuthGuard + Layout + Home page make.
 */
export async function setupMockAPIs(page: Page) {
  await page.route(`${ADMIN_API}/user-permissions`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          id: "test-user-id",
          roles: [
            {
              role_name: "App Admin",
              projects: [],
              permissions: ["ManageConfig", "ManageJob", "ViewDashboard", "ManageWorker"],
            },
          ],
        },
      }),
    })
  );

  await page.route(`${ADMIN_API}/accounts`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { items: [{ id: MOCK_ACCOUNT_ID, name: "Test Account" }] },
      }),
    })
  );

  await page.route(`${ADMIN_API}/projects/accounts/*/projects*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          items: [{ id: MOCK_PROJECT_ID, name: "Test Project", account_id: MOCK_ACCOUNT_ID }],
        },
      }),
    })
  );

  await page.route(`${REPORTS_API}/asup/settings`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { items: { enabled: false, lastTransmission: null } },
      }),
    })
  );

  await page.route(`${REPORTS_API}/overview**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          jobDetails: {
            discovery: { total: 5, completed: 3, failed: 1, inProgress: 1 },
            migration: { total: 2, completed: 1, failed: 0, inProgress: 1 },
            cutover: { total: 0, completed: 0, failed: 0, inProgress: 0 },
          },
          storageDetails: {
            totalCapacity: 1073741824,
            usedCapacity: 536870912,
            discoveredFiles: 15000,
            migratedFiles: 8500,
          },
          lastRefreshed: new Date().toISOString(),
        },
      }),
    })
  );

  await page.route(`${JOBS_API}/jobs/notice-board/*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          countErroredJobRuns: 0,
          countBlockedCutoverJobRuns: 0,
          countRecentJobConfigs: 0,
          countCompletedJobRuns: 0,
          severityMessages: [],
        },
      }),
    })
  );
}
