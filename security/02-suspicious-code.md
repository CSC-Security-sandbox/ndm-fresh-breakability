# Suspicious Code Inventory

## Severity summary

| Severity | Count | Findings |
| --- | ---: | --- |
| Critical | 2 | SC-001, SC-006 |
| High | 5 | SC-002, SC-003, SC-004, SC-005, SC-007 |
| Medium | 3 | SC-008, SC-011, SC-013 |
| Low | 3 | SC-009, SC-010, SC-012 |

The entries below intentionally err on the side of inclusion. Several low-severity items are likely false positives or defense-in-depth concerns; step 3 validates them individually.

## Critical

### SC-001  (relates to AS-018)
- **File:** services/jobs-service/src/jobconfig/mount-tracker.service.ts:L471-L481, L668-L679, L757-L766
- **Sink type:** unsafe shell-based mount execution / argument injection
- **Taint source:** AS-018
- **Code snippet:**
```ts name=services/jobs-service/src/jobconfig/mount-tracker.service.ts url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/jobs-service/src/jobconfig/mount-tracker.service.ts#L471-L481
private async runCommand(
  template: string,
  envVars: Record<string, string>,
  timeoutMs?: number,
): Promise<void> {
  const env = { ...process.env, ...envVars };
  await execAsync(template, {
    env,
    timeout: timeoutMs ?? this.mountTimeoutMs,
    maxBuffer: 1024 * 1024,
  });
}
```

```ts name=services/jobs-service/src/jobconfig/mount-tracker.service.ts url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/jobs-service/src/jobconfig/mount-tracker.service.ts#L668-L679
if (request.protocol === Protocol.NFS) {
  const nfsVersion = ...;
  await this.runCommand(this.nfsMountCmd, {
    HOST: request.hostname.replace(/\\0/g, "").trim(),
    MOUNT_PATH: exportPath,
    DIR_PATH: mountDir,
    PROTOCOL_VERSION: nfsVersion,
  });
} else if (request.protocol === Protocol.SMB) {
  ...
  await this.attemptSmbMount(request, hostname, normalizedExport, mountDir, vers, backupUid, credsPath);
}
```

- **Why suspicious:** `runCommand()` executes shell strings via `exec()`, and mount arguments are populated from file-server hostnames, export paths, usernames, and passwords. Because the command templates are not quoted or tokenized, whitespace and mount-option metacharacters can change argv and mount semantics.
- **Severity guess:** Critical

### SC-006  (relates to AS-022)
- **File:** services/worker/src/protocols/protocol/protocol.ts:L50-L72
- **Sink type:** command injection in worker protocol execution
- **Taint source:** AS-022
- **Code snippet:**
```ts name=services/worker/src/protocols/protocol/protocol.ts url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/worker/src/protocols/protocol/protocol.ts#L50-L72
const command = commandPattern
  ?.replaceAll('${HOST}', payload?.hostname)
  ?.replaceAll('${USERNAME}', payload?.username)
  ?.replaceAll('${PASSWORD}', payload?.password)
  ?.replaceAll('${MOUNT_PATH}', payload?.path)
  ?.replaceAll('${DIR_PATH}', directoryPath)
  ?.replaceAll('${PROTOCOL_VERSION}', payload?.protocolVersion)
...
const { stdout, stderr } = await execAsync(command, {
  timeout: 5000,
  maxBuffer: 1024 * 1024,
  encoding: 'utf8'
});
```

- **Why suspicious:** Worker protocol commands are assembled by raw string replacement and then executed with `exec()`. Hostnames, usernames, passwords, paths, and protocol versions come from job/config payloads, so an attacker who can register or edit a file server can inject shell metacharacters directly into worker-side command execution.
- **Severity guess:** Critical

## High

### SC-002  (relates to AS-018)
- **File:** services/jobs-service/src/jobconfig/mount-tracker.service.ts:L227-L237, L855-L875, L928-L969
- **Sink type:** SSRF / DNS poisoning / privileged file overwrite side effects
- **Taint source:** AS-018
- **Code snippet:**
```ts name=services/jobs-service/src/jobconfig/mount-tracker.service.ts url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/jobs-service/src/jobconfig/mount-tracker.service.ts#L227-L237
if (fileServerId) {
  const fileServer = await this.fileServerRepository.findOne({
    where: { id: fileServerId },
    select: ['dnsServer']
  });
  if (fileServer?.dnsServer) {
    customDnsServers = fileServer.dnsServer.split(',').map(s => s.trim()).filter(Boolean);
  }
}
```

```ts name=services/jobs-service/src/jobconfig/mount-tracker.service.ts url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/jobs-service/src/jobconfig/mount-tracker.service.ts#L855-L875
const resolvedIp = await this.performDnsResolution(hostname, fileServerId);
...
const entry = `${resolvedIp} ${hostname}\n`;
await fs.promises.appendFile("/etc/hosts", entry);
```

```ts name=services/jobs-service/src/jobconfig/mount-tracker.service.ts url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/jobs-service/src/jobconfig/mount-tracker.service.ts#L928-L969
if (fileServer?.dnsServer) {
  kdcIp = fileServer.dnsServer.split(",").map(s => s.trim()).filter(Boolean)[0] ?? "";
}
...
await fs.promises.writeFile(krb5Path, krb5Conf, "utf8");
```

- **Why suspicious:** SMB mount fallback trusts `dnsServer` from the persisted file-server record, uses it as a resolver/KDC source, and then mutates `/etc/hosts` and `/etc/krb5.conf`. An authenticated config writer can steer name resolution and Kerberos to attacker-controlled infrastructure.
- **Severity guess:** High

### SC-003  (relates to AS-017)
- **File:** lib/auth-lib/src/auth/JwtAuthGuard.ts:L44-L58
- **Sink type:** authorization confusion / cross-project access
- **Taint source:** AS-017
- **Code snippet:**
```ts name=lib/auth-lib/src/auth/JwtAuthGuard.ts url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/lib/auth-lib/src/auth/JwtAuthGuard.ts#L44-L58
if (permissions.length > 0) {
  const project = request.headers.projectid
  for (const role of decoded.user.roles) {
    if (role.projects.length === 0 || role.projects?.includes(project)) {
      const permMap = new Set<string>(role.permissions)
      for (const perm of permissions) {
        if (!permMap.has(perm)) {
          return false;
        }
      }
      return true
    }
  }
  return false
}
```

- **Why suspicious:** Project scoping is delegated to the caller-controlled `projectId` header instead of deriving tenancy from the target resource. A valid token holder can select whichever project header best matches their role set while querying unrelated resource IDs.
- **Severity guess:** High

### SC-004  (relates to AS-029)
- **File:** services/config-service/src/storage-clients/isilon/isilon-storage-client.ts:L656-L671; services/worker/src/storage-clients/isilon/isilon-storage-client.ts:L711-L726
- **Sink type:** insecure TLS verification / hostname bypass
- **Taint source:** AS-029
- **Code snippet:**
```ts name=services/config-service/src/storage-clients/isilon/isilon-storage-client.ts url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/config-service/src/storage-clients/isilon/isilon-storage-client.ts#L656-L671
const options: any = {
  hostname: host,
  port: port,
  path: fullPath,
  method: method,
  headers: {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  ca: pemCert,
  rejectUnauthorized: true,
  servername: host,
  checkServerIdentity: () => undefined,
};
```

- **Why suspicious:** Both Isilon clients disable hostname verification with `checkServerIdentity: () => undefined` while still sending Basic-auth credentials. The certificate chain must validate, but the peer can present a cert for the wrong hostname and still receive credentials and management-plane traffic.
- **Severity guess:** High

### SC-005  (relates to AS-023)
- **File:** services/config-service/src/storage-clients/isilon/isilon-storage-client.ts:L815-L860; services/worker/src/storage-clients/isilon/isilon-storage-client.ts:L870-L915
- **Sink type:** command injection in Windows DNS configuration helpers
- **Taint source:** AS-023
- **Code snippet:**
```ts name=services/config-service/src/storage-clients/isilon/isilon-storage-client.ts url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/config-service/src/storage-clients/isilon/isilon-storage-client.ts#L815-L860
const addCmd = `powershell -Command "Add-DnsClientNrptRule -Namespace '.${dnsZone}' -NameServers '${ssip}'"`;
await execAsync(addCmd);
...
const { stdout: nslookupOut } = await execAsync(`nslookup ${dnsZone} ${ssip}`);
...
const netshCmd = `netsh interface ip add dns name="Ethernet" addr=${ssip} index=1`;
await execAsync(netshCmd);
```

- **Why suspicious:** `smartConnectDnsZone` and `smartConnectSsip` are concatenated directly into PowerShell, `nslookup`, and `netsh` strings. The DTOs only require strings, so a crafted zone value can break quoting and append extra commands on Windows hosts.
- **Severity guess:** High

### SC-007  (relates to AS-016)
- **File:** services/db-writer/src/redis-consumer/redis-consumer.controller.ts:L20-L45
- **Sink type:** missing authentication / unauthenticated background work start
- **Taint source:** AS-016
- **Code snippet:**
```ts name=services/db-writer/src/redis-consumer/redis-consumer.controller.ts url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/db-writer/src/redis-consumer/redis-consumer.controller.ts#L20-L45
/**
 * Start a consumer for a specific job.
 * UnAuthenticated as this endpoint is called internally by the jobs service.
 */
@Post('start')
async start(@Body() consumerDto: ConsumerDto, @Headers('projectid') projectId?: string) {
  const { jobRunId } = consumerDto;
  (async () => {
    await this.redisConsumerService.saveJobConsumersToRedis(jobRunId, projectId);
  })();
  return { success: true, message: 'Consumer started successfully.' };
}
```

- **Why suspicious:** The hidden `redis-consumer/start` endpoint intentionally skips authentication and immediately starts async work. If the service is reachable from any broader network segment, an attacker can trigger arbitrary consumer startups and cause queue churn or noisy background work.
- **Severity guess:** High

## Medium

### SC-008  (relates to AS-027)
- **File:** services/config-service/src/support-bundle/support-bundle.controller.ts:L58-L69
- **Sink type:** missing authentication / arbitrary workflow-status mutation
- **Taint source:** AS-027
- **Code snippet:**
```ts name=services/config-service/src/support-bundle/support-bundle.controller.ts url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/config-service/src/support-bundle/support-bundle.controller.ts#L58-L69
@ApiOperation({ summary: 'Update workflow status by traceId' })
@Post('workflow-status-update')
async updateStatus(@Body() updateStatusDto: UpdateStatusDto) {
  return await this.supportBundleService.updateSupportBundleStatus(
    updateStatusDto,
  );
}
```

- **Why suspicious:** `POST /support-bundle/workflow-status-update` mutates support-bundle state without `@Auth()` or worker authentication. Any caller with network access to config-service can mark another user's bundle as completed/failed if they know or can guess a trace ID.
- **Severity guess:** Medium

### SC-011  (relates to AS-021)
- **File:** services/keycloak-customizations/create-cru.sh:L4-L29; services/worker/.env.template:L17-L24,L48-L54
- **Sink type:** hardcoded credentials / insecure developer defaults
- **Taint source:** AS-021
- **Code snippet:**
```sh name=services/keycloak-customizations/create-cru.sh url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/keycloak-customizations/create-cru.sh#L4-L29
export KEYCLOAK_BASEURL=http://localhost:8080
export KEYCLOAK_USER=admin
export KEYCLOAK_PASSWORD=admin
export CLIENT_ID=netapp-cli
export CLIENT_SECRET=OVK9e69r8lkVPYksc8CINrANm74HwAuz
...
export PG_USER=dmadmin
export PG_PASSWORD=dmadmin
```

```dotenv name=services/worker/.env.template url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/worker/.env.template#L17-L24
SMB_WIN_VALIDATE_CRED_CMD='net use \\${HOST} /user:${USERNAME} ${PASSWORD}'
SMB_WIN_SAVE_CREDS='CMDKEY /add:${HOST} /user:"${USERNAME}" /pass:"${PASSWORD}"'
SMB_LINUX_LIST_PATH_CMD='smbclient -L ${HOST} -U ${USERNAME}%${PASSWORD}'
SMB_LINUX_MOUNT_PATH_CMD="mount -t cifs //${HOST}/${PATH} ${BASE_DIR}/${JOB_RUN_ID}/${PATH_ID} -o username=${USERNAME},password='${PASSWORD}'"
```

- **Why suspicious:** Repository-shipped setup artifacts contain live-looking client secrets, admin passwords, DB passwords, worker secrets, and plaintext command templates that embed credentials. Even if intended for local use, these values tend to get copied into test or staging environments and are searchable by anyone with repo access.
- **Severity guess:** Medium

### SC-013  (relates to AS-015)
- **File:** services/reports-service/src/asup/asup.controller.ts:L99-L118
- **Sink type:** missing authentication on internal support-bundle transmit endpoint
- **Taint source:** AS-015
- **Code snippet:**
```ts name=services/reports-service/src/asup/asup.controller.ts url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/reports-service/src/asup/asup.controller.ts#L99-L118
@Post('support-bundle/send')
async sendSupportBundle(@Body() dto: SendSupportBundleDto): Promise<{ success: boolean }> {
  const rootDir = path.resolve(this.bundlePath);
  const bundleFilePath = path.resolve(rootDir, dto.fileName);
  if (!bundleFilePath.startsWith(rootDir + path.sep)) {
    throw new BadRequestException('Invalid bundle file name.');
  }
  await this.asupSchedulerService.transmitSupportBundle(
    path.basename(bundleFilePath),
    bundleFilePath,
  );
  return { success: true };
}
```

- **Why suspicious:** `POST /asup/support-bundle/send` accepts a file name and immediately transmits the referenced bundle without `@Auth()` or worker auth. Path traversal is blocked, but any network-reachable caller can trigger outbound ASUP sends of existing bundles under the shared bundle directory.
- **Severity guess:** Medium

## Low

### SC-009  (relates to AS-019)
- **File:** services/support-service/src/activities/log-generator/log-generator.activity.ts:L272-L277
- **Sink type:** potential command injection in log collection helper
- **Taint source:** AS-019
- **Code snippet:**
```ts name=services/support-service/src/activities/log-generator/log-generator.activity.ts url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/support-service/src/activities/log-generator/log-generator.activity.ts#L272-L277
private async findFilesInDirectory(dirPath: string, traceId: string): Promise<string[]> {
  const findCommand = `find "${dirPath}" -type f`;
  this.logger.log(`[${traceId}] Executing: ${findCommand}`);
  const { stdout } = await exec(findCommand);
```

- **Why suspicious:** The activity builds a `find` command string from `dirPath` and runs it with `exec()`. The current public DTOs constrain `projectId`/`workerIds` to UUIDs and dates to `IsDateString`, so the main path to shell metacharacters is indirect (forged Temporal payloads or future DTO drift).
- **Severity guess:** Low

### SC-010  (relates to AS-024)
- **File:** services/admin-service/src/upgrade/upgrade.service.ts:L1713-L1731; services/admin-service/src/upgrade/upgrade.service.ts:L1971-L1978
- **Sink type:** upgrade shell execution with user-controlled version (likely mitigated)
- **Taint source:** AS-024
- **Code snippet:**
```ts name=services/admin-service/src/upgrade/upgrade.service.ts url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/admin-service/src/upgrade/upgrade.service.ts#L1713-L1731
const nsenterCmd =
  `nsenter -t 1 -m -u -i -n -p -- ` +
  `systemd-run --unit=ndm-upgrade --remain-after-exit ` +
  `--setenv=ANSIBLE_CONFIG=${bundleDir}/upgrade-ansible.cfg ` +
  `--working-directory=${bundleDir} ` +
  `bash -c 'ansible-playbook ${playbookPath} --extra-vars "build_version=${buildVersion}" > ${logFile} 2>&1'`;
exec(nsenterCmd, ...);
```

```ts name=services/admin-service/src/upgrade/upgrade.service.ts url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/admin-service/src/upgrade/upgrade.service.ts#L1971-L1978
private sanitizeVersion(version: string): string {
  if (!version || !/^[a-zA-Z0-9._-]+$/.test(version)) {
    throw new BadRequestException(...);
  }
  return version;
}
```

- **Why suspicious:** The upgrade path eventually shells out with versioned bundle paths, which is a classic command-injection hotspot. In this codebase the version string is constrained by `sanitizeVersion()` / filename regexes before it reaches the shell, so this currently looks mitigated rather than directly exploitable.
- **Severity guess:** Low

### SC-012  (relates to AS-025)
- **File:** services/admin-service/src/main.ts:L44; services/config-service/src/main.ts:L45; services/jobs-service/src/main.ts:L47; services/db-writer/src/main.ts:L33; services/reports-service/src/main.ts:L63
- **Sink type:** permissive CORS policy
- **Taint source:** AS-025
- **Code snippet:**
```ts name=services/jobs-service/src/main.ts url=https://github.com/NetApp-Cloud-DataMigrate/ndm/blob/53ffaf744457d63743694e2bb2acdbeb86889e89/services/jobs-service/src/main.ts#L44-L48
app.enableShutdownHooks();
app.set('trust proxy', true);
app.enableCors();
await app.listen(port, '0.0.0.0');
```

- **Why suspicious:** Multiple services call `app.enableCors()` with default permissive settings. This is not an immediate bypass on its own, but it widens the browser attack surface for bearer-token misuse and accidental exposure of internal APIs to hostile origins.
- **Severity guess:** Low
