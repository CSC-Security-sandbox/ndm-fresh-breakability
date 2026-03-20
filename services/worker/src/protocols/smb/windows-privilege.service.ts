import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { psEnableBackupPrivilegeScriptMinified } from '../../activities/core/migrate/command-execution/win-opeartions/powershell.script';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Injectable()
export class WindowsPrivilegeService {
    private readonly logger = new Logger(WindowsPrivilegeService.name);
    private privilegesEnabled = false;

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