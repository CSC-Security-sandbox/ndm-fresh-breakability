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
  ): Promise<void> {
    try {
      // Validate inputs
      this.validateInputs(csvContent, fileName, zipLocation);

      const zipPath = this.getZipPath(zipLocation);
      this.logger.log(`Adding CSV to zip file: ${zipPath}`);

      // Ensure directory exists
      await this.ensureDirectoryExists(path.dirname(zipPath));

      const zipExists = await this.checkZipExists(zipPath);

      if (zipExists) {
        await this.addToExistingZip(csvContent, fileName, zipPath);
      } else {
        await this.createNewZipWithCsv(csvContent, fileName, zipPath);
      }
    } catch (error: any) {
      this.logger.error(`Error in addCsvToZip: ${error.message}`);
      throw new Error(`Failed to add CSV to zip: ${error.message}`);
    }
  }

  private validateInputs(
    csvContent: string,
    fileName: string,
    zipLocation: string,
  ): void {
    // Validate CSV content
    if (
      !csvContent ||
      typeof csvContent !== 'string' ||
      csvContent.trim() === ''
    ) {
      throw new Error('CSV content is required and must be a non-empty string');
    }

    // Validate file name
    if (!fileName || typeof fileName !== 'string' || fileName.trim() === '') {
      throw new Error('File name is required and must be a non-empty string');
    }

    // Check for invalid characters in file name
    const invalidFileNameChars = /[<>:"|?*\0]/;
    if (invalidFileNameChars.test(fileName)) {
      throw new Error('File name contains invalid characters');
    }

    // Validate zip location
    if (
      !zipLocation ||
      typeof zipLocation !== 'string' ||
      zipLocation.trim() === ''
    ) {
      throw new Error(
        'Zip location is required and must be a non-empty string',
      );
    }

    // Check for path traversal attempts
    if (
      zipLocation.includes('../') ||
      zipLocation.includes('..\\') ||
      zipLocation.includes('\0')
    ) {
      throw new Error('Invalid zip location path');
    }
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
    } catch (error: any) {
      this.logger.error(`Failed to create directory: ${error.message}`);
      throw new Error(`Failed to create directory: ${error.message}`);
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

        output.on('error', (err: Error) => {
          this.logger.error(`Output stream error: ${err.message}`);
          reject(new Error(`Stream write failed: ${err.message}`));
        });

        archive.on('warning', (err: any) => {
          if (err.code === 'ENOENT') {
            this.logger.warn(`Archive warning: ${err.message}`);
          } else {
            this.logger.error(`Archive warning: ${err.message}`);
            reject(new Error(`Critical warning: ${err.message}`));
          }
        });

        archive.on('error', (err: Error) => {
          this.logger.error(`Archive error: ${err.message}`);
          reject(new Error(`Archive creation failed: ${err.message}`));
        });

        archive.pipe(output);
        archive.append(csvContent, { name: fileName });

        archive.finalize().catch((err: Error) => {
          this.logger.error(`Failed to finalize archive: ${err.message}`);
          reject(new Error(`Failed to finalize archive: ${err.message}`));
        });
      } catch (error: any) {
        this.logger.error(`Error in createNewZipWithCsv: ${error.message}`);
        reject(new Error(`Failed to create zip: ${error.message}`));
      }
    });
  }

  private async addToExistingZip(
    csvContent: string,
    fileName: string,
    zipPath: string,
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

      // Check if file already exists in zip
      const entries = existingZip.getEntries();
      const existingEntry = entries.find(
        (entry) => entry.entryName === fileName,
      );
      if (existingEntry) {
        this.logger.warn(
          `File ${fileName} already exists in zip, it will be replaced`,
        );
        existingZip.deleteFile(fileName);
      }

      existingZip.addFile(fileName, Buffer.from(csvContent, 'utf8'));
      existingZip.writeZip(zipPath);

      this.logger.log(
        `CSV successfully added to existing ZIP file: ${zipPath}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Error adding CSV to existing zip with AdmZip: ${error.message}`,
      );

      // Enhanced fallback error handling
      if (error.code === 'EACCES') {
        throw new Error(`Permission denied accessing zip file: ${zipPath}`);
      } else if (error.code === 'ENOENT') {
        throw new Error(`Zip file not found: ${zipPath}`);
      } else if (error.message.includes('Invalid or unsupported zip format')) {
        this.logger.log(
          'Zip file corrupted or invalid format, falling back to archiver-based approach...',
        );
      } else {
        this.logger.log('Falling back to archiver-based approach...');
      }

      try {
        await this.createNewZipWithCsv(csvContent, fileName, zipPath);
      } catch (fallbackError: any) {
        this.logger.error(
          `Fallback approach also failed: ${fallbackError.message}`,
        );
        throw new Error(
          `Both primary and fallback zip operations failed: ${fallbackError.message}`,
        );
      }
    }
  }

  // New method for creating zip from CSV string
  async createZipFromCsvString(
    csvContent: string,
    fileName: string,
    outputPath: string,
  ): Promise<Buffer> {
    try {
      this.validateInputs(csvContent, fileName, outputPath);

      return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        archive.on('end', () => {
          const buffer = Buffer.concat(chunks);
          this.logger.log(
            `Zip buffer created successfully (${buffer.length} bytes)`,
          );
          resolve(buffer);
        });

        archive.on('error', (err: Error) => {
          this.logger.error(`Archive error: ${err.message}`);
          reject(new Error(`Archive creation failed: ${err.message}`));
        });

        archive.append(csvContent, { name: fileName });

        archive.finalize().catch((err: Error) => {
          this.logger.error(`Failed to finalize archive: ${err.message}`);
          reject(new Error(`Failed to finalize archive: ${err.message}`));
        });
      });
    } catch (error: any) {
      this.logger.error(`Error creating zip from CSV string: ${error.message}`);
      throw new Error(`Failed to create zip from CSV string: ${error.message}`);
    }
  }
}
