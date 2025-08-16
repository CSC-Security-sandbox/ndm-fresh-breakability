import { Inject, Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

interface ShellTask {
  command: string;
  resolve: (output: string) => void;
  reject: (error: Error) => void;
}

class ShellWorker {
  private shellProcess: ChildProcessWithoutNullStreams;
  private busy = false;

  constructor(
    private readonly shellCommand: string,
    private readonly args: string[],
    private readonly endMarker: string,
    private readonly markerCommand: string,
    private readonly logger: LoggerService,
    private readonly onIdle: () => void,
  ) {
    this.shellProcess = spawn(shellCommand, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.shellProcess.on('close', (code) => {
      this.logger.warn(`${shellCommand} process exited with code ${code}`);
    });

    this.shellProcess.stderr.on('data', (data: Buffer) => {
      this.logger.error(`stderr from ${shellCommand}: ${data.toString()}`);
    });
  }

  isIdle(): boolean {
    return !this.busy;
  }

  runTask(task: ShellTask) {
    if (this.busy) {
      throw new Error('Worker is busy.');
    }
    this.busy = true;
    let output = '';
    let error = '';
  
    const cleanListeners = () => {
      this.shellProcess.stdout.off('data', handleStdout);
      this.shellProcess.stderr.off('data', handleStderr);
    };
  
    const handleStdout = (data: Buffer) => {
      const text = data.toString();
      output += text;
      if (text.includes(this.endMarker)) {
        cleanListeners();
        this.busy = false;
        this.onIdle();
        task.resolve(output.replace(this.endMarker, '').trim());
      }
    };
  
    const handleStderr = (data: Buffer) => {
      error += data.toString();
      if (error) {
        cleanListeners();
        this.busy = false;
        this.onIdle();
        task.reject(new Error(error.trim()));
      }
    };
  
    this.shellProcess.stdout.setMaxListeners(100);
    this.shellProcess.stderr.setMaxListeners(100);
  
    this.shellProcess.stdout.on('data', handleStdout);
    this.shellProcess.stderr.on('data', handleStderr);
    this.shellProcess.stdin.write(`${task.command}\n${this.markerCommand}\n`);
  }
  

  shutdown() {
    this.shellProcess.stdin.end();
    this.shellProcess.kill();
  }
}

@Injectable()
export class ShellService implements OnModuleInit, OnModuleDestroy {
  private workers: ShellWorker[] = [];
  private taskQueue: ShellTask[] = [];
  private readonly poolSize = 5;
  private readonly isWindows: boolean;
  private readonly shellCommand: string;
  private readonly args: string[];
  private readonly endMarker = 'END_OF_COMMAND_OUTPUT';
  private readonly markerCommand: string;
  private readonly logger: LoggerService;

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory
  ) {
    this.isWindows = process.platform === 'win32';
    this.logger = loggerFactory.create(ShellService.name);

    if (this.isWindows) {
      this.shellCommand = 'powershell.exe';
      this.args = ['-Command', '-'];
      this.markerCommand = `Write-Output "${this.endMarker}"`;
    } else {
      this.shellCommand = 'bash';
      this.args = [];
      this.markerCommand = `echo "${this.endMarker}"`;
    }
  }

  onModuleInit() {
    this.logger.log(`Starting persistent ${this.shellCommand} processes...`);
    for (let i = 0; i < this.poolSize; i++) {
      const worker = new ShellWorker(
        this.shellCommand,
        this.args,
        this.endMarker,
        this.markerCommand,
        this.logger,
        () => this.scheduleQueue(), 
      );
      this.workers.push(worker);
    }
  }


  async runCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const task: ShellTask = { command, resolve, reject };
      this.taskQueue.push(task);
      this.scheduleQueue();
    });
  }


  private scheduleQueue() {
    while (this.taskQueue.length) {
      const worker = this.workers.find((w) => w.isIdle());
      if (!worker) {
        break; 
      }
      const task = this.taskQueue.shift();
      if (task) {
        worker.runTask(task);
      }
    }
  }

  onModuleDestroy() {
    this.logger.log(`Stopping persistent ${this.shellCommand} processes...`);
    this.workers.forEach((worker) => worker.shutdown());
  }
}
