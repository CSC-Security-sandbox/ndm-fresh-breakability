import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import AdmZip from 'adm-zip';

@Injectable()
export class ZipHandlerService {
  private readonly logger = new Logger(ZipHandlerService.name);

  async addCsvToZip(
    csvContent: string,
    fileName: string,
    zipLocation: string,
    folderName: string = 'CSV Files',
  ): Promise<void> {
    const zipPath = this.getZipPath(zipLocation);
    this.logger.log(`Adding CSV to zip file: ${zipPath}`);

    await fs.promises.mkdir(path.dirname(zipPath), { recursive: true });

    const zipExists = await this.checkZipExists(zipPath);

    if (zipExists) {
      await this.addToExistingZip(csvContent, fileName, zipPath, folderName);
    } else {
      await this.createNewZipWithCsv(csvContent, fileName, zipPath, folderName);
    }
  }

  private getZipPath(zipLocation: string): string {
    return zipLocation.endsWith('.zip')
      ? zipLocation
      : path.join(zipLocation, 'support-bundle.zip');
  }

  private async checkZipExists(zipPath: string): Promise<boolean> {
    return fs.promises
      .access(zipPath)
      .then(() => true)
      .catch(() => false);
  }

  private async createNewZipWithCsv(
    csvContent: string,
    fileName: string,
    zipPath: string,
    folderName: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        this.logger.log(
          `New ZIP file created: ${zipPath} (${archive.pointer()} total bytes)`,
        );
        resolve();
      });

      archive.on('error', (err: Error) => {
        this.logger.error(`Archive error: ${err.message}`);
        reject(err);
      });

      archive.pipe(output);
      archive.append(csvContent, { name: `${folderName}/${fileName}` });
      void archive.finalize();
    });
  }

  private async addToExistingZip(
    csvContent: string,
    fileName: string,
    zipPath: string,
    folderName: string,
  ): Promise<void> {
    try {
      const existingZip = new (AdmZip as any)(zipPath);

      const entries = existingZip.getEntries();
      const existingNdmLogsFolder = entries.find(
        (entry: any) =>
          entry.entryName.startsWith('ndm_logs_') &&
          (entry.entryName.endsWith('/') || entry.entryName.includes('/')),
      );

      let targetPath: string;
      if (existingNdmLogsFolder) {
        const ndmLogsFolderName = existingNdmLogsFolder.entryName.split('/')[0];
        targetPath = `${ndmLogsFolderName}/${folderName}/${fileName}`;
        this.logger.log(
          `Found existing ndm_logs folder: ${ndmLogsFolderName}. Adding CSV to: ${targetPath}`,
        );
      } else {
        targetPath = `${folderName}/${fileName}`;
        this.logger.log(
          `No existing ndm_logs folder found. Adding CSV to: ${targetPath}`,
        );
      }

      existingZip.addFile(targetPath, Buffer.from(csvContent, 'utf8'));
      existingZip.writeZip(zipPath);
      this.logger.log(
        `CSV successfully added to existing ZIP file: ${zipPath} at ${targetPath}`,
      );
    } catch (error: any) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Error adding CSV to existing zip with AdmZip: ${errorMessage}`,
      );
      this.logger.log('Falling back to archiver-based approach...');
      await this.createNewZipWithCsv(csvContent, fileName, zipPath, folderName);
    }
  }
}
