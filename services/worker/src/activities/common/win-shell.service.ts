import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { psBaseAclDefinition, psEnableBackupPrivilegeScript } from '../core/migrate/command-execution/win-opeartions/powershell.script';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from 'src/metrics/metrics.service';

interface ShellResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    queueWaitMs: number;
}

interface QueuedCommand {
    command: string;
    resolve: (result: ShellResult) => void;
    reject: (error: Error) => void;
    timeout: number;
    timeoutId?: NodeJS.Timeout;
    commandMarker: string;
    endMarker: string;
    startTime?: number;
    queuedTime: number;
}

class PersistentShell extends EventEmitter {
    private process!: ChildProcess;
    private isReady = false;
    private currentCommand: QueuedCommand | null = null;
    private commandQueue: QueuedCommand[] = [];
    private outputBuffer = '';
    public readonly id: string;
    private runAsAdmin: boolean;
    private healthCheckFailures = 0;
    public lastHealthCheck = 0;
    public initializationTimeout = process.env.INIT_TIMEOUT ? parseInt(process.env.INIT_TIMEOUT, 10) : 7000;

    constructor(id: string, private onReady: (success: boolean) => void, runAsAdmin: boolean = true) {
        super();
        this.id = id;
        this.runAsAdmin = runAsAdmin;
        this.init();
    }

    private async init() {
        if (process.platform !== 'win32') {
            this.onReady(false);
            return;
        }
        try {
            if (this.runAsAdmin) {
                // For admin mode, we need to use a different approach
                // Note: This will require the parent process to already be running as admin
                // or will prompt for UAC elevation
                this.process = spawn('powershell.exe', [
                    '-NoLogo', 
                    '-NoProfile', 
                    '-ExecutionPolicy', 'Bypass',
                    '-Command', '-'
                ], {
                    windowsHide: true,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    shell: true,
                    windowsVerbatimArguments: false
                });
            } else {
                this.process = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', '-'], {
                    windowsHide: true,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    shell: true,
                    windowsVerbatimArguments: false
                });
            }

            this.process.stdout?.on('data', (data) => {
                this.outputBuffer += data.toString();
                if (!this.isReady) {
                    this.checkInitReady();
                } else {
                    this.checkCommandComplete();
                }
            });
            this.process.stderr?.on('data', (data) => {
                this.outputBuffer += data.toString();
                if (!this.isReady) {
                    this.checkInitReady();
                } else {
                    this.checkCommandComplete();
                }
            });
            this.process.on('exit', (code, signal) => {
                this.emit('exit', { code, signal });
                this.rejectAllPending(new Error(`Shell process exited (code=${code}, signal=${signal})`));
            });

            // Inject the script
            this.process.stdin?.write(psBaseAclDefinition + '\n');

            // Enable backup privileges in this powershell process
            const privilegeScript = this.getShellPrivilegeEnablementScript(this.id);
            this.process.stdin?.write(privilegeScript + '\n');
            
            // Check if privilege enablement succeeded by looking for error markers in output
            const privilegeCheckMarker = `__PRIV_CHECK_${this.id}__`;
            this.process.stdin?.write(`if ($LASTEXITCODE -ne 0) { Write-Host 'PRIVILEGE_ENABLEMENT_FAILED' }; Write-Host '${privilegeCheckMarker}'\r\n`);

            // Write a unique marker directly, not through the queue
            this.initMarker = `__READY_${Date.now()}_${Math.floor(Math.random() * 1e9)}__`;
            this.process.stdin?.write(`Write-Host '${this.initMarker}'\r\n`);
            // Set a timeout for readiness
            this.initTimeout = setTimeout(() => {
                if (!this.isReady) {
                    this.onReady(false);
                    this.emit('exit', { code: -1, signal: 'init timeout' });
                }
            }, 7000);
        } catch (err) {
            this.onReady(false);
        }
    }

    private initMarker: string = '';
    private initTimeout?: NodeJS.Timeout;

    private checkInitReady() {
        if (this.initMarker && this.outputBuffer.includes(this.initMarker)) {
            clearTimeout(this.initTimeout);
            this.isReady = true;
            console.log(`[PersistentShell:${this.id}] Ready`);
            this.onReady(true);
            // Clean outputBuffer up to marker
            const markerIdx = this.outputBuffer.indexOf(this.initMarker) + this.initMarker.length;
            this.outputBuffer = this.outputBuffer.substring(markerIdx);
            this.processQueue();
        }
    }

    private checkCommandComplete() {
        if (!this.currentCommand) return;
        const startIdx = this.outputBuffer.indexOf(this.currentCommand.commandMarker);
        const endIdx = this.outputBuffer.indexOf(this.currentCommand.endMarker, startIdx === -1 ? 0 : startIdx);

        if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return;

        const between = this.outputBuffer.substring(startIdx + this.currentCommand.commandMarker.length, endIdx);
        let cleaned = between.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');

        // Check for errors in the output
        const hasError = cleaned.includes('ERROR:') || cleaned.includes('Exception') || cleaned.includes('TerminatingError');
        let exitCode = 0;
        let stderr = '';
        let stdout = cleaned.trim();

        if (hasError) {
            console.error(`[PersistentShell:${this.id}] Command had errors: ${this.currentCommand.command.substring(0, 50)}...`);
            exitCode = 1;
            
            // Extract error message
            const errorMatch = cleaned.match(/ERROR:\s*(.+)/);
            if (errorMatch) {
                stderr = errorMatch[1];
                stdout = cleaned.replace(/ERROR:\s*.+/, '').trim();
            } else {
                stderr = 'Command execution error detected';
            }
        }

        const result: ShellResult = { 
            stdout: stdout, 
            stderr: stderr, 
            exitCode: exitCode,
            queueWaitMs: 0
        };
        
        // Clean the output buffer more aggressively to prevent state contamination
        this.outputBuffer = this.outputBuffer.substring(endIdx + this.currentCommand.endMarker.length);
        
        // Additional cleanup - remove any trailing PowerShell prompts or artifacts
        this.outputBuffer = this.outputBuffer.replace(/^PS\s+[^>]*>\s*/gm, '');

        const cmd = this.currentCommand;
        this.currentCommand = null;
        if (cmd.timeoutId) clearTimeout(cmd.timeoutId);

        // Calculate timing metrics
        const completionTime = Date.now();
        const waitTime = (cmd.startTime || cmd.queuedTime) - cmd.queuedTime;
        const executionTime = completionTime - (cmd.startTime || cmd.queuedTime);
        const totalTime = completionTime - cmd.queuedTime;
        result.queueWaitMs = waitTime;

        if (hasError) {
            console.debug(`[PersistentShell:${this.id}] Command failed in ${executionTime}ms (waited: ${waitTime}ms, total: ${totalTime}ms): ${cmd.command.substring(0, 50)}...`);
            console.error(`[PersistentShell:${this.id}] Error details: ${stderr}`);
        } else {
            console.debug(`[PersistentShell:${this.id}] Command completed in ${executionTime}ms (waited: ${waitTime}ms, total: ${totalTime}ms): ${cmd.command.substring(0, 50)}...`);
        }

        cmd.resolve(result);
        this.processQueue();
    }

    private processQueue() {
        if (!this.isReady || this.currentCommand || this.commandQueue.length === 0) return;

        const cmd = this.commandQueue.shift()!;
        this.currentCommand = cmd;
        cmd.startTime = Date.now();
        
        const waitTime = cmd.startTime - cmd.queuedTime;
        const isAclOperation = cmd.command.includes('Set-FileSecurityFast') || cmd.command.includes('$aclJson');
        
        console.debug(`[PersistentShell:${this.id}] Starting ${isAclOperation ? 'ACL operation' : 'command'} after ${waitTime}ms wait: ${cmd.command.substring(0, 50)}...`);
        
        const current = new Date();
        cmd.timeoutId = setTimeout(() => {
            if (this.currentCommand === cmd) {
                const executionTime = Date.now() - (cmd.startTime || cmd.queuedTime);
                console.debug(`[PersistentShell:${this.id}] ${isAclOperation ? 'ACL operation' : 'Command'} TIMEOUT after ${executionTime}ms: ${cmd.command.substring(0, 50)}...`);
                this.currentCommand = null;
                cmd.reject(new Error(`Command timeout: ${cmd.command}`));
                this.processQueue();
            }
        }, cmd.timeout);
        
        // Clear any potential state contamination and reset PowerShell variables
        const stateResetCmd = `
$ErrorActionPreference = 'Stop'
$Error.Clear()
Remove-Variable -Name * -Force -ErrorAction SilentlyContinue
[System.GC]::Collect()
`;
        
        // Wrap command with state isolation and error handling
        const wrapped = `
Write-Host '${cmd.commandMarker}'
try {
    ${stateResetCmd}
    ${cmd.command}
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    exit 1
} finally {
    $Error.Clear()
}
Write-Host '${cmd.endMarker}'
`;
        this.process.stdin?.write(wrapped + '\r\n');
    }

    private rejectAllPending(err: Error) {
        if (this.currentCommand) {
            try { this.currentCommand.reject(err); } catch { }
            this.currentCommand = null;
        }
        while (this.commandQueue.length) {
            const q = this.commandQueue.shift()!;
            try { q.reject(err); } catch { }
        }
    }

    execute(command: string, timeout = 150000): Promise<ShellResult> {
        // Detect ACL operations and increase timeout
        const isAclOperation = command.includes('Set-FileSecurityFast') || command.includes('$aclJson') || command.includes('Get-Acl') || command.includes('Set-Acl');
        const adjustedTimeout = isAclOperation ? Math.max(timeout, 60000) : timeout; // Minimum 60s for ACL operations
        
        console.debug(`[PersistentShell:${this.id}] Executing command${isAclOperation ? ' (ACL Operation)' : ''}: ${command}, extended timeout: ${adjustedTimeout}ms`);
        
        return new Promise((resolve, reject) => {
            const markerId = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
            const commandMarker = `__CMD_${markerId}__`;
            const endMarker = `__END_${markerId}__`;
            const queuedTime = Date.now();

            this.commandQueue.push({
                command,
                resolve,
                reject,
                timeout: adjustedTimeout,
                commandMarker,
                endMarker,
                queuedTime
            });
            this.processQueue();
        });
    }

    async performHealthCheck(): Promise<boolean> {
        if (!this.isReady) return false;
        
        try {
            const testCommand = 'Write-Host "HEALTH_CHECK_OK"';
            const result = await this.execute(testCommand, 5000);
            
            if (result.stdout.includes('HEALTH_CHECK_OK')) {
                this.healthCheckFailures = 0;
                this.lastHealthCheck = Date.now();
                return true;
            } else {
                this.healthCheckFailures++;
                console.error(`[PersistentShell:${this.id}] Health check failed (${this.healthCheckFailures}/3)`);
                return false;
            }
        } catch (error) {
            this.healthCheckFailures++;
            console.error(`[PersistentShell:${this.id}] Health check exception (${this.healthCheckFailures}/3): ${error}`);
            return false;
        }
    }

    private getShellPrivilegeEnablementScript(shellId: string): string {
  return `
Add-Type -TypeDefinition @"
${psEnableBackupPrivilegeScript}
"@

try {
    $backupResult = [TokenManipulator]::EnablePrivilege("SeBackupPrivilege")
    $restoreResult = [TokenManipulator]::EnablePrivilege("SeRestorePrivilege")
    
    Write-Host "[Shell:${shellId}] SeBackupPrivilege: $backupResult"
    Write-Host "[Shell:${shellId}] SeRestorePrivilege: $restoreResult"
    
    if ($backupResult -like "*SUCCESS*" -and $restoreResult -like "*SUCCESS*") {
        Write-Host "[Shell:${shellId}] Backup privileges enabled"
    } else {
        Write-Host "[Shell:${shellId}] Warning: Failed to enable some privileges"
    }
} catch {
    Write-Host "[Shell:${shellId}] Warning: Privilege error: $($_.Exception.Message)"
}
`;
}

    needsRecreation(): boolean {
        return this.healthCheckFailures >= 3;
    }

    isAvailable(): boolean {
        return this.isReady && !this.currentCommand;
    }

    destroy() {
        this.rejectAllPending(new Error('Shell destroyed'));
        try { this.process.kill(); } catch { }
    }

    getQueueLength(): number {
        return this.commandQueue.length + (this.currentCommand ? 1 : 0);
    }
}

@Injectable()
export class WinShellService implements OnModuleInit, OnModuleDestroy {
    private shells: PersistentShell[] = [];
    private shellMonitoringInterval: number;
    private enableShellMonitoring: boolean;
    private poolSize: number;
    private maxQueuePerShell: number;
    private dropWhenFull = false;
    private totalExecuted = 0;
    private totalErrors = 0;
    private monitoringInterval?: NodeJS.Timeout;
    private executionTimes: number[] = [];
    private slowCommandThreshold: number;
    private runAsAdmin: boolean; // Set to true if you need admin privileges
    private readonly logger: LoggerService;

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
        private readonly metricsService: MetricsService,
    ) {
        this.shellMonitoringInterval = this.configService.get('shellMonitoring.shellMonitoringInterval');
        this.enableShellMonitoring = this.configService.get('shellMonitoring.enableShellMonitoring');
        this.poolSize = this.configService.get('shellMonitoring.poolSize');
        this.maxQueuePerShell = this.configService.get('shellMonitoring.maxQueuePerShell');
        this.slowCommandThreshold = this.configService.get('shellMonitoring.slowCommandThreshold');
        this.runAsAdmin = this.configService.get('shellMonitoring.runAsAdmin');
        this.logger = loggerFactory.create(WinShellService.name);
      }

    async onModuleInit() {
        if(process.platform === 'win32') {
            await this.initializePool();
            if (this.enableShellMonitoring) {
                this.startShellMonitoring();
            }
        }
    }

    private async initializePool() {
        this.shells = new Array(this.poolSize);

        for (let i = 0; i < this.poolSize; i++) {
            await this.addShellAtIndex(i, `shell-${i}`);
        }
    }

    private async addShellAtIndex(index: number, id: string) {
        const maxRetries = 5;
        let attempts = 0;
        await new Promise<void>((resolve, reject) => {
            const tryCreate = () => {
                if (attempts++ > maxRetries) {
                    this.logger.error(`Failed to create shell at ${id} after ${maxRetries} attempts`);
                    reject(new Error(`Shell creation failed for ${id}`));
                    return;
                }
                const shell = new PersistentShell(id, (success) => {
                    if (success) {
                        this.logger.debug(`Created shell at ${id}${this.runAsAdmin ? ' (Admin Mode)' : ''}`);
                        shell.on('exit', () => { this.logger.debug(`[PersistentShell:${id}] Exited`); this.replaceShell(index, id); });
                        this.shells[index] = shell;
                        resolve();
                    } else {
                        shell.destroy();
                        setTimeout(tryCreate, 250);
                    }
                }, this.runAsAdmin);
                shell.once('exit', () => {
                    if (!shell.isAvailable()) {
                        shell.destroy();
                        setTimeout(tryCreate, 250);
                    }
                });
            };
            tryCreate();
        });
    }

    private async replaceShell(index: number, id: string) {
        this.metricsService.recordShellError('', 'shell_restart');
        await this.addShellAtIndex(index, `${id}-restart-${Date.now()}`);
    }

    private rrIndex = 0;

    private getOptimalShell(): PersistentShell {
        // Round-robin allocation
        const shell = this.shells[this.rrIndex % this.shells.length];
        this.rrIndex = (this.rrIndex + 1) % this.shells.length;
        return shell;
    }

    async executeCommand(command: string, workflowId = '', timeout = 20000): Promise<{ stdout: string; stderr: string }> {
        const target = await this.getHealthyShell();
        const startTime = Date.now();

        // Detect ACL operations and adjust timeout
        const isAclOperation = command.includes('Set-FileSecurityFast') || command.includes('$aclJson') || command.includes('Get-Acl') || command.includes('Set-Acl');
        const adjustedTimeout = isAclOperation ? Math.max(timeout, 90000) : timeout; // Minimum 90s for ACL operations

        if (target.getQueueLength() >= this.maxQueuePerShell) {
            if (this.dropWhenFull) {
                this.totalErrors++;
                this.metricsService.recordShellError(workflowId, 'queue_full');
                throw new Error('Target shell queue full - dropped');
            } else {
                await new Promise(r => setTimeout(r, 5));
            }
        }

        try {
            if (isAclOperation)
                this.logger.debug(`[WinShellService] Starting ACL operation (timeout: ${adjustedTimeout}ms): ${command.substring(0, 100)}...`);

            const res = await target.execute(command, adjustedTimeout);
            const executionTime = Date.now() - startTime;

            // Record accurate shell queue wait time from PersistentShell internal tracking
            this.metricsService.recordShellQueueWait(workflowId, res.queueWaitMs / 1000);

            // Track execution time
            this.executionTimes.push(executionTime);
            // Keep only last 100 execution times for statistics
            if (this.executionTimes.length > 100) {
                this.executionTimes.shift();
            }
            
            // Check for errors in the result
            if (res.exitCode !== 0 || res.stderr) {
                this.totalErrors++;
                this.metricsService.recordShellError(workflowId, 'command_failed');
                this.logger.error(`[WinShellService] ${isAclOperation ? 'ACL operation' : 'Command'} failed after ${executionTime}ms: ${command.substring(0, 50)}...`);
                this.logger.error(`[WinShellService] Error: ${res.stderr || 'Exit code: ' + res.exitCode}`);

                // If it's a shell-related error, mark shell for health check
                if (res.stderr.includes('pipeline') || res.stderr.includes('session') || res.stderr.includes('terminated')) {
                    this.logger.debug(`[WinShellService] Scheduling health check for shell due to error`);
                    this.scheduleHealthCheck(target);
                }
                
                throw new Error(`Command failed: ${res.stderr || 'Exit code: ' + res.exitCode}`);
            } else {
                this.totalExecuted++;
                
                // Log slow commands with different thresholds for ACL operations
                const slowThreshold = isAclOperation ? 30000 : this.slowCommandThreshold; // 30s for ACL operations
                if (executionTime > slowThreshold) {
                    this.logger.debug(`[WinShellService] SLOW ${isAclOperation ? 'ACL' : 'COMMAND'} detected (${executionTime}ms): ${command.substring(0, 100)}...`);
                } else {
                    this.logger.debug(`[WinShellService] ${isAclOperation ? 'ACL operation' : 'Command'} completed in ${executionTime}ms: ${command.substring(0, 50)}...`);
                }
            }
            
            return { stdout: res.stdout, stderr: res.stderr };
        } catch (err) {
            const executionTime = Date.now() - startTime;
            this.logger.error(`[WinShellService] ${isAclOperation ? 'ACL operation' : 'Command'} failed after ${executionTime}ms: ${command.substring(0, 50)}...`);
            this.totalErrors++;
            // Detect timeout errors and record separately
            if (err.message?.includes('Command timeout')) {
                this.metricsService.recordShellTimeout(workflowId);
            }
            throw err;
        }
    }

    private async getHealthyShell(): Promise<PersistentShell> {
        // Try to get the optimal shell
        let target = this.getOptimalShell();
        
        // Check if the shell needs a health check (every 5 minutes or after errors)
        const now = Date.now();
        if (now - target.lastHealthCheck > 300000) { // 5 minutes
            const isHealthy = await target.performHealthCheck();
            if (!isHealthy && target.needsRecreation()) {
                this.logger.debug(`[WinShellService] Recreating unhealthy shell: ${target.id}`);
                const shellIndex = this.shells.findIndex(s => s === target);
                if (shellIndex !== -1) {
                    target.destroy();
                    await this.addShellAtIndex(shellIndex, `shell-${shellIndex}-health-${Date.now()}`);
                    target = this.shells[shellIndex];
                }
            }
        }
        
        return target;
    }

    private scheduleHealthCheck(shell: PersistentShell) {
        // Schedule a health check for the next available moment
        setTimeout(async () => {
            if (shell.isAvailable()) {
                await shell.performHealthCheck();
                if (shell.needsRecreation()) {
                    const shellIndex = this.shells.findIndex(s => s === shell);
                    if (shellIndex !== -1) {
                        this.logger.debug(`[WinShellService] Recreating shell due to health check failure`);
                        shell.destroy();
                        await this.addShellAtIndex(shellIndex, `shell-${shellIndex}-scheduled-${Date.now()}`);
                    }
                }
            }
        }, 1000);
    }



    async getOptimalShellForAcl(): Promise<PersistentShell> {
        // Get the shell with the least queue for ACL operations
        let optimalShell = this.shells[0];
        let minQueueLength = optimalShell.getQueueLength();
        
        for (const shell of this.shells) {
            const queueLength = shell.getQueueLength();
            if (queueLength < minQueueLength && shell.isAvailable()) {
                optimalShell = shell;
                minQueueLength = queueLength;
            }
        }
        
        // If all shells are busy, wait for one to become available
        if (!optimalShell.isAvailable()) {
            this.logger.debug(`[WinShellService] All shells busy, waiting for ACL operation...`);
            return new Promise((resolve) => {
                const checkInterval = setInterval(() => {
                    for (const shell of this.shells) {
                        if (shell.isAvailable()) {
                            clearInterval(checkInterval);
                            resolve(shell);
                            return;
                        }
                    }
                }, 100);
            });
        }
        
        return optimalShell;
    }

    // Enhanced monitoring with ACL-specific metrics
    private startShellMonitoring() {
        this.monitoringInterval = setInterval(() => {
            const readyShells = this.shells.filter(shell => shell.isAvailable()).length;
            const totalShells = this.shells.length;
            const busyShells = totalShells - readyShells;
            
            this.logger.debug(`[Shell Monitor] Ready for execution: ${readyShells}/${totalShells} shells | Busy: ${busyShells} shells`);
            
            // Additional detailed stats
            const stats = this.getStats();
            const queuedCommands = stats.queues.reduce((sum, queue) => sum + queue.queueLength, 0);

            // Record shell pool status to Prometheus
            this.metricsService.recordShellPoolStatus(readyShells, busyShells, queuedCommands);
            
            // Calculate execution time statistics
            let avgTime = 0;
            let minTime = 0;
            let maxTime = 0;
            let aclOperations = 0;
            let slowAclOperations = 0;
            
            if (this.executionTimes.length > 0) {
                avgTime = Math.round(this.executionTimes.reduce((sum, time) => sum + time, 0) / this.executionTimes.length);
                minTime = Math.min(...this.executionTimes);
                maxTime = Math.max(...this.executionTimes);
                
                // Count ACL operations (approximation based on longer execution times)
                aclOperations = this.executionTimes.filter(time => time > 10000).length; // > 10s likely ACL ops
                slowAclOperations = this.executionTimes.filter(time => time > 30000).length; // > 30s very slow ACL ops
            }
            
            this.logger.debug(`[Shell Stats] Total executed: ${this.totalExecuted} | Errors: ${this.totalErrors} | Queued commands: ${queuedCommands}`);
            this.logger.debug(`[Timing Stats] Avg: ${avgTime}ms | Min: ${minTime}ms | Max: ${maxTime}ms | Samples: ${this.executionTimes.length}`);
            this.logger.debug(`[ACL Stats] Estimated ACL ops: ${aclOperations} | Slow ACL ops (>30s): ${slowAclOperations}`);
        }, this.shellMonitoringInterval); // Every 3 seconds
    }

    // Performance analysis method
    getAclPerformanceAnalysis() {
        if (this.executionTimes.length === 0) {
            return {
                totalOperations: 0,
                avgTime: 0,
                estimatedAclOps: 0,
                slowAclOps: 0,
                performanceRating: 'No data'
            };
        }

        const avgTime = Math.round(this.executionTimes.reduce((sum, time) => sum + time, 0) / this.executionTimes.length);
        const estimatedAclOps = this.executionTimes.filter(time => time > 10000).length;
        const slowAclOps = this.executionTimes.filter(time => time > 30000).length;
        const verySlowAclOps = this.executionTimes.filter(time => time > 60000).length;
        
        let performanceRating = 'Excellent';
        if (avgTime > 30000) performanceRating = 'Poor';
        else if (avgTime > 15000) performanceRating = 'Fair';
        else if (avgTime > 5000) performanceRating = 'Good';

        return {
            totalOperations: this.totalExecuted,
            totalErrors: this.totalErrors,
            avgTime,
            estimatedAclOps,
            slowAclOps,
            verySlowAclOps,
            performanceRating,
            successRate: this.totalExecuted / (this.totalExecuted + this.totalErrors) * 100,
            recommendations: this.generatePerformanceRecommendations(avgTime, slowAclOps, verySlowAclOps)
        };
    }

    private generatePerformanceRecommendations(avgTime: number, slowOps: number, verySlowOps: number): string[] {
        const recommendations: string[] = [];
        
        if (avgTime > 30000) {
            recommendations.push('Consider using batch ACL operations for multiple files');
            recommendations.push('Check network connectivity for mounted drives');
        }
        
        if (slowOps > 5) {
            recommendations.push('Use executeNetworkAclCommand for network paths');
            recommendations.push('Consider increasing pool size for high ACL workloads');
        }
        
        if (verySlowOps > 2) {
            recommendations.push('Investigate file system performance on target paths');
            recommendations.push('Consider pre-validating file accessibility');
        }
        
        if (recommendations.length === 0) {
            recommendations.push('Performance is optimal');
        }
        
        return recommendations;
    }

    getStats() {
        const queues = this.shells.map((s, i) => ({ shellId: i, queueLength: s.getQueueLength(), available: s.isAvailable() }));
        const successRate = (this.totalExecuted + this.totalErrors) === 0
            ? 100
            : (this.totalExecuted / (this.totalExecuted + this.totalErrors) * 100);

        return { poolSize: this.poolSize, totalExecuted: this.totalExecuted, totalErrors: this.totalErrors, successRate, queues };
    }

    getExecutionTimeStats() {
        if (this.executionTimes.length === 0) {
            return { avgTime: 0, minTime: 0, maxTime: 0, samples: 0, slowCommands: 0 };
        }

        const avgTime = Math.round(this.executionTimes.reduce((sum, time) => sum + time, 0) / this.executionTimes.length);
        const minTime = Math.min(...this.executionTimes);
        const maxTime = Math.max(...this.executionTimes);
        const slowCommands = this.executionTimes.filter(time => time > this.slowCommandThreshold).length;

        return {
            avgTime,
            minTime,
            maxTime,
            samples: this.executionTimes.length,
            slowCommands,
            slowCommandThreshold: this.slowCommandThreshold
        };
    }


    // Method to execute command in a fresh shell (for comparison/debugging)
    async executeInFreshShell(command: string, timeout = 20000): Promise<{ stdout: string; stderr: string }> {
        this.logger.debug(`[WinShellService] Executing in fresh shell: ${command.substring(0, 100)}...`);
        
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const process = spawn('powershell.exe', [
                '-NoLogo', 
                '-NoProfile', 
                '-ExecutionPolicy', 'Bypass',
                '-Command', command
            ], {
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: true,
                windowsVerbatimArguments: false
            });

            let stdout = '';
            let stderr = '';

            process.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            process.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('exit', (code) => {
                const executionTime = Date.now() - startTime;
                this.logger.debug(`[WinShellService] Fresh shell completed in ${executionTime}ms with exit code: ${code}`);
                resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
            });

            process.on('error', (error) => {
                const executionTime = Date.now() - startTime;
                this.logger.error(`[WinShellService] Fresh shell error after ${executionTime}ms: ${error.message}`);
                reject(error);
            });

            // Set timeout
            const timeoutId = setTimeout(() => {
                this.logger.error(`[WinShellService] Fresh shell timeout after ${timeout}ms`);
                process.kill();
                reject(new Error(`Fresh shell timeout: ${command}`));
            }, timeout);

            process.on('exit', () => {
                clearTimeout(timeoutId);
            });
        });
    }

    setAdminMode(enabled: boolean) {
        this.runAsAdmin = enabled;
        this.logger.log(`[WinShellService] Admin mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
    }

    isAdminModeEnabled(): boolean {
        return this.runAsAdmin;
    }

    async onModuleDestroy() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = undefined;
        }
        await Promise.all(this.shells.map(async (shell) => {
            try { shell.destroy(); } catch { }
        }));
    }
}