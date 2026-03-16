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
    ): Promise<'IS_MEMBER' | 'NOT_MEMBER' | 'SKIPPED'> {
        if (process.platform !== 'win32') {
            return 'SKIPPED';
        }

        this.logger.log(`[${traceId}] Checking Backup Operators group membership for user: ${username}`);

        // Escape single quotes in credentials to avoid breaking the PS script string literals
        const safeUsername = username.replace(/'/g, "''");
        const safePassword = password.replace(/'/g, "''");

        const psScript = `
$cs = Get-WmiObject Win32_ComputerSystem
if ($cs.PartOfDomain -eq $false) {
    Write-Output 'SKIPPED'
    exit
}
try {
    $domain = $cs.Domain
    $searcher = New-Object System.DirectoryServices.DirectorySearcher
    $searcher.SearchRoot = New-Object System.DirectoryServices.DirectoryEntry("LDAP://$domain", "$domain\\${safeUsername}", '${safePassword}')
    $searcher.Filter = "(&(objectClass=group)(cn=Backup Operators))"
    $searcher.PropertiesToLoad.Add("member") | Out-Null
    $result = $searcher.FindOne()
    $members = $result.Properties["member"]
    $isMember = $members | Where-Object { $_ -imatch "CN=${safeUsername}," }
    if ($isMember) { Write-Output 'IS_MEMBER' } else { Write-Output 'NOT_MEMBER' }
} catch {
    Write-Output 'SKIPPED'
}
`;

        const scriptPath = path.join(os.tmpdir(), `check_backup_ops_${traceId}.ps1`);

        try {
            await fs.promises.writeFile(scriptPath, psScript, 'utf8');
            const { stdout, stderr } = await execAsync(
                `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
                { windowsHide: true, timeout: 15000 }
            );

            if (stderr) {
                this.logger.warn(`[${traceId}] stderr during group check: ${stderr}`);
            }

            const result = stdout.trim();
            this.logger.log(`[${traceId}] Backup Operators check output: ${result}`);

            if (result.includes('SKIPPED')) {
                this.logger.log(`[${traceId}] Worker is not domain-joined. Skipping Backup Operators check.`);
                return 'SKIPPED';
            }

            if (result.includes('IS_MEMBER')) {
                this.logger.log(`[${traceId}] Backup Operators membership confirmed.`);
                return 'IS_MEMBER';
            }

            this.logger.warn(`[${traceId}] User is NOT a member of Backup Operators.`);
            return 'NOT_MEMBER';

        } catch (error) {
            this.logger.error(`[${traceId}] Error checking Backup Operators membership: ${error.message}`);
            return 'SKIPPED';
        } finally {
            try {
                await fs.promises.unlink(scriptPath);
            } catch {
                // ignore cleanup errors
            }
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