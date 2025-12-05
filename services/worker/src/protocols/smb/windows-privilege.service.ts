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
        
        const privilegeScriptPath = path.join(os.tmpdir(), `enable_privs_${jobRunId}.ps1`);
        const psScript = getNodeProcessPrivilegeScript(process.pid);
        
        try {
            await fs.promises.writeFile(privilegeScriptPath, psScript, 'utf8');

            const { stdout, stderr } = await execAsync(
                `powershell -NoProfile -ExecutionPolicy Bypass -File "${privilegeScriptPath}"`,
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
        } finally {
            // Only attempt to delete the file if it exists
            try {
                await fs.promises.unlink(privilegeScriptPath);
                this.logger.debug(`Successfully deleted PowerShell script: ${privilegeScriptPath}`);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    this.logger.debug(`PowerShell script file does not exist, skipping cleanup: ${privilegeScriptPath}`);
                } else {
                    this.logger.error(`Error deleting PowerShell script file: ${error.message}`);
                }
            }
        }
    }
}