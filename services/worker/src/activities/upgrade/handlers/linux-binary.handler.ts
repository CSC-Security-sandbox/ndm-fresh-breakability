/**
 * Linux Binary Handler
 * 
 * Extends BaseBinaryHandler with Linux-specific behavior:
 *   - extractArchive: tar -xzf (.tar.gz)
 *   - findBinary: file without .exe extension
 *   - makeExecutable: chmod +x
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { BaseBinaryHandler } from '../binary-handler.interface';

const execFileAsync = promisify(execFile);

export class LinuxBinaryHandler extends BaseBinaryHandler {
  protected readonly platform = 'linux' as const;
  protected readonly archiveExtension = '.tar.gz';
  protected readonly stagingBase = '/opt/datamigrator/staging';

  protected async extractArchive(archivePath: string, destDir: string): Promise<void> {
    await execFileAsync('tar', ['-xzf', archivePath, '-C', destDir]);
  }

  protected findBinary(files: string[]): string | undefined {
    return files.find((f) =>
      f.startsWith('datamigrator-') &&
      !f.endsWith('.exe') &&
      !f.endsWith('.sha256') &&
      !f.endsWith('.tar.gz') &&
      !f.endsWith('.zip') &&
      !f.endsWith('.env'),
    );
  }

  protected async makeExecutable(binaryPath: string): Promise<void> {
    await execFileAsync('chmod', ['+x', binaryPath]);
  }
}
