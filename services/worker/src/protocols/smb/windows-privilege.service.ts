import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { psEnableBackupPrivilegeScript } from '../../activities/core/migrate/command-execution/win-opeartions/powershell.script';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execAsync = promisify(exec);

@Injectable()
export class WindowsPrivilegeService {
    private readonly logger = new Logger(WindowsPrivilegeService.name);
    private privilegesEnabled = false;

    /**
     * Enable Windows SeBackupPrivilege and SeRestorePrivilege for the current process
     * This allows bypassing file permissions when accessing SMB shares
     */
    async enableBackupPrivileges(jobRunId: string): Promise<boolean> {
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
        const tempFile = path.join(os.tmpdir(), `enable_privs_${jobRunId}.ps1`);
        const psScript = getNodeProcessPrivilegeScript(process.pid);
        
        try {
            await fs.promises.writeFile(tempFile, psScript, 'utf8');

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
        } catch (error) {
            this.logger.error(`Error enabling backup privileges: ${error.message}`);
            if (error.stderr) {
                this.logger.error(`PowerShell error details: ${error.stderr}`);
            }
            return false;
        } finally {
            // Only attempt to delete the file if tempFile is defined
            if (tempFile) {
                try {
                    await fs.promises.unlink(tempFile);
                } catch (error) {
                    this.logger.error(`Error deleting powershell script file: ${error.message}`);
                }
            }
        }
    }
}