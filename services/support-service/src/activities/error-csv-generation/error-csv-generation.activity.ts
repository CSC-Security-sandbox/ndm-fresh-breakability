import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import AdmZip = require('adm-zip');
import { ExportRequest, ExportResult, OperationErrorExportData } from 'src/constants/types';
import { OperationErrorService } from 'src/utils/error-csv-generation.service';

@Injectable()
export class ErrorCsvGenerationActivity {
  private readonly logger = new Logger(ErrorCsvGenerationActivity.name);
  constructor(
    private readonly operationErrorService: OperationErrorService,
  ) { }

  async generateErrorCsv(
    {
      traceId,
      payload,
      projectIds
    }
  ): Promise<ExportResult> {
    const outputLocation = payload.zipLocation;
    try {
      const data = await this.getOperationErrorsByProjectAndDateRange(
        projectIds,
        payload.startDate,
        payload.endDate,
      );

      if (data.length === 0) {
        return {
          success: true,
          message: 'No operation errors found for the given criteria',
          filesCreated: 0,
        };
      }

      await this.exportOperationErrorsToZip({
        projectIds,
        startDate: payload.startDate,
        endDate: payload.endDate,
        outputLocation,
      });

      // Count unique combinations
      const groupedData = this.groupDataByProjectAndDate(data);
      let filesCreated = 0;
      for (const [, dateGroups] of groupedData.entries()) {
        filesCreated += dateGroups.size;
      }

      return {
        success: true,
        message: `Successfully exported operation errors to ${filesCreated} CSV files`,
        filesCreated,
      };
    } catch (error) {
      console.error('Error exporting operation errors:', error);
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
    return await this.operationErrorService.getOperationErrorsByProjectAndDateRange(
      projectIds,
      startDate,
      endDate,
    );
  }

  /**
   * Generate CSV files and add them to existing zip structure
   */
  async exportOperationErrorsToZip(request: ExportRequest): Promise<void> {
    const data = await this.getOperationErrorsByProjectAndDateRange(
      request.projectIds,
      request.startDate,
      request.endDate,
    );

    // Group data by project ID and date
    const groupedData = this.groupDataByProjectAndDate(data);

    // Process zip file
    await this.addCSVFilesToZip(groupedData, request.outputLocation);
  }

  /**
   * Add CSV files to existing zip structure
   */
  private async addCSVFilesToZip(
    groupedData: Map<string, Map<string, OperationErrorExportData[]>>,
    zipFilePath: string,
  ): Promise<void> {
    // Check if zip file exists
    const zipExists = await fs.access(zipFilePath).then(() => true).catch(() => false);

    if (!zipExists) {
      throw new Error(`Zip file not found: ${zipFilePath}`);
    }

    // Load existing zip
    const zip = new AdmZip(zipFilePath);
    this.logger.log(`Loading existing zip file: ${zipFilePath}`);

    // Get all entries in the zip to understand the structure
    const zipEntries = zip.getEntries();
    this.logger.log(`Found ${zipEntries.length} entries in zip file`);

    // Log existing directory structure for debugging
    this.logger.log('Existing zip structure:');
    zipEntries
      .filter(entry => entry.isDirectory)
      .slice(0, 10) // Show first 10 directories
      .forEach(entry => this.logger.log(`${entry.entryName}`));

    if (zipEntries.filter(entry => entry.isDirectory).length > 10) {
      this.logger.log(`${zipEntries.filter(entry => entry.isDirectory).length - 10} more directories`);
    }

    // Process each project and date combination
    let totalFilesAdded = 0;
    for (const [projectId, dateGroups] of groupedData.entries()) {
      this.logger.log(`Processing project: ${projectId}`);
      for (const [date, errors] of dateGroups.entries()) {
        // Ensure date is in YYYY-MM-DD format
        const formattedDate = date.includes('/') ? date.replace(/\//g, '-') : date;
        this.logger.log(`Processing: Project '${projectId}', Date '${formattedDate}' (${errors.length} errors)`);
        await this.addCSVToZip(zip, projectId, formattedDate, errors, zipEntries);
        totalFilesAdded++;
      }
    }

    // Save the zip file
    zip.writeZip(zipFilePath);
    this.logger.log(`Zip file updated successfully: ${zipFilePath}`);
    this.logger.log(`Total CSV files added: ${totalFilesAdded}`);
  }

  /**
   * Add a single CSV file to the zip structure
   * Structure: ndm_logs/date_folder/project_id_folder/control_plane/errorlog.csv
   */
  private async addCSVToZip(
    zip: AdmZip,
    projectId: string,
    date: string,
    errors: OperationErrorExportData[],
    zipEntries: AdmZip.IZipEntry[],
  ): Promise<void> {
    // Use YYYY-MM-DD format as a single folder name
    this.logger.log(`Looking for project '${projectId}' in date format: ${date}`);

    let targetPath = '';
    let foundStructure = false;

    this.logger.log(`   Checking date format: ${date}`);

    // Step 1: Look for exact control_plane folder
    const controlPlanePath = `ndm_logs/${date}/${projectId}/control_plane/`;
    if (this.findExactDirectory(zipEntries, controlPlanePath)) {
      targetPath = `${controlPlanePath}errorlog.csv`;
      foundStructure = true;
      this.logger.log(`   ✓ Found existing control_plane: ${controlPlanePath}`);
    }

    // Step 2: Look for project folder
    if (!foundStructure) {
      const projectPath = `ndm_logs/${date}/${projectId}/`;
      if (this.findExactDirectory(zipEntries, projectPath)) {
        targetPath = `${projectPath}control_plane/errorlog.csv`;
        foundStructure = true;
        this.logger.log(`Found existing project folder: ${projectPath}`);
      }
    }

    // Step 3: Look for date folder
    if (!foundStructure) {
      const datePath = `ndm_logs/${date}/`;
      if (this.findExactDirectory(zipEntries, datePath)) {
        targetPath = `${datePath}${projectId}/control_plane/errorlog.csv`;
        foundStructure = true;
        this.logger.log(`Found existing date folder: ${datePath}`);
      }
    }

    // Step 4: Check for ndm_logs folder
    if (!foundStructure) {
      if (this.findExactDirectory(zipEntries, 'ndm_logs/')) {
        // Use the date format (YYYY-MM-DD) as single folder
        targetPath = `ndm_logs/${date}/${projectId}/control_plane/errorlog.csv`;
        foundStructure = true;
        this.logger.log(`Found ndm_logs, creating structure: ndm_logs/${date}/${projectId}/control_plane/`);
      }
    }

    // Step 5: Fallback - create complete structure
    if (!foundStructure) {
      targetPath = `ndm_logs/${date}/${projectId}/control_plane/errorlog.csv`;
      this.logger.log(`No existing structure found, creating complete structure: ${targetPath}`);
    }

    // Generate CSV content
    const csvContent = await this.generateCSVContent(errors);

    // Add the CSV file to the zip
    zip.addFile(targetPath, Buffer.from(csvContent, 'utf8'));

    this.logger.log(`Successfully added CSV: ${targetPath} (${errors.length} records)`);
  }

  /**
   * Helper method to find exact directory in zip entries
   */
  private findExactDirectory(zipEntries: AdmZip.IZipEntry[], directoryPath: string): boolean {
    return zipEntries.some(entry =>
      entry.isDirectory && entry.entryName === directoryPath
    );
  }

  /**
   * Generate CSV content as string
   */
  private async generateCSVContent(errors: OperationErrorExportData[]): Promise<string> {
    // Create a temporary file to generate CSV content
    const tempDir = '/tmp';
    const tempFile = path.join(tempDir, `temp_${Date.now()}.csv`);

    try {
      // Ensure temp directory exists
      await fs.mkdir(tempDir, { recursive: true });

      // Create CSV writer
      const csvWriter = createObjectCsvWriter({
        path: tempFile,
        header: [
          { id: 'id', title: 'ID' },
          { id: 'operationId', title: 'Operation ID' },
          { id: 'errorCode', title: 'Error Code' },
          { id: 'errorMessage', title: 'Error Message' },
          { id: 'createdAt', title: 'Created At' },
          { id: 'fileName', title: 'File Name' },
          { id: 'filePath', title: 'File Path' },
          { id: 'errorType', title: 'Error Type' },
          { id: 'operationType', title: 'Operation Type' },
          { id: 'origin', title: 'Origin' },
          { id: 'projectId', title: 'Project ID' },
          { id: 'projectName', title: 'Project Name' },
        ],
      });

      // Write CSV data
      await csvWriter.writeRecords(errors);

      // Read the CSV content
      const csvContent = await fs.readFile(tempFile, 'utf8');

      // Clean up temp file
      await fs.unlink(tempFile);

      return csvContent;
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempFile);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Group operation errors by project ID and date
   */
  private groupDataByProjectAndDate(
    data: OperationErrorExportData[],
  ): Map<string, Map<string, OperationErrorExportData[]>> {
    const grouped = new Map<string, Map<string, OperationErrorExportData[]>>();

    for (const item of data) {
      // Properly format date to YYYY-MM-DD
      let date: string;
      try {
        // Handle both Date objects and string dates
        const dateObj = new Date(item.createdAt);
        if (isNaN(dateObj.getTime())) {
          // If invalid date, try to extract from string manually
          date = item.createdAt.toString().substring(0, 10);
        } else {
          // Format as YYYY-MM-DD
          date = dateObj.toISOString().split('T')[0];
        }
      } catch (error) {
        // Fallback: try to extract date string manually
        const dateStr = item.createdAt.toString();
        if (dateStr.includes('-')) {
          date = dateStr.split('T')[0];
        } else {
          // For dates like "Fri Jul 11 2025", parse and format
          const parsed = new Date(dateStr);
          date = parsed.toISOString().split('T')[0];
        }
      }

      const projectId = item.projectId;

      if (!grouped.has(projectId)) {
        grouped.set(projectId, new Map());
      }

      const projectGroup = grouped.get(projectId)!;
      if (!projectGroup.has(date)) {
        projectGroup.set(date, []);
      }

      projectGroup.get(date)!.push(item);
    }

    return grouped;
  }

  /**
   * Get error count statistics
   */
  async getErrorCountByProject(
    projectIds: string[],
    startDate: string,
    endDate: string,
  ): Promise<{ projectId: string; projectName: string; errorCount: number }[]> {
    return await this.operationErrorService.getErrorCountByProject(
      projectIds,
      startDate,
      endDate,
    );
  }
}

