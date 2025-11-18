import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { psEnableBackupPrivilegeScript } from '../../activities/core/migrate/command-execution/win-opeartions/powershell.script';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Injectable()
export class WindowsPrivilegeService {
    private readonly logger = new Logger(WindowsPrivilegeService.name);
    private privilegesEnabled = false;

    /**
     * Enable Windows SeBackupPrivilege and SeRestorePrivilege for the current process
     * This allows bypassing file permissions when accessing SMB shares
     */
    async enableBackupPrivileges(): Promise<boolean> {
        if (process.platform !== 'win32') {
            this.logger.log('Not a Windows platform, skipping privilege enablement');
            return false;
        }

        if (this.privilegesEnabled) {
            this.logger.log('Backup privileges already enabled');
            return true;
        }

        this.logger.log('Enabling SeBackupPrivilege and SeRestorePrivilege...');


        function getNodeProcessPrivilegeScript(targetPid: number): string {
            return `
Add-Type -TypeDefinition @"
${psEnableBackupPrivilegeScript}
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
            const fs = require('fs');
            const os = require('os');
            const path = require('path');

            const tempFile = path.join(os.tmpdir(), `enable_privs_${process.pid}.ps1`);
            fs.writeFileSync(tempFile, psScript, 'utf8');

            try {
                const { stdout, stderr } = await execAsync(
                    `powershell -NoProfile -ExecutionPolicy Bypass -File "${tempFile}"`,
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
                    return true;
                } else {
                    this.logger.error('Failed to enable backup privileges - check output above for details');
                    this.logger.error('This usually means the user account needs to be added to the "Backup Operators" group or run as Administrator');
                    return false;
                }
            } finally {
                // Clean up temp file
                try {
                    fs.unlinkSync(tempFile);
                } catch (e) {
                    this.logger.warn(`Failed to delete temp PowerShell script: ${e.message}`);
                }
            }
        } catch (error) {
            this.logger.error(`Error enabling backup privileges: ${error.message}`);
            if (error.stderr) {
                this.logger.error(`PowerShell error details: ${error.stderr}`);
            }
            return false;
        }
    }

    /**
     * Print current privileges to the log
     * This shows privileges for a new PowerShell process, not the Node.js process
     * The privileges enabled by enableBackupPrivileges() apply to the Node.js process only
     */
    async logCurrentPrivileges(): Promise<void> {
        if (process.platform !== 'win32') {
            return;
        }

        try {
            const { stdout } = await execAsync('whoami /priv', { windowsHide: true });
            this.logger.log('Note: This shows privileges for a separate PowerShell process (PID ' + process.pid + ' has its own token):');
            this.logger.log(stdout);
        } catch (error) {
            this.logger.error(`Error getting current privileges: ${error.message}`);
        }
    }
}
