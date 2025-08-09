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
    try {
      // Validate inputs
      this.validateInputs(csvContent, fileName, zipLocation);

      const zipPath = this.getZipPath(zipLocation);
      this.logger.log(`Adding CSV to zip file: ${zipPath}`);

      // Ensure directory exists
      await this.ensureDirectoryExists(path.dirname(zipPath));

    if (zipExists) {
      await this.addToExistingZip(csvContent, fileName, zipPath, folderName);
    } else {
      await this.createNewZipWithCsv(csvContent, fileName, zipPath, folderName);
    }
  }

  private getZipPath(zipLocation: string): string {
    try {
      if (!zipLocation || zipLocation.trim() === '') {
        throw new Error('Zip location cannot be empty');
      }

      return zipLocation.endsWith('.zip')
        ? zipLocation
        : path.join(zipLocation, 'support-bundle.zip');
    } catch (error: any) {
      this.logger.error(`Error in getZipPath: ${error.message}`);
      throw new Error(`Failed to determine zip path: ${error.message}`);
    }
  }

  private async checkZipExists(zipPath: string): Promise<boolean> {
    try {
      if (!zipPath) {
        this.logger.debug('Zip path is empty, returning false');
        return false;
      }

      await fs.promises.access(zipPath);
      this.logger.debug(`Zip file exists: ${zipPath}`);
      return true;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.logger.debug(`Zip file does not exist: ${zipPath}`);
        return false;
      }

      this.logger.error(`Error checking zip file existence: ${error.message}`);
      // For other errors, we'll return false to be safe rather than throwing
      return false;
    }
  }

  private async createNewZipWithCsv(
    csvContent: string,
    fileName: string,
    zipPath: string,
    folderName: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        if (!csvContent || !fileName || !zipPath) {
          reject(new Error('Missing required parameters for zip creation'));
          return;
        }

        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
          this.logger.log(
            `New ZIP file created: ${zipPath} (${archive.pointer()} total bytes)`,
          );
          resolve();
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
      if (!csvContent || !fileName || !zipPath) {
        throw new Error(
          'Missing required parameters for adding to existing zip',
        );
      }

      // Validate that the zip file exists and is readable
      await fs.promises.access(zipPath, fs.constants.R_OK | fs.constants.W_OK);

      const existingZip = new AdmZip(zipPath);
      existingZip.addFile(
        `${folderName}/${fileName}`,
        Buffer.from(csvContent, 'utf8'),
      );
      existingZip.writeZip(zipPath);

      this.logger.log(
        `CSV successfully added to existing ZIP file: ${zipPath}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Error adding CSV to existing zip with AdmZip: ${error.message}`,
      );
      this.logger.log('Falling back to archiver-based approach...');
      await this.createNewZipWithCsv(csvContent, fileName, zipPath, folderName);
    }
  }
}
