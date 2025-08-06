import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { promisify } from 'util';
import { exec as execCb } from 'child_process';
import { ConfigService } from '@nestjs/config';

const exec = promisify(execCb);

@Injectable()
export class LogGeneratorActivity {
  private readonly logger = new Logger(LogGeneratorActivity.name);
  private baseLogPath: string;
  private outputZipPath: string;

  constructor(private readonly configService: ConfigService) {
    const baseLogPath = this.configService.get<string>('support-bundle.bundle.baseLogPath');
    const outputZipPath = this.configService.get<string>('support-bundle.bundle.outputZipPath');
    if (!baseLogPath || !outputZipPath) {
      throw new Error('Missing required configuration for baseLogPath or outputZipPath');
    }
    this.baseLogPath = baseLogPath;
    this.outputZipPath = outputZipPath;
  }

  async fetchAndZipLogs({ traceId, payload }): Promise<any> {
    this.logger.log(`[${traceId}] Started fetchAndZipLogs activity`);

    try {
      // Validate required payload fields
      if (!payload?.startDate || !payload?.endDate || !payload?.userId) {
        throw new Error('Missing required payload fields: startDate, endDate, or userId');
      }

      const zipRoot = 'ndm_logs';
      const zipFileName = `ndm_${payload.userId}.zip`;
      const zipPath = path.join(this.outputZipPath, zipFileName);

      // Remove existing zip file if it exists
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
        this.logger.log(`[${traceId}] Removed existing zip file: ${zipPath}`);
      }

      // Ensure output directory exists
      if (!fs.existsSync(this.outputZipPath)) {
        fs.mkdirSync(this.outputZipPath, { recursive: true });
        this.logger.log(`[${traceId}] Created output directory: ${this.outputZipPath}`);
      }

      // Validate and parse date range
      const start = new Date(payload.startDate);
      const end = new Date(payload.endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new Error(
          `Invalid date format. Expected YYYY-MM-DD format. Received startDate: ${payload.startDate}, endDate: ${payload.endDate}`,
        );
      }
      if (start > end) {
        throw new Error(
           `Invalid date range: start date "${payload.startDate}" is after end date "${payload.endDate}". Please ensure the start date is earlier than or equal to the end date.`
        );
      }

      // Generate date folders for the given range
      const dateFolders: string[] = [];
      const current = new Date(payload.startDate);
      const endDt = new Date(payload.endDate);

      while (current <= endDt) {
        const yyyyMmDd = current.toISOString().split('T')[0];
        dateFolders.push(yyyyMmDd);
        current.setUTCDate(current.getUTCDate() + 1);
      }

      this.logger.log(`[${traceId}] Processing date folders: ${dateFolders.join(', ')}`);

      // Verify base log path exists
      if (!fs.existsSync(this.baseLogPath)) {
        throw new Error(`Base log path does not exist: ${this.baseLogPath}`);
      }

      // Use find command to locate existing date folders within the specified range
      const pathExpressions: string[] = [];
      for (const date of dateFolders) {
        const datePath = path.join(this.baseLogPath, date);
        pathExpressions.push(`-path "${datePath}"`);
      }

      if (pathExpressions.length === 0) {
        throw new Error('No date paths generated from date range');
      }

      const findCommand = `find "${this.baseLogPath}" -maxdepth 1 -type d \\( ${pathExpressions.join(' -o ')} \\)`;

      this.logger.log(`[${traceId}] Executing find command: ${findCommand}`);

      const { stdout } = await exec(findCommand).catch((err) => {
        this.logger.error(`[${traceId}] Error executing find command:`, err.stderr || err.message);
        throw new Error(`Failed to execute find command: ${err.message}`);
      });

      const existingDateFolders = stdout
        .trim()
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      if (existingDateFolders.length === 0) {
        throw new Error(
          `No date folders found in the specified range (${payload.startDate} to ${payload.endDate}) at path: ${this.baseLogPath}`,
        );
      }

      this.logger.log(`[${traceId}] Found ${existingDateFolders.length} date folders to process: ${existingDateFolders.map(p => path.basename(p)).join(', ')}`);

      // Create zip file with all content from existing date folders
      return await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        let totalFilesAdded = 0;

        output.on('close', () => {
          this.logger.log(`[${traceId}] Zip created successfully at: ${zipPath}`);
          this.logger.log(`[${traceId}] Total bytes written: ${archive.pointer()}`);
          this.logger.log(`[${traceId}] Total files/folders added: ${totalFilesAdded}`);
           resolve({
            success: true,
            message: zipPath
           });
        });

        archive.on('error', (err) => {
          this.logger.error(`[${traceId}] Archiving error:`, err);
          reject(new Error(`Failed to create zip archive: ${err.message}`));
        });

        archive.on('warning', (err) => {
          if (err.code === 'ENOENT') {
            this.logger.warn(`[${traceId}] Archive warning:`, err);
          } else {
            this.logger.error(`[${traceId}] Archive warning:`, err);
            reject(err);
          }
        });

        archive.on('entry', (entry) => {
          totalFilesAdded++;
          if (totalFilesAdded % 100 === 0) {
            this.logger.log(`[${traceId}] Processed ${totalFilesAdded} entries...`);
          }
        });

        archive.pipe(output);

        // Add each date folder to the zip
        for (const dateFolderPath of existingDateFolders) {
          const dateFolder = path.basename(dateFolderPath);
          this.logger.log(`[${traceId}] Adding date folder to zip: ${dateFolder}`);

          try {
            // Add the entire date folder and its contents to the zip
            archive.directory(dateFolderPath, path.join(zipRoot, dateFolder));
          } catch (err) {
            this.logger.error(`[${traceId}] Error adding folder ${dateFolder}:`, err);
            reject(new Error(`Failed to add folder ${dateFolder} to zip: ${err.message}`));
            return;
          }
        }

        archive.finalize().catch((err) => {
          this.logger.error(`[${traceId}] Error finalizing archive:`, err);
          reject(new Error(`Failed to finalize zip archive: ${err.message}`));
        });
      });
    } catch (err) {
      this.logger.error(`[${traceId}] Error in fetchAndZipLogs:`, err.message);

      // Clean up partial zip file if it exists
      const zipFileName = `ndm_${payload?.userId}.zip`;
      const zipPath = path.join(this.outputZipPath, zipFileName);
      if (fs.existsSync(zipPath)) {
        try {
          fs.unlinkSync(zipPath);
          this.logger.log(`[${traceId}] Cleaned up partial zip file: ${zipPath}`);
        } catch (cleanupErr) {
          this.logger.error(`[${traceId}] Failed to cleanup partial zip file:`, cleanupErr);
        }
      }

      return {
        success: false,
        message: err.message
      }
    }
  }
}
