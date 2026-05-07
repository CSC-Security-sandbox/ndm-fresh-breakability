import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { psEnableBackupPrivilegeScriptMinified } from '../../activities/core/migrate/command-execution/win-opeartions/powershell.script';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Injectable()
export class WindowsPrivilegeService {
    private readonly logger = new Logger(WindowsPrivilegeService.name);
    private privilegesEnabled = false;

    async checkBackupOperatorMembership(
        traceId: string,
        username: string,
        password: string
    ): Promise<'IS_MEMBER' | 'NOT_MEMBER' | 'NOT_DOMAIN_JOINED' | 'ERROR'> {
        if (process.platform !== 'win32') {
            return 'NOT_DOMAIN_JOINED';
        }

        this.logger.log(`[${traceId}] Checking Backup Operators group membership for user: ${username}`);

        // Escape single quotes in username to avoid breaking PS script string literals.
        // Password is passed via NDM_SMB_PASSWORD env var so it never appears in the command line.
        const safeUsername = username.replace(/'/g, "''");

        // Uses Get-CimInstance (available on PS 3+, replaces deprecated Get-WmiObject).
        // Nested group membership is resolved via the LDAP_MATCHING_RULE_IN_CHAIN OID (1.2.840.113556.1.4.1941),
        // which makes AD walk the full transitive member-of chain server-side — no client-side recursion needed.
        const psScript = `
$cs = Get-CimInstance -ClassName Win32_ComputerSystem
if ($cs.PartOfDomain -eq $false) {
    Write-Output 'NOT_DOMAIN_JOINED'
    exit
}
try {
    $domain = $cs.Domain
    $rawUsername = '${safeUsername}'
    $samUsername = $rawUsername -replace '^.*\\\\', ''
    $escapedSam = [Regex]::Replace($samUsername, '[\\\\*()\\x00]', { param($m) '\\' + [Convert]::ToString([byte][char]$m.Value, 16).PadLeft(2, '0') })
    $bindUser = if ($rawUsername -match '\\\\') { $rawUsername } else { "$domain\\$rawUsername" }
    $bindPassword = $env:NDM_SMB_PASSWORD
    $cred = New-Object System.DirectoryServices.DirectoryEntry("LDAP://$domain", $bindUser, $bindPassword)
    $userSearcher = New-Object System.DirectoryServices.DirectorySearcher($cred)
    $userSearcher.Filter = "(&(objectClass=user)(sAMAccountName=$escapedSam))"
    $userSearcher.PropertiesToLoad.Add("distinguishedName") | Out-Null
    $userResult = $userSearcher.FindOne()
    if ($null -eq $userResult) { Write-Output 'NOT_MEMBER'; exit }
    $userDN = $userResult.Properties["distinguishedName"][0]
    $groupSearcher = New-Object System.DirectoryServices.DirectorySearcher($cred)
    $groupSearcher.Filter = "(&(objectClass=group)(cn=Backup Operators))"
    $groupSearcher.PropertiesToLoad.Add("distinguishedName") | Out-Null
    $groupResult = $groupSearcher.FindOne()
    if ($null -eq $groupResult) { Write-Output 'NOT_MEMBER'; exit }
    $groupDN = $groupResult.Properties["distinguishedName"][0]
    $nestedSearcher = New-Object System.DirectoryServices.DirectorySearcher($cred)
    $nestedSearcher.Filter = "(&(objectClass=user)(distinguishedName=$userDN)(memberOf:1.2.840.113556.1.4.1941:=$groupDN))"
    $nestedSearcher.PropertiesToLoad.Add("distinguishedName") | Out-Null
    $nestedResult = $nestedSearcher.FindOne()
    if ($nestedResult) { Write-Output 'IS_MEMBER' } else { Write-Output 'NOT_MEMBER' }
} catch {
    Write-Output 'ERROR'
}
`;
        try {
            const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
            const { stdout, stderr } = await execAsync(
                `powershell -NoProfile -NonInteractive -EncodedCommand ${encodedCommand}`,
                { windowsHide: true, timeout: 15000, env: { ...process.env, NDM_SMB_PASSWORD: password } }
            );

            if (stderr) {
                this.logger.warn(`[${traceId}] stderr during group check: ${stderr}`);
            }

            const result = stdout.trim();
            this.logger.log(`[${traceId}] Backup Operators check output: ${result}`);

            if (result.includes('NOT_DOMAIN_JOINED')) {
                this.logger.log(`[${traceId}] Worker is not domain-joined. Skipping Backup Operators check.`);
                return 'NOT_DOMAIN_JOINED';
            }

            if (result.includes('IS_MEMBER')) {
                this.logger.log(`[${traceId}] Backup Operators membership confirmed.`);
                return 'IS_MEMBER';
            }

            if (result.includes('ERROR')) {
                this.logger.error(`[${traceId}] Backup Operators check script reported an error (LDAP/AD failure).`);
                return 'ERROR';
            }

            this.logger.warn(`[${traceId}] User is NOT a member of Backup Operators.`);
            return 'NOT_MEMBER';

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[${traceId}] Error checking Backup Operators membership: ${errorMessage}`);
            return 'ERROR';
        }
    }

    /**
     * Enable Windows SeBackupPrivilege and SeRestorePrivilege for the current process
     * This allows bypassing file permissions when accessing SMB shares
     * @throws Error if privileges cannot be enabled
     */
    async enableBackupPrivileges(jobRunId: string): Promise<void> {
        if (process.platform !== 'win32') {
            this.logger.log('Not a Windows platform, skipping privilege enablement');
            return;
        }

        if (this.privilegesEnabled) {
            this.logger.log('Backup privileges already enabled');
            return;
        }

        this.logger.log('Enabling SeBackupPrivilege and SeRestorePrivilege...');


        function getNodeProcessPrivilegeScript(targetPid: number): string {
            return `
Add-Type -TypeDefinition @"
${psEnableBackupPrivilegeScriptMinified}
"@
$targetPid = ${targetPid}
$backupResult = [TokenManipulator]::EnablePrivilegeForPid($targetPid, "SeBackupPrivilege")
$restoreResult = [TokenManipulator]::EnablePrivilegeForPid($targetPid, "SeRestorePrivilege")
Write-Output "SeBackupPrivilege: $backupResult"
Write-Output "SeRestorePrivilege: $restoreResult"
if ($backupResult -like "*SUCCESS*" -and $restoreResult -like "*SUCCESS*") {
    Write-Output "OVERALL: SUCCESS"
} else {
    Write-Output "OVERALL: FAILED"
}
`;
        }
        
        const psScript = getNodeProcessPrivilegeScript(process.pid);
        
        try {
            const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');

            const { stdout, stderr } = await execAsync(
                `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodedCommand}`,
                { windowsHide: true }
            );

            if (stderr) {
                this.logger.warn(`PowerShell stderr: ${stderr}`);
            }

            const result = stdout.trim();
            this.logger.log(`PowerShell output:\n${result}`);

            if (result.includes('OVERALL: SUCCESS')) {
                this.privilegesEnabled = true;
                this.logger.log('SeBackupPrivilege and SeRestorePrivilege enabled successfully in Node.js process');
                return;
            } else {
                const errorMsg = 'Failed to enable backup privileges. Check if the user account needs to be added to the "Backup Operators" group or run as Administrator.';
                this.logger.error(errorMsg);
                throw new Error(errorMsg);
            }
        } catch (error) {
            if (error.message?.includes('Failed to enable backup privileges')) {
                throw error;
            }
            this.logger.error(`Error executing privilege enablement script: ${error.message}`);
            if (error.stderr) {
                this.logger.error(`PowerShell error details: ${error.stderr}`);
            }
            throw new Error(`Failed to enable Windows backup privileges: ${error.message}`);
        }
    }
}