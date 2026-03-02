import * as fs from 'fs/promises';
import { exec } from 'child_process';
import * as path from 'path';
import * as tar from 'tar';
import { BaseBinaryHandler } from '../binary-handler.interface';
import { ExecuteUpgradeOutput } from '../../../workflows/upgrade/upgrade.types';

export class LinuxBinaryHandler extends BaseBinaryHandler {
  protected readonly platform = 'linux' as const;
  protected readonly archiveExtension = '.tar.gz';
  protected readonly stagingBase = this.configService.get<string>('worker.upgrade.stagingDirLinux');

  protected async extractArchive(archivePath: string, destDir: string): Promise<void> {
    try { await fs.access(archivePath); } catch {
      throw new Error(`Archive not found: ${archivePath}`);
    }
    try {
      await tar.extract({ file: archivePath, cwd: destDir });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to extract tar.gz archive ${archivePath}: ${msg}`);
    }
  }

  /**
   * Find binary matching: datamigrator-worker-linux-{version} (no extension)
   */
  protected getBinary(files: string[], version: string): string | undefined {
    const match = files.find((f) =>
      f.match(new RegExp(`^datamigrator-worker-linux-${version}$`)),
    );
    if (!match) {
      this.logger.error(`Binary not found. Expected: datamigrator-worker-linux-${version}. Available: ${files.join(', ')}`);
    }
    return match;
  }

  protected getEnvFile(files: string[], version: string): string | undefined {
    const match = files.find((f) =>
      f.match(new RegExp(`^datamigrator-worker-linux-${version}\\.env$`)),
    );
    if (!match) {
      this.logger.error(`Env file not found. Expected: datamigrator-worker-linux-${version}.env. Available: ${files.join(', ')}`);
    }
    return match;
  }

  protected getUpgradeScript(files: string[]): string | undefined {
    const match = files.find((f) => f === 'upgrade.sh');
    if (!match) {
      this.logger.error(`Upgrade script not found. Expected: upgrade.sh. Available: ${files.join(', ')}`);
    }
    return match;
  }

  async executeUpgrade(version: string, bundleId?: string): Promise<ExecuteUpgradeOutput> {
    const stagingDir = path.join(this.stagingBase, version);
    const scriptPath = path.join(stagingDir, 'upgrade.sh');

    this.logger.log(`[executeUpgrade] platform=linux, scriptPath=${scriptPath}`);

    try { await fs.access(scriptPath); } catch {
      this.logger.error(`Upgrade script not found: ${scriptPath}`);
      return { status: 'failed', message: `Upgrade script not found: ${scriptPath}` };
    }

    this.logger.log(`[executeUpgrade] Script exists, launching via systemd-run: ${scriptPath} ${version}`);

    try {
      const baseDir = this.configService.get<string>('worker.upgrade.baseDirLinux');
      const logFile = path.join(baseDir, 'upgrade-spawn.log');

      // systemd-run launches upgrade.sh in its own transient systemd unit/cgroup.
      // The worker runs as datamigrator-worker.service — systemd's default
      // KillMode=control-group kills ALL processes in the service's cgroup on stop.
      // upgrade.sh calls "systemctl stop datamigrator-worker", which would kill
      // itself if it stayed in the worker's cgroup. systemd-run avoids this.
      // Monitor via: systemctl status ndm-worker-upgrade
      const cmd =
        `systemctl reset-failed ndm-worker-upgrade 2>/dev/null; ` +
        `systemctl stop ndm-worker-upgrade 2>/dev/null; ` +
        `systemd-run --unit=ndm-worker-upgrade --remain-after-exit ` +
        `bash -c '${scriptPath} ${version} >> ${logFile} 2>&1'`;

      this.logger.log(`[executeUpgrade] Running: ${cmd}`);

      return new Promise<ExecuteUpgradeOutput>((resolve) => {
        exec(cmd, (error, stdout, stderr) => {
          if (error) {
            const msg = `${error.message} ${stderr}`.trim();
            this.logger.error(`[executeUpgrade] Failed to spawn: ${msg}`);
            resolve({ status: 'failed', message: msg });
          } else {
            this.logger.log(`[executeUpgrade] Launched as ndm-worker-upgrade.service: ${stdout.trim()}`);
            resolve({ status: 'triggered', message: 'Upgrade script launched as ndm-worker-upgrade.service' });
          }
        });
      });
    } catch (error: any) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[executeUpgrade] Failed to spawn: ${msg}`);
      return { status: 'failed', message: msg };
    }
  }

  protected getChecksumFile(files: string[], version: string): string | undefined {
    const match = files.find((f) =>
      f.match(new RegExp(`^datamigrator-worker-linux-${version}\\.sha256$`)),
    );
    if (!match) {
      this.logger.error(`Checksum file not found. Expected: datamigrator-worker-linux-${version}.sha256. Available: ${files.join(', ')}`);
    }
    return match;
  }
}
