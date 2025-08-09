import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import AdmZip = require('adm-zip');
import { ExportRequest, ExportResult, OperationErrorExportData } from 'src/constants/types';
import { OperationErrorService } from 'src/utils/error-csv-generation.service';
import { formatDateTime, getProjectIds, groupDataByProjectAndDate } from 'src/utils/error-csv-generation.util';

@Injectable()
export class ErrorCsvGenerationActivity {
  private readonly logger = new Logger(ErrorCsvGenerationActivity.name);
  constructor(
    private readonly operationErrorService: OperationErrorService,
  ) { }

  /**
    * Main export method that can be called from controller
    */
  async generateErrorCsv(
    {
      traceId,
      payload,
    }
  ): Promise<ExportResult> {
    if (!payload.zipLocation) {
      throw new Error('zipLocation is required for error CSV generation');
    }

    this.logger.log(`[${traceId}] Starting error CSV generation for date range: ${payload.startDate} to ${payload.endDate}`);

    const projectIds = getProjectIds({ payload });

    if (projectIds.length === 0) {
      this.logger.warn(`[${traceId}] No valid project IDs found in projectWorkerMap`);
      return {
        success: true,
        message: 'No valid project IDs found for CSV generation',
        filesCreated: 0,
      };
    }

    this.logger.log(`[${traceId}] Processing ${projectIds.length} projects: [${projectIds.join(', ')}]`);

    try {
      const data = await this.getOperationErrorsByProjectAndDateRange(
        projectIds,
        payload.startDate,
        payload.endDate,
      );

      if (data.length === 0) {
        this.logger.log(`[${traceId}] No operation errors found for the given criteria`);
        return {
          success: true,
          message: 'No operation errors found for the given date range and projects',
          filesCreated: 0,
        };
      }

      this.logger.log(`[${traceId}] Found ${data.length} operation errors to process`);

      await this.exportOperationErrorsToZip({
        projectIds,
        startDate: payload.startDate,
        endDate: payload.endDate,
        outputLocation: payload.zipLocation,
      }, traceId);

      // Count unique combinations
      const groupedData = groupDataByProjectAndDate(data);
      let filesCreated = 0;
      for (const [, dateGroups] of groupedData.entries()) {
        filesCreated += dateGroups.size;
      }

      this.logger.log(`[${traceId}] Successfully created ${filesCreated} CSV files`);

      return {
        success: true,
        message: `Successfully exported operation errors to ${filesCreated} CSV files`,
        filesCreated,
      };
    } catch (error) {
      this.logger.error(`[${traceId}] Error exporting operation errors:`, error);
      return {
        success: false,
        message: `Export failed: ${error instanceof Error ? error.message : String(error)}`,
        filesCreated: 0,
      };
    }
  }

  /**
 * Fetch operation errors for given project IDs and date range
 */
  async getOperationErrorsByProjectAndDateRange(
    projectIds: string[],
    startDate: string,
    endDate: string,
  ): Promise<OperationErrorExportData[]> {
    if (!projectIds || projectIds.length === 0) {
      throw new Error('No project IDs found for error CSV generation');
    }

    try {
      return await this.operationErrorService.getOperationErrorsByProjectAndDateRange(
        projectIds,
        startDate,
        endDate,
      );
    } catch (error) {
      throw new Error(`Failed to fetch operation errors from database: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate CSV files and add them to existing zip structure
   */
  async exportOperationErrorsToZip(request: ExportRequest, traceId: string): Promise<void> {
    this.logger.log(`[${traceId}] Starting CSV export to zip for ${request.projectIds.length} projects`);

    try {
      const data = await this.getOperationErrorsByProjectAndDateRange(
        request.projectIds,
        request.startDate,
        request.endDate,
      );

      if (data.length === 0) {
        this.logger.warn(`[${traceId}] No operation errors found for export criteria`);
        return;
      }

      // Group data by project ID and date
      const groupedData = groupDataByProjectAndDate(data);

      if (groupedData.size === 0) {
        this.logger.warn(`[${traceId}] No grouped data by project ID and date available after processing ${data.length} records for error CSV generation`);
        return;
      }

      this.logger.log(`[${traceId}] Grouped ${data.length} errors into ${groupedData.size} project groups`);

      // Process zip file
      await this.addCSVFilesToZip(groupedData, request.outputLocation, traceId);
    } catch (error) {
      this.logger.error(`[${traceId}] Failed to export operation errors to zip:`, error);
      throw new Error(`Failed to export errors to zip: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Add CSV files to existing zip structure
   */
  private async addCSVFilesToZip(
    groupedData: Map<string, Map<string, OperationErrorExportData[]>>,
    zipFilePath: string,
    traceId: string,
  ): Promise<void> {
    // Check if zip file exists
    const zipExists = await fs.access(zipFilePath).then(() => true).catch(() => false);

    if (!zipExists) {
      throw new Error(`Zip file not found: ${zipFilePath}`);
    }

    // Load existing zip
    let zip: AdmZip;
    try {
      zip = new AdmZip(zipFilePath);
    } catch (error) {
      throw new Error(`Failed to load existing zip file: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.logger.log(`[${traceId}] Loading existing zip file: ${zipFilePath}`);

    // Get all entries in the zip to understand the structure
    const zipEntries = zip.getEntries();
    this.logger.log(`[${traceId}] Found ${zipEntries.length} entries in zip file`);

    // Log existing directory structure for debugging
    this.logger.log(`[${traceId}] Existing zip structure:`);
    this.logger.log(`[${traceId}] All entries (files and directories):`);
    zipEntries.forEach(entry => {
      const type = entry.isDirectory ? '[DIR]' : '[FILE]';
      this.logger.log(`[${traceId}]    ${type} ${entry.entryName}`);
    });

    this.logger.log(`[${traceId}] Directories only:`);
    const directories = zipEntries.filter(entry => entry.isDirectory);
    if (directories.length === 0) {
      this.logger.log(`[${traceId}] No directories found in ZIP file!`);
    } else {
      directories.forEach(entry => this.logger.log(`[${traceId}]    ${entry.entryName}`));
    }

    // Process each project and date combination
    let totalFilesAdded = 0;
    for (const [projectId, dateGroups] of groupedData.entries()) {
      this.logger.log(`[${traceId}] Processing project: ${projectId}`);
      for (const [date, errors] of dateGroups.entries()) {
        // Ensure date is in YYYY-MM-DD format
        const formattedDate = date.includes('/') ? date.replace(/\//g, '-') : date;
        this.logger.log(`[${traceId}] Processing: Project '${projectId}', Date '${formattedDate}' (${errors.length} errors)`);

        const addedSuccessfully = await this.addCSVToZip(zip, projectId, formattedDate, errors, zipEntries, traceId);
        if (addedSuccessfully) {
          totalFilesAdded++;
        }
      }
    }

    // Save the zip file
    zip.writeZip(zipFilePath);
    this.logger.log(`[${traceId}] Zip file updated successfully: ${zipFilePath}`);
    this.logger.log(`[${traceId}] Total CSV files added: ${totalFilesAdded}`);
  }

  /**
   * Add a single CSV file to the zip structure
   * Structure: ndm_logs_userid/ndm_logs/date/project-id/control_plane/error-report.csv
   */
  private async addCSVToZip(
    zip: AdmZip,
    projectId: string,
    date: string,
    errors: OperationErrorExportData[],
    zipEntries: AdmZip.IZipEntry[],
    traceId: string,
  ): Promise<boolean> {
    try {
      this.logger.log(`[${traceId}] Looking for existing location for project '${projectId}' and date '${date}'`);

      let targetPath = '';
      let foundLocation = false;

      // Build the expected path pattern: */ndm_logs/date/projectId/control_plane/
      const expectedControlPlanePath = `ndm_logs/${date}/${projectId}/control_plane/`;

      this.logger.log(`[${traceId}] Looking for pattern: ${expectedControlPlanePath}`);

      // First, let's extract all possible directory paths from file entries
      const allPaths = new Set<string>();
      try {
        zipEntries.forEach(entry => {
          if (entry.isDirectory) {
            allPaths.add(entry.entryName);
          } else {
            // Extract directory path from file path
            const dirPath = entry.entryName.substring(0, entry.entryName.lastIndexOf('/') + 1);
            if (dirPath) {
              allPaths.add(dirPath);
            }
          }
        });
      } catch (pathError) {
        this.logger.error(`[${traceId}] Error extracting paths from zip entries:`, pathError);
        return false;
      }

      this.logger.log(`[${traceId}] All discovered paths in ZIP:`);
      Array.from(allPaths).sort().forEach(p => this.logger.log(`[${traceId}]       ${p}`));

      // Look for existing control_plane folder that matches the exact structure
      for (const possiblePath of allPaths) {
        if (possiblePath.includes(expectedControlPlanePath)) {
          targetPath = `${possiblePath}error-report.csv`;
          foundLocation = true;
          this.logger.log(`[${traceId}] Found exact control_plane match: ${possiblePath}`);
          break;
        }
      }

      // If no control_plane found, look for project folder to extend
      if (!foundLocation) {
        const expectedProjectPath = `ndm_logs/${date}/${projectId}/`;
        this.logger.log(`[${traceId}] Looking for project folder pattern: ${expectedProjectPath}`);

        for (const possiblePath of allPaths) {
          if (possiblePath.includes(expectedProjectPath) && possiblePath.endsWith(`${projectId}/`)) {
            targetPath = `${possiblePath}control_plane/error-report.csv`;
            foundLocation = true;
            this.logger.log(`[${traceId}] Found project folder, will add control_plane: ${possiblePath}`);
            break;
          }
        }
      }

      // If still no location found, look for date folder to extend
      if (!foundLocation) {
        const expectedDatePath = `ndm_logs/${date}/`;
        this.logger.log(`[${traceId}] Looking for date folder pattern: ${expectedDatePath}`);

        for (const possiblePath of allPaths) {
          if (possiblePath.includes(expectedDatePath) && possiblePath.endsWith(`${date}/`)) {
            targetPath = `${possiblePath}${projectId}/control_plane/error-report.csv`;
            foundLocation = true;
            this.logger.log(`[${traceId}] Found date folder, will create project structure: ${possiblePath}`);
            break;
          }
        }
      }

      // If still no location found, skip this CSV
      if (!foundLocation) {
        this.logger.log(`[${traceId}] No suitable location found for project '${projectId}' and date '${date}' - skipping`);
        this.logger.log(`[${traceId}] We looked for these patterns:`);
        this.logger.log(`[${traceId}]  - ${expectedControlPlanePath}`);
        this.logger.log(`[${traceId}]  - ndm_logs/${date}/${projectId}/`);
        this.logger.log(`[${traceId}]  - ndm_logs/${date}/`);
        return false;
      }

      // Generate CSV content
      let csvContent: string;
      try {
        csvContent = await this.generateCSVContent(errors, traceId);
      } catch (csvError) {
        this.logger.error(`[${traceId}] Failed to generate CSV content for project '${projectId}' date '${date}':`, csvError);
        return false;
      }

      // Add the CSV file to the zip
      try {
        zip.addFile(targetPath, Buffer.from(csvContent, 'utf8'));
        this.logger.log(`[${traceId}] Successfully added CSV: ${targetPath} (${errors.length} records)`);
        return true;
      } catch (addFileError) {
        this.logger.error(`[${traceId}] Failed to add CSV file to zip:`, addFileError);
        return false;
      }

    } catch (error) {
      this.logger.error(`[${traceId}] Unexpected error in addCSVToZip for project '${projectId}' date '${date}':`, error);
      return false;
    }
  }

  /**
   * Generate CSV content as string
   */
  private async generateCSVContent(errors: OperationErrorExportData[], traceId: string): Promise<string> {
    // Create a temporary file to generate CSV content
    const tempDir = '/tmp';
    const tempFile = path.join(tempDir, `temp_${Date.now()}.csv`);

    this.logger.log(`[${traceId}] Generating CSV content for ${errors.length} errors using temp file: ${tempFile}`);

    try {
      // Ensure temp directory exists
      try {
        await fs.mkdir(tempDir, { recursive: true });
      } catch (mkdirError) {
        throw new Error(`Failed to create temp directory ${tempDir}: ${mkdirError instanceof Error ? mkdirError.message : String(mkdirError)}`);
      }

      // Format the data before writing to CSV
      const formattedErrors = errors.map(error => ({
        ...error,
        // Format createdAt to YYYY-MM-DD HH:mm:ss
        createdAt: formatDateTime(error.createdAt)
      }));

      // Create CSV writer
      let csvWriter;
      try {
        csvWriter = createObjectCsvWriter({
          path: tempFile,
          header: [
            { id: 'id', title: 'ID' },
            { id: 'operationId', title: 'Operation ID' },
            { id: 'errorCode', title: 'Error Code' },
            { id: 'errorMessage', title: 'Error Message' },
            { id: 'createdAt', title: 'Created At' },
            { id: 'errorType', title: 'Error Type' },
            { id: 'operationType', title: 'Operation Type' },
            { id: 'origin', title: 'Origin' },
            { id: 'projectId', title: 'Project ID' },
            { id: 'projectName', title: 'Project Name' },
          ],
        });
      } catch (csvWriterError) {
        throw new Error(`Failed to create CSV writer: ${csvWriterError instanceof Error ? csvWriterError.message : String(csvWriterError)}`);
      }

      // Write CSV data
      try {
        await csvWriter.writeRecords(formattedErrors);
        this.logger.log(`[${traceId}] Successfully wrote ${formattedErrors.length} records to temp CSV file`);
      } catch (writeError) {
        throw new Error(`Failed to write CSV records: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
      }

      // Read the CSV content
      let csvContent: string;
      try {
        csvContent = await fs.readFile(tempFile, 'utf8');
      } catch (readError) {
        throw new Error(`Failed to read CSV file: ${readError instanceof Error ? readError.message : String(readError)}`);
      }

      // Clean up temp file
      try {
        await fs.unlink(tempFile);
        this.logger.log(`[${traceId}] Cleaned up temp file: ${tempFile}`);
      } catch (unlinkError) {
        this.logger.warn(`[${traceId}] Failed to clean up temp file ${tempFile}:`, unlinkError);
        // Don't throw here as the CSV content was generated successfully
      }

      this.logger.log(`[${traceId}] CSV content generated successfully (${csvContent.length} characters)`);
      return csvContent;

    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempFile);
      } catch (cleanupError) {
        this.logger.warn(`[${traceId}] Failed to cleanup temp file during error handling:`, cleanupError);
      }

      this.logger.error(`[${traceId}] Failed to generate CSV content:`, error);
      throw new Error(`CSV content generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

