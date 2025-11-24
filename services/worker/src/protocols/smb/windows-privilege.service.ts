import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { psEnableBackupPrivilegeScript } from '../../activities/core/migrate/command-execution/win-opeartions/powershell.script';

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
        
        return new Promise<boolean>((resolve) => {
            this.logger.debug('Executing PowerShell script via stdin');
            
            let resolved = false;
            const safeResolve = (value: boolean) => {
                if (!resolved) {
                    resolved = true;
                    resolve(value);
                }
            };
            
            const ps = spawn('powershell', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-Command', '-'
            ], {
                windowsHide: true
            });

            let stdout = '';
            let stderr = '';

            ps.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            ps.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            ps.on('error', (error) => {
                this.logger.error(`Failed to spawn PowerShell: ${error.message}`);
                safeResolve(false);
            });

            ps.on('close', (code) => {
                if (stderr) {
                    this.logger.warn(`PowerShell stderr: ${stderr}`);
                }

                const result = stdout.trim();
                this.logger.log(`PowerShell output:\n${result}`);

                if (code !== 0) {
                    this.logger.error(`PowerShell exited with code ${code}`);
                    safeResolve(false);
                    return;
                }

                // Check if both privileges were enabled successfully
                const backupSuccess = result.includes('SeBackupPrivilege: SUCCESS');
                const restoreSuccess = result.includes('SeRestorePrivilege: SUCCESS');
                
                if (backupSuccess && restoreSuccess) {
                    this.privilegesEnabled = true;
                    this.logger.log('SeBackupPrivilege and SeRestorePrivilege enabled successfully in Node.js process');
                    safeResolve(true);
                } else {
                    this.logger.error('Failed to enable backup privileges - check output above for details');
                    this.logger.error('This usually means the user account needs to be added to the "Backup Operators" group or run as Administrator');
                    safeResolve(false);
                }
            });

            // Handle stdin errors
            ps.stdin.on('error', (error) => {
                this.logger.error(`Failed to write to PowerShell stdin: ${error.message}`);
                safeResolve(false);
            });

            // Write script to stdin and close
            ps.stdin.write(psScript);
            ps.stdin.end();
        });
    }
}
