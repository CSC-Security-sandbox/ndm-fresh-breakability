import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { psBaseAclDefinition } from '../core/migrate/command-execution/aclOperations/powershell.script';

interface ShellResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

interface QueuedCommand {
    command: string;
    resolve: (result: ShellResult) => void;
    reject: (error: Error) => void;
    timeout: number;
    timeoutId?: NodeJS.Timeout;
    commandMarker: string;
    endMarker: string;
}


class PersistentShell extends EventEmitter {
    private process!: ChildProcess;
    private isReady = false;
    private currentCommand: QueuedCommand | null = null;
    private commandQueue: QueuedCommand[] = [];
    private outputBuffer = '';
    private readonly id: string;

    constructor(id: string, private onReady: (success: boolean) => void) {
        super();
        this.id = id;
        this.init();
    }

    private async init() {
        if (process.platform === 'win32') {
            this.process = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', '-'], {
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this.process.stdout?.on('data', (data) => {
                this.outputBuffer += data.toString();
                this.checkCommandComplete();
            });
            this.process.stderr?.on('data', (data) => {
                this.outputBuffer += data.toString();
                this.checkCommandComplete();
            });

            this.process.on('exit', (code, signal) => {
                this.emit('exit', { code, signal });
                this.rejectAllPending(new Error(`Shell process exited (code=${code}, signal=${signal})`));
            });

            // Inject the script and validate with an echo
            setTimeout(async () => {
                try {
                    // Inject the script
                    this.process.stdin?.write(psBaseAclDefinition + '\n');
                    // Validate by echoing a unique string
                    const marker = `__READY_${Date.now()}_${Math.floor(Math.random() * 1e9)}__`;
                    const echoCmd = `Write-Host '${marker}'\r\n`;
                    const result = await this.execute(``, 5000, true, marker); // Only run echo, script already loaded

                    if ((result.stdout || '').includes(marker)) {
                        this.isReady = true;
                        this.onReady(true);
                        this.processQueue();
                    } else {
                        this.isReady = false;
                        this.onReady(false);
                        this.emit('exit', { code: -1, signal: 'init fail' });
                    }
                } catch {
                    this.isReady = false;
                    this.onReady(false);
                    this.emit('exit', { code: -1, signal: 'init error' });
                }
            }, 120);
        }
    }

    private checkCommandComplete() {
        if (!this.currentCommand) return;

        const startIdx = this.outputBuffer.indexOf(this.currentCommand.commandMarker);
        const endIdx = this.outputBuffer.indexOf(this.currentCommand.endMarker, startIdx === -1 ? 0 : startIdx);

        if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return;

        const between = this.outputBuffer.substring(startIdx + this.currentCommand.commandMarker.length, endIdx);
        let cleaned = between.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');

        const result: ShellResult = { stdout: cleaned.trim(), stderr: '', exitCode: 0 };
        this.outputBuffer = this.outputBuffer.substring(endIdx + this.currentCommand.endMarker.length);

        const cmd = this.currentCommand;
        this.currentCommand = null;
        if (cmd.timeoutId) clearTimeout(cmd.timeoutId);

        cmd.resolve(result);
        this.processQueue();
    }

    private processQueue() {
        if (!this.isReady || this.currentCommand || this.commandQueue.length === 0) return;

        const cmd = this.commandQueue.shift()!;
        this.currentCommand = cmd;

        cmd.timeoutId = setTimeout(() => {
            if (this.currentCommand === cmd) {
                this.currentCommand = null;
                cmd.reject(new Error(`Command timeout: ${cmd.command}`));
                this.processQueue();
            }
        }, cmd.timeout);

        let wrapped;
        if (cmd.commandMarker.startsWith('__READY_')) {
            // For the echo validation, just write the echo wrapped in marker
            wrapped = `Write-Host '${cmd.commandMarker}'; Write-Host '${cmd.commandMarker}'; Write-Host '${cmd.endMarker}'\r\n`;
        } else {
            const safeCmd = cmd.command.replace(/\r?\n/g, ' ');
            wrapped = `Write-Host '${cmd.commandMarker}'; ${safeCmd}; Write-Host '${cmd.endMarker}'\r\n`;
        }
        this.process.stdin?.write(wrapped);
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

    execute(command: string, timeout = 15000, internal = false, customMarker?: string): Promise<ShellResult> {
        return new Promise((resolve, reject) => {
            const markerId = customMarker ? customMarker : `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
            const commandMarker = `__CMD_${markerId}__`;
            const endMarker = `__END_${markerId}__`;

            this.commandQueue.push({
                command,
                resolve,
                reject,
                timeout,
                commandMarker,
                endMarker
            });
            if (internal) {
                if (!this.currentCommand) this.processQueue();
            } else {
                this.processQueue();
            }
        });
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
    private poolSize = 10;
    private maxQueuePerShell = 500;
    private dropWhenFull = false;
    private totalExecuted = 0;
    private totalErrors = 0;

    async onModuleInit() {
        await this.initializePool();
    }

    private async initializePool() {
        this.shells = new Array(this.poolSize);

        for (let i = 0; i < this.poolSize; i++) {
            await this.addShellAtIndex(i, `shell-${i}`);
        }
    }

    private async addShellAtIndex(index: number, id: string) {
        await new Promise<void>((resolve) => {
            const tryCreate = () => {
                const shell = new PersistentShell(id, (success) => {
                    if (success) {
                        shell.on('exit', () => this.replaceShell(index, id));
                        this.shells[index] = shell;
                        resolve();
                    } else {
                        shell.destroy();
                        setTimeout(tryCreate, 250); // retry after short delay
                    }
                });
            };
            tryCreate();
        });
    }

    private async replaceShell(index: number, id: string) {
        await this.addShellAtIndex(index, `${id}-restart-${Date.now()}`);
    }

    private getOptimalShell(): PersistentShell {
        let best = this.shells[0];
        let min = best.getQueueLength();
        for (const s of this.shells) {
            const q = s.getQueueLength();
            if (q < min) { min = q; best = s; }
        }
        return best;
    }

    async executeCommand(command: string, timeout = 10000): Promise<{ stdout: string; stderr: string }> {
        const target = this.getOptimalShell();

        if (target.getQueueLength() >= this.maxQueuePerShell) {
            if (this.dropWhenFull) {
                this.totalErrors++;
                throw new Error('Target shell queue full - dropped');
            } else {
                await new Promise(r => setTimeout(r, 5));
            }
        }

        try {
            const res = await target.execute(command, timeout);
            this.totalExecuted++;
            return { stdout: res.stdout, stderr: res.stderr };
        } catch (err) {
            this.totalErrors++;
            throw err;
        }
    }

    getStats() {
        const queues = this.shells.map((s, i) => ({ shellId: i, queueLength: s.getQueueLength(), available: s.isAvailable() }));
        const successRate = (this.totalExecuted + this.totalErrors) === 0
            ? 100
            : (this.totalExecuted / (this.totalExecuted + this.totalErrors) * 100);

        return { poolSize: this.poolSize, totalExecuted: this.totalExecuted, totalErrors: this.totalErrors, successRate, queues };
    }

    async onModuleDestroy() {
        await Promise.all(this.shells.map(async (shell) => {
            try { shell.destroy(); } catch { }
        }));
    }
}