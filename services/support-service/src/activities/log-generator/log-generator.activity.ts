import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
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

  /**
   * Helper method to check if a path exists asynchronously
   */
  private async pathExists(path: string): Promise<boolean> {
    try {
      await fsPromises.access(path);
      return true;
    } catch {
      return false;
    }
  }

  async fetchAndZipLogs({ traceId, payload }): Promise<any> {
    this.logger.log(`[${traceId}] Started fetchAndZipLogs activity`);

    try {
      // Validate required payload fields
      if (!payload?.startDate || !payload?.endDate || !payload?.userId) {
        throw new Error('Missing required payload fields: startDate, endDate, or userId');
      }

      // Validate projectWorkerMap if provided
      if (!payload?.projectWorkerMap || !Array.isArray(payload.projectWorkerMap)) {
        throw new Error('Missing or invalid projectWorkerMap in payload. Expected an array.');
      }

      this.logger.log(`[${traceId}] Processing ${payload.projectWorkerMap.length} project-worker mappings`);

      const zipRoot = `ndm_logs_${payload.userId}`;
      const zipFileName = `ndm_logs_${payload.userId}.zip`;
      const zipPath = path.join(this.outputZipPath, zipFileName);

      // Remove existing zip file if it exists
      if (await this.pathExists(zipPath)) {
        try {
          await fsPromises.unlink(zipPath);
          this.logger.log(`[${traceId}] Removed existing zip file: ${zipPath}`);
        } catch (error) {
          this.logger.warn(`[${traceId}] Failed to remove existing zip file: ${zipPath}`, error.message);
        }
      }

      // Ensure output directory exists
      if (!(await this.pathExists(this.outputZipPath))) {
        try {
          await fsPromises.mkdir(this.outputZipPath, { recursive: true });
          this.logger.log(`[${traceId}] Created output directory: ${this.outputZipPath}`);
        } catch (error) {
          throw new Error(`Failed to create output directory ${this.outputZipPath}: ${error.message}`);
        }
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
      if (!(await this.pathExists(this.baseLogPath))) {
        throw new Error(`Base log path does not exist: ${this.baseLogPath}`);
      }

      // Check if any date folders exist in the base log path
      const existingDateFolders: string[] = [];
      for (const date of dateFolders) {
        const datePath = path.join(this.baseLogPath, date);
        if (await this.pathExists(datePath)) {
          existingDateFolders.push(date);
        }
      }

      if (existingDateFolders.length === 0) {
        throw new Error(
          `No date folders found in the specified range (${payload.startDate} to ${payload.endDate}) at path: ${this.baseLogPath}`
        );
      }

      this.logger.log(`[${traceId}] Found ${existingDateFolders.length} existing date folders: ${existingDateFolders.join(', ')}`);

      // Apply project-worker filtering and create zip
      const filteredPaths = await this.findFilteredLogPaths(dateFolders, payload.projectWorkerMap, traceId);

      if (filteredPaths.length === 0) {
        throw new Error(
          `No matching log files found for the specified criteria (${payload.startDate} to ${payload.endDate}) with provided project-worker mapping`,
        );
      }

      this.logger.log(`[${traceId}] Found ${filteredPaths.length} filtered paths to process`);

      // Create zip file with filtered content
      return await this.createFilteredZip(filteredPaths, zipPath, zipRoot, traceId);
    } catch (err) {
      this.logger.error(`[${traceId}] Error in fetchAndZipLogs:`, err.message);

      // Clean up partial zip file if it exists
      const zipFileName = `ndm_logs_${payload?.userId}.zip`;
      const zipPath = path.join(this.outputZipPath, zipFileName);
      if (await this.pathExists(zipPath)) {
        try {
          await fsPromises.unlink(zipPath);
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

  /**
   * Find filtered log paths based on date range and project-worker mapping
   */
  private async findFilteredLogPaths(
    dateFolders: string[],
    projectWorkerMap: Array<{ projectId: string, workerIds: string[] }>,
    traceId: string
  ): Promise<Array<{ sourcePath: string, relativePath: string }>> {
    const filteredPaths: Array<{ sourcePath: string, relativePath: string }> = [];

    for (const date of dateFolders) {
      const datePath = path.join(this.baseLogPath, date);

      // Check if date folder exists
      if (!(await this.pathExists(datePath))) {
        this.logger.log(`[${traceId}] Date folder not found: ${datePath}`);
        continue;
      }

      this.logger.log(`[${traceId}] Processing date folder: ${datePath}`);

      // For each project-worker mapping
      for (const mapping of projectWorkerMap) {
        const projectPath = path.join(datePath, mapping.projectId);

        if (!(await this.pathExists(projectPath))) {
          this.logger.log(`[${traceId}] Project folder not found: ${projectPath}`);
          continue;
        }

        this.logger.log(`[${traceId}] Processing project: ${mapping.projectId} with ${mapping.workerIds.length} workers`);

        // Check both control_plane and worker folders
        const controlPlanePath = path.join(projectPath, 'control_plane');
        const workerParentPath = path.join(projectPath, 'worker');

        // Add control_plane files if they exist
        if (await this.pathExists(controlPlanePath)) {
          const controlPlaneFiles = await this.findFilesInDirectory(controlPlanePath, traceId);
          filteredPaths.push(...controlPlaneFiles.map(filePath => ({
            sourcePath: filePath,
            relativePath: path.relative(this.baseLogPath, filePath)
          })));
          this.logger.log(`[${traceId}] Found ${controlPlaneFiles.length} control plane files for project ${mapping.projectId} on ${date}`);
        }

        // Add worker files for specified worker IDs
        if (await this.pathExists(workerParentPath)) {
          for (const workerId of mapping.workerIds) {
            const workerPath = path.join(workerParentPath, workerId);

            if (!(await this.pathExists(workerPath))) {
              this.logger.log(`[${traceId}] Worker folder not found: ${workerPath}`);
              continue;
            }

            const workerFiles = await this.findFilesInDirectory(workerPath, traceId);
            filteredPaths.push(...workerFiles.map(filePath => ({
              sourcePath: filePath,
              relativePath: path.relative(this.baseLogPath, filePath)
            })));

            this.logger.log(`[${traceId}] Found ${workerFiles.length} files for worker ${workerId} in project ${mapping.projectId} on ${date}`);
          }
        }
      }
    }

    this.logger.log(`[${traceId}] Total filtered files found: ${filteredPaths.length}`);

    // Log summary of search results
    if (filteredPaths.length === 0) {
      this.logger.warn(`[${traceId}] No files found for any project-worker combinations:`);
      this.logger.warn(`[${traceId}] Searched in date folders: [${dateFolders.join(', ')}]`);
      this.logger.warn(`[${traceId}] Base path: ${this.baseLogPath}`);
    }

    return filteredPaths;
  }

  /**
   * Find all files in a directory recursively
   */
  private async findFilesInDirectory(dirPath: string, traceId: string): Promise<string[]> {
    try {
      const findCommand = `find "${dirPath}" -type f`;
      this.logger.log(`[${traceId}] Executing: ${findCommand}`);

      const { stdout } = await exec(findCommand);
      const foundFiles = stdout
        .trim()
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);

      return foundFiles;
    } catch (error) {
      this.logger.warn(`[${traceId}] Error searching in ${dirPath}:`, error.message);
      return [];
    }
  }

  /**
   * Create zip file with filtered content maintaining directory structure
   */
  private async createFilteredZip(
    filteredPaths: Array<{ sourcePath: string, relativePath: string }>,
    zipPath: string,
    zipRoot: string,
    traceId: string
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      let totalFilesAdded = 0;

      output.on('close', () => {
        this.logger.log(`[${traceId}] Zip created successfully at: ${zipPath}`);
        this.logger.log(`[${traceId}] Total bytes written: ${archive.pointer()}`);
        this.logger.log(`[${traceId}] Total files added: ${totalFilesAdded}`);
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

      archive.pipe(output);

      // Add each filtered file to the zip maintaining structure
      for (const fileInfo of filteredPaths) {
        try {
          const zipEntryPath = `${zipRoot}/ndm_logs/${fileInfo.relativePath}`;
          archive.file(fileInfo.sourcePath, { name: zipEntryPath });
          totalFilesAdded++;

          if (totalFilesAdded % 100 === 0) {
            this.logger.log(`[${traceId}] Processed ${totalFilesAdded} files...`);
          }
        } catch (err) {
          this.logger.error(`[${traceId}] Error adding file ${fileInfo.sourcePath}:`, err);
          reject(new Error(`Failed to add file ${fileInfo.sourcePath} to zip: ${err.message}`));
          return;
        }
      }

      archive.finalize().catch((err) => {
        this.logger.error(`[${traceId}] Error finalizing archive:`, err);
        reject(new Error(`Failed to finalize zip archive: ${err.message}`));
      });
    });
  }
}
