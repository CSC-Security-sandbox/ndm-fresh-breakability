import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { BaseBinaryHandler } from '../binary-handler.interface';

const execFileAsync = promisify(execFile);

export class LinuxBinaryHandler extends BaseBinaryHandler {
  protected readonly platform = 'linux' as const;
  protected readonly archiveExtension = '.tar.gz';
  protected readonly stagingBase = '/opt/datamigrator/staging';

  protected async extractArchive(archivePath: string, destDir: string): Promise<void> {
    if (!fs.existsSync(archivePath)) {
      throw new Error(`Archive not found: ${archivePath}`);
    }
    try {
      await execFileAsync('tar', ['-xzf', archivePath, '-C', destDir]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to extract tar.gz archive ${archivePath}: ${msg}`);
    }
  }

  /**
   * Find binary matching: datamigrator-worker-linux-{version} (no extension)
   */
  protected findBinary(files: string[], version: string): string | undefined {
    const match = files.find((f) =>
      f.match(new RegExp(`^datamigrator-worker-linux-${version}$`)),
    );
    if (!match) {
      this.logger.error(`Binary not found. Expected: datamigrator-worker-linux-${version}. Available: ${files.join(', ')}`);
    }
    return match;
  }

  protected async makeExecutable(binaryPath: string): Promise<void> {
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Cannot make executable: file not found at ${binaryPath}`);
    }
    try {
      await execFileAsync('chmod', ['+x', binaryPath]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to chmod +x ${binaryPath}: ${msg}`);
    }
  }

  protected findEnvFile(files: string[], version: string): string | undefined {
    const match = files.find((f) =>
      f.match(new RegExp(`^datamigrator-worker-linux-${version}\\.env$`)),
    );
    if (!match) {
      this.logger.error(`Env file not found. Expected: datamigrator-worker-linux-${version}.env. Available: ${files.join(', ')}`);
    }
    return match;
  }

  protected findChecksumFile(files: string[], version: string): string | undefined {
    const match = files.find((f) =>
      f.match(new RegExp(`^datamigrator-worker-linux-${version}\\.sha256$`)),
    );
    if (!match) {
      this.logger.error(`Checksum file not found. Expected: datamigrator-worker-linux-${version}.sha256. Available: ${files.join(', ')}`);
    }
    return match;
  }
}
