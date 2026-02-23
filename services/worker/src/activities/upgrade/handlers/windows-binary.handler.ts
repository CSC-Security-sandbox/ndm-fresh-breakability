import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import * as path from 'path';
import * as AdmZip from 'adm-zip';
import { BaseBinaryHandler } from '../binary-handler.interface';
import { ExecuteUpgradeOutput } from '../../../workflows/upgrade/upgrade.types';

export class WindowsBinaryHandler extends BaseBinaryHandler {
  protected readonly platform = 'windows' as const;
  protected readonly archiveExtension = '.zip';
  protected readonly stagingBase = this.configService.get<string>('worker.upgrade.stagingDirWindows');

  protected async extractArchive(archivePath: string, destDir: string): Promise<void> {
    try { await fs.access(archivePath); } catch {
      throw new Error(`Archive not found: ${archivePath}`);
    }
    try {
      const zip = new AdmZip(archivePath);
      zip.extractAllTo(destDir, true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to extract zip archive ${archivePath}: ${msg}`);
    }
  }

  /**
   * Find binary matching: datamigrator-worker-windows-{version}.exe
   */
  protected getBinary(files: string[], version: string): string | undefined {
    const match = files.find((f) =>
      f.match(new RegExp(`^datamigrator-worker-windows-${version}\\.exe$`)),
    );
    if (!match) {
      this.logger.error(`Binary not found. Expected: datamigrator-worker-windows-${version}.exe. Available: ${files.join(', ')}`);
    }
    return match;
  }


  protected getEnvFile(files: string[], version: string): string | undefined {
    const match = files.find((f) =>
      f.match(new RegExp(`^datamigrator-worker-windows-${version}\\.env$`)),
    );
    if (!match) {
      this.logger.error(`Env file not found. Expected: datamigrator-worker-windows-${version}.env. Available: ${files.join(', ')}`);
    }
    return match;
  }

  protected getUpgradeScript(files: string[]): string | undefined {
    const match = files.find((f) => f === 'upgrade.ps1');
    if (!match) {
      this.logger.error(`Upgrade script not found. Expected: upgrade.ps1. Available: ${files.join(', ')}`);
    }
    return match;
  }

  async executeUpgrade(version: string, bundleId?: string): Promise<ExecuteUpgradeOutput> {
    const stagingDir = path.join(this.stagingBase, version);
    const scriptPath = path.join(stagingDir, 'upgrade.ps1');

    this.logger.log(`[executeUpgrade] platform=windows, scriptPath=${scriptPath}`);

    try { await fs.access(scriptPath); } catch {
      this.logger.error(`Upgrade script not found: ${scriptPath}`);
      return { status: 'failed', message: `Upgrade script not found: ${scriptPath}` };
    }

    this.logger.log(`[executeUpgrade] Script exists, spawning: ${scriptPath} -Version ${version}`);

    try {
      const baseDir = this.configService.get<string>('worker.upgrade.baseDirWindows');
      const outHandle = await fs.open(path.join(baseDir, 'upgrade-spawn.log'), 'a');
      const errHandle = await fs.open(path.join(baseDir, 'upgrade-spawn-err.log'), 'a');

      const child = spawn('cmd.exe', ['/c', 'start', '/b', 'powershell.exe',
        '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Version', version], {
        detached: true,
        stdio: ['ignore', outHandle.fd, errHandle.fd],
        windowsHide: true,
      });

      child.on('error', (err) => {
        this.logger.error(`[executeUpgrade] Spawn error: ${err.message}`);
      });

      child.unref();
      await outHandle.close();
      await errHandle.close();

      this.logger.log(`[executeUpgrade] Spawned PID ${child.pid}`);
      return { status: 'triggered', message: `Upgrade script spawned with PID ${child.pid}` };
    } catch (error: any) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[executeUpgrade] Failed to spawn: ${msg}`);
      return { status: 'failed', message: msg };
    }
  }

  protected getChecksumFile(files: string[], version: string): string | undefined {
    const match = files.find((f) =>
      f.match(new RegExp(`^datamigrator-worker-windows-${version}\\.sha256$`)),
    );
    if (!match) {
      this.logger.error(`Checksum file not found. Expected: datamigrator-worker-windows-${version}.sha256. Available: ${files.join(', ')}`);
    }
    return match;
  }
}
