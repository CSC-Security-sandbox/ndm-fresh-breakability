/**
 * Windows Binary Handler
 * 
 * Extends BaseBinaryHandler with Windows-specific behavior:
 *   - extractArchive: tar -xf (.zip) — Windows 10+ tar supports zip
 *   - findBinary: file with .exe extension
 *   - makeExecutable: no-op (exe files are executable by default)
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { BaseBinaryHandler } from '../binary-handler.interface';

const execFileAsync = promisify(execFile);

export class WindowsBinaryHandler extends BaseBinaryHandler {
  protected readonly platform = 'windows' as const;
  protected readonly archiveExtension = '.zip';
  protected readonly stagingBase = 'C:\\datamigrator\\staging';

  protected async extractArchive(archivePath: string, destDir: string): Promise<void> {
    await execFileAsync('tar', ['-xf', archivePath, '-C', destDir]);
  }

  /**
   * Find binary matching: datamigrator-worker-windows-{version}.exe
   */
  protected findBinary(files: string[]): string | undefined {
    return files.find((f) =>
      f.startsWith('datamigrator-worker-windows-') && f.endsWith('.exe'),
    );
  }

  protected async makeExecutable(): Promise<void> {
    // No-op on Windows — exe files are executable by default
  }
}
