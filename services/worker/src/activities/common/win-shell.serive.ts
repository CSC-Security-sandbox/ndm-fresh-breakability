import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { psBaseAclDefinition } from './powershell.script';

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
        if (process.platform !== 'win32') {
            this.onReady(false);
            return;
        }
        try {
            this.process = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', '-'], {
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe']
            });

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
            console.log(`✅ [PersistentShell:${this.id}] Ready`);
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

        const safeCmd = cmd.command.replace(/\r?\n/g, ' ');
        const wrapped = `Write-Host '${cmd.commandMarker}'; ${safeCmd}; Write-Host '${cmd.endMarker}'\r\n`;
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

    execute(command: string, timeout = 15000): Promise<ShellResult> {
        console.log(`➡️ [PersistentShell:${this.id}] Executing command: ${command}`);
        return new Promise((resolve, reject) => {
            const markerId = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
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
            this.processQueue();
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
    private maxQueuePerShell = 1;
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
        const maxRetries = 5;
        let attempts = 0;
        await new Promise<void>((resolve, reject) => {
            const tryCreate = () => {
                if (attempts++ > maxRetries) {
                    console.error(`Failed to create shell at ${id} after ${maxRetries} attempts`);
                    reject(new Error(`Shell creation failed for ${id}`));
                    return;
                }
                const shell = new PersistentShell(id, (success) => {
                    if (success) {
                        console.log(`✅ Created shell at ${id}`);
                        shell.on('exit', () => { console.log(`❌ [PersistentShell:${id}] Exited`); this.replaceShell(index, id); });
                        this.shells[index] = shell;
                        resolve();
                    } else {
                        shell.destroy();
                        setTimeout(tryCreate, 250);
                    }
                });
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
        await this.addShellAtIndex(index, `${id}-restart-${Date.now()}`);
    }

    private rrIndex = 0;

    private getOptimalShell(): PersistentShell {
        // Round-robin allocation
        const shell = this.shells[this.rrIndex % this.shells.length];
        this.rrIndex = (this.rrIndex + 1) % this.shells.length;
        return shell;
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