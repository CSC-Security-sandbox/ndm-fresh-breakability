import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { BaseBinaryHandler } from '../binary-handler.interface';

const execFileAsync = promisify(execFile);

export class WindowsBinaryHandler extends BaseBinaryHandler {
  protected readonly platform = 'windows' as const;
  protected readonly archiveExtension = '.zip';
  protected readonly stagingBase = 'C:\\datamigrator\\staging';

  protected async extractArchive(archivePath: string, destDir: string): Promise<void> {
    if (!fs.existsSync(archivePath)) {
      throw new Error(`Archive not found: ${archivePath}`);
    }
    try {
      await execFileAsync('tar', ['-xf', archivePath, '-C', destDir]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to extract zip archive ${archivePath}: ${msg}`);
    }
  }

  /**
   * Find binary matching: datamigrator-worker-windows-{version}.exe
   */
  protected findBinary(files: string[], version: string): string | undefined {
    const match = files.find((f) =>
      f.match(new RegExp(`^datamigrator-worker-windows-${version}\\.exe$`)),
    );
    if (!match) {
      this.logger.error(`Binary not found. Expected: datamigrator-worker-windows-${version}.exe. Available: ${files.join(', ')}`);
    }
    return match;
  }

  protected async makeExecutable(binaryPath: string): Promise<void> {
    // No-op on Windows — exe files are executable by default
  }

  protected findEnvFile(files: string[], version: string): string | undefined {
    const match = files.find((f) =>
      f.match(new RegExp(`^datamigrator-worker-windows-${version}\\.env$`)),
    );
    if (!match) {
      this.logger.error(`Env file not found. Expected: datamigrator-worker-windows-${version}.env. Available: ${files.join(', ')}`);
    }
    return match;
  }

  protected findChecksumFile(files: string[], version: string): string | undefined {
    const match = files.find((f) =>
      f.match(new RegExp(`^datamigrator-worker-windows-${version}\\.sha256$`)),
    );
    if (!match) {
      this.logger.error(`Checksum file not found. Expected: datamigrator-worker-windows-${version}.sha256. Available: ${files.join(', ')}`);
    }
    return match;
  }
}
