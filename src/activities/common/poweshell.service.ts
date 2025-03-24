import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

@Injectable()
export class PowerShellService implements OnModuleInit, OnModuleDestroy {
  private ps: ChildProcessWithoutNullStreams | null = null;
  private isWindows: boolean;
  private readonly END_MARKER = 'END_OF_COMMAND_OUTPUT';

  constructor(private readonly logger: Logger) {
    this.isWindows = process.platform === 'win32';
  }

  onModuleInit() {
    if (!this.isWindows) {
      this.logger.warn('PowerShell service is only supported on Windows.');
      return;
    }

    this.logger.log('Starting persistent PowerShell process...');
    this.ps = spawn('powershell.exe', ['-Command', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.ps.on('close', (code) => {
      this.logger.warn(`PowerShell process exited with code ${code}`);
    });
  }

  async runCommand(command: string): Promise<string> {
    if (!this.isWindows || !this.ps) {
      throw new Error('PowerShell is only supported on Windows.');
    }

    return new Promise((resolve, reject) => {
      let output = '';
      let error = '';

      const handleOutput = (data: Buffer) => {
        const text = data.toString();
        output += text;

        if (text.includes(this.END_MARKER)) {
          this.ps?.stdout?.off('data', handleOutput);
          this.ps?.stderr?.off('data', handleError);
          resolve(output.replace(this.END_MARKER, '').trim());
        }
      };

      const handleError = (data: Buffer) => {
        error += data.toString();
        if (error) {
          this.ps?.stdout?.off('data', handleOutput);
          this.ps?.stderr?.off('data', handleError);
          reject(new Error(`PowerShell Error: ${error.trim()}`));
        }
      };

      this.ps.stdout.on('data', handleOutput);
      this.ps.stderr.on('data', handleError);
      this.ps.stdin.write(`${command}\nWrite-Output "${this.END_MARKER}"\n`);
    });
  }

  onModuleDestroy() {
    if (!this.isWindows || !this.ps) return;

    this.logger.log('Stopping PowerShell process...');
    this.ps.stdin.end();
    this.ps.kill();
  }
}
