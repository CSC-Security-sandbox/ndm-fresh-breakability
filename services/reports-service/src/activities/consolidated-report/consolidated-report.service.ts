import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import { PDFDocument } from 'pdf-lib';
import puppeteer from 'puppeteer';
import * as hbs from 'hbs';
import { ReportsEntity } from 'src/entities/reports.entity';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { FileServerEntity, ConsolidatedReportStatus } from 'src/entities/fileserver.entity';
import { groupAndOrder } from 'src/utils/group-order';
import { ReportType } from 'src/constants/enums';
import { escapeCsvValue } from 'src/utils/utils';
import { ReportHeaders } from 'src/discovery/pattern.enum';
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';

/** Same header order as normal discovery report CSV (ReportHeaders enum) */
const DISCOVERY_CSV_HEADER_ORDER: string[] = Object.values(ReportHeaders);

export interface ConsolidatedReportJob {
  jobRunId: string;
  volumePath: string;
}

export interface GetDiscoveryJobsInput {
  fileServerId: string;
}

export interface GeneratePdfForJobRunInput {
  jobRunId: string;
  volumePath: string;
}

export interface MergePdfFilesInput {
  pdfFilePaths: string[];
  outputPath: string;
}

export interface GenerateCsvForJobRunInput {
  jobRunId: string;
  volumePath: string;
}

export interface MergeCsvFilesInput {
  csvFilePaths: string[];
  outputPath: string;
}

export interface GetConsolidatedReportPathInput {
  fileServerId: string;
  configName: string;
  format?: 'pdf' | 'csv';
}

export interface CleanupTempFilesInput {
  filePaths: string[];
}

export interface UpdateConsolidatedReportStatusInput {
  fileServerId: string;
  workflowId?: string;
  status: 'COMPLETED' | 'FAILED' | 'PARTIAL' | 'IN_PROGRESS';
  errorMessage?: string;
  reportPath?: string;
  successfulJobs?: number;
  failedJobs?: number;
  failedVolumes?: string[];
  configName?: string;
}

@Injectable()
export class ConsolidatedReportService {
  private readonly logger: LoggerService | Logger;
  private readonly reportsDirectory: string;
  private readonly tempDirectory: string;
  private browserInstance: any = null;

  constructor(
    @InjectRepository(InventoryEntity)
    private readonly inventoryRepo: Repository<InventoryEntity>,
    @InjectRepository(ReportsEntity)
    private readonly reportsRepo: Repository<ReportsEntity>,
    @InjectRepository(FileServerEntity)
    private readonly fileServerRepo: Repository<FileServerEntity>,
    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory,
  ) {
    if (loggerFactory) {
      this.logger = loggerFactory.create(ConsolidatedReportService.name);
    } else {
      this.logger = new Logger(ConsolidatedReportService.name);
    }
    this.reportsDirectory = process.env.REPORT_DOWNLOAD_LOCATION || './reports';
    this.tempDirectory = path.join(this.reportsDirectory, 'temp');
    
    this.initializeDirectories();
  }

  private async initializeDirectories(): Promise<void> {
    try {
      await fsPromises.mkdir(this.reportsDirectory, { recursive: true });
      await fsPromises.mkdir(this.tempDirectory, { recursive: true });
      this.logger.log(`Directories initialized: ${this.reportsDirectory}, ${this.tempDirectory}`);
    } catch (error) {
      this.logger.error(`Failed to initialize directories: ${error.message}`);
    }
  }

  async getDiscoveryJobsForFileServer(input: GetDiscoveryJobsInput): Promise<ConsolidatedReportJob[]> {
    const { fileServerId } = input;
    this.logger.log(`Fetching discovery jobs for fileServerId: ${fileServerId}`);

    const discoveryJobs = await this.inventoryRepo.query(`
      SELECT DISTINCT 
        jr.id as job_run_id,
        v.volume_path,
        jr.status,
        jr.end_time,
        ROW_NUMBER() OVER (PARTITION BY v.volume_path ORDER BY jr.end_time DESC) as rn
      FROM ${process.env.SCHEMA}.jobrun jr
      JOIN ${process.env.SCHEMA}.jobconfig jc ON jr.job_config_id = jc.id  
      JOIN ${process.env.SCHEMA}.volume v ON jc.source_path_id = v.id
      WHERE v.file_server_id = $1 
      AND jc.job_type = 'DISCOVER' 
      AND jr.status = 'COMPLETED'
      AND jr.is_report_ready = true
    `, [fileServerId]);

    const latestJobs = discoveryJobs
      .filter(job => Number(job.rn) === 1)
      .map(job => ({
        jobRunId: job.job_run_id,
        volumePath: job.volume_path,
      }));

    this.logger.log(`Found ${latestJobs.length} latest discovery jobs for fileServerId: ${fileServerId}`);
    return latestJobs;
  }

  async generatePdfForJobRun(input: GeneratePdfForJobRunInput): Promise<string | null> {
    const { jobRunId, volumePath } = input;
    this.logger.log(`Generating PDF for jobRunId: ${jobRunId}, volumePath: ${volumePath}`);

    try {
      const latestReport = await this.reportsRepo.find({
        where: { jobRunId: jobRunId, reportType: 'DISCOVER' },
        order: { createdAt: 'DESC' },
        take: 1,
      });

      if (!latestReport?.length || !latestReport[0]?.reportData) {
        this.logger.warn(`No report data found in database for jobRunId: ${jobRunId}`);
        return null;
      }

      const reportData = JSON.parse(latestReport[0].reportData);
      const tempFileName = `temp-${jobRunId}-${Date.now()}.pdf`;
      const tempFilePath = path.join(this.tempDirectory, tempFileName);
      const pdfBuffer = await this.generatePdfFromData(reportData);

      await fsPromises.writeFile(tempFilePath, pdfBuffer);
    
      this.logger.log(`PDF written to temp file: ${tempFilePath}`);
      return tempFilePath;
    } catch (error) {
      this.logger.error(`Failed to generate PDF for jobRunId: ${jobRunId}: ${error.message}`);
      throw error;
    }
  }

  private async getBrowser() {
    if (this.browserInstance) {
      try {
        await this.browserInstance.version();
        this.logger.log(`Reusing existing browser instance`);
        return this.browserInstance;
      } catch (error) {
        this.logger.warn(`Browser instance is dead, creating new one: ${error.message}`);
        this.browserInstance = null;
      }
    }

    this.logger.log(`Launching new Puppeteer browser instance`);
    this.browserInstance = await puppeteer.launch({
      headless: true, 
      browser: 'firefox', 
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-extensions',
        '--disable-sync',
        '--disable-default-apps',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
      protocolTimeout: 30000, 
    });

    return this.browserInstance;
  }

  private async generatePdfFromData(reportData: any[]): Promise<Buffer> {
    const templatePath = path.join(__dirname, '../../../templates/views/discovery_pdf_report.hbs');
    const templateSource = await fsPromises.readFile(templatePath, 'utf8');
    const template = hbs.compile(templateSource);

    const categories = groupAndOrder(reportData, ReportType.DISCOVERY);

    const htmlOutput = template(categories);
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1200, height: 1600 });
      await page.setContent(htmlOutput, { waitUntil: 'load' });
      const pdfBuffer = await page.pdf({
        format: 'A2',              
        printBackground: true,
        scale: 0.5,                
        width: '420mm',            
        height: '594mm',           
        landscape: false,
        timeout: 20000,
      });
      return Buffer.from(pdfBuffer);
    } finally {
      await page.close();
    }
  }

  private static readonly PDF_MERGE_CHUNK_SIZE = 5;

  async mergePdfFiles(input: MergePdfFilesInput): Promise<string> {
    const { pdfFilePaths, outputPath } = input;
    this.logger.log(`Merging ${pdfFilePaths.length} PDF files into ${outputPath}`);

    if (pdfFilePaths.length <= ConsolidatedReportService.PDF_MERGE_CHUNK_SIZE) {
      await this.mergePdfChunk(pdfFilePaths, outputPath);
      return outputPath;
    }

    const intermediateFiles: string[] = [];
    try {
      for (let i = 0; i < pdfFilePaths.length; i += ConsolidatedReportService.PDF_MERGE_CHUNK_SIZE) {
        const chunk = pdfFilePaths.slice(i, i + ConsolidatedReportService.PDF_MERGE_CHUNK_SIZE);
        const intermediatePath = path.join(this.tempDirectory, `merge-intermediate-${i}-${Date.now()}.pdf`);
        await this.mergePdfChunk(chunk, intermediatePath);
        intermediateFiles.push(intermediatePath);
        this.logger.log(`Created intermediate PDF ${intermediateFiles.length} from ${chunk.length} inputs`);
      }
      await this.mergePdfChunk(intermediateFiles, outputPath);
    } finally {
      for (const f of intermediateFiles) {
        await fsPromises.unlink(f).catch(() => {});
      }
    }

    this.logger.log(`PDF merge complete: ${outputPath}`);
    return outputPath;
  }

  private async mergePdfChunk(filePaths: string[], outputPath: string): Promise<void> {
    const mergedPdf = await PDFDocument.create();

    for (let i = 0; i < filePaths.length; i++) {
      try {
        const pdfBuffer = await fsPromises.readFile(filePaths[i]);
        const pdf = await PDFDocument.load(pdfBuffer);
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
        await fsPromises.unlink(filePaths[i]);
      } catch (error) {
        this.logger.error(`Failed to process PDF ${i + 1}: ${error.message}`);
        throw new Error(`Failed to process PDF ${i + 1}: ${error.message}`);
      }
    }

    const mergedPdfBytes = await mergedPdf.save();
    await fsPromises.writeFile(outputPath, Buffer.from(mergedPdfBytes));
  }

  async getConsolidatedReportPath(input: GetConsolidatedReportPathInput): Promise<string> {
    const { configName, format = 'pdf' } = input;
    const ext = format === 'csv' ? '.csv' : '.pdf';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sanitizedConfigName = configName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const fileName = `${sanitizedConfigName}-consolidated-discovery-report-${timestamp}${ext}`;
    return path.join(this.reportsDirectory, fileName);
  }

  async generateCsvForJobRun(input: GenerateCsvForJobRunInput): Promise<string | null> {
    const { jobRunId } = input;
    this.logger.log(`Generating CSV for jobRunId: ${jobRunId}`);

    try {
      const latestReport = await this.reportsRepo.find({
        where: { jobRunId, reportType: 'DISCOVER' },
        order: { createdAt: 'DESC' },
        take: 1,
      });

      if (!latestReport?.length || !latestReport[0]?.reportData) {
        this.logger.warn(`No report data found in database for jobRunId: ${jobRunId}`);
        return null;
      }

      const reportData = JSON.parse(latestReport[0].reportData);
      const flatData = Object.values(groupAndOrder(reportData, ReportType.DISCOVERY)).flat() as any[];

      const dynamicHeaders = new Set<string>();
      flatData?.forEach((entry: any) => {
        if (entry.sub_category && entry.value !== null) {
          dynamicHeaders.add(entry.sub_category);
        }
      });
      const headers = Array.from(dynamicHeaders);

      const rows: string[] = [];
      headers.forEach((header) => {
        for (const entry of flatData) {
          if (header in entry) {
            rows.push(entry[header] !== undefined ? entry[header]?.toString() : '');
            break;
          } else if (header === entry?.sub_category) {
            rows.push(entry?.value !== undefined ? entry?.value?.toString() : '');
            break;
          }
        }
      });

      const csvContent = [headers.join(','), rows.map(escapeCsvValue).join(',')].join('\n');
      const tempFileName = `temp-${jobRunId}-${Date.now()}.csv`;
      const tempFilePath = path.join(this.tempDirectory, tempFileName);
      await fsPromises.writeFile(tempFilePath, csvContent);

      this.logger.log(`CSV written to temp file: ${tempFilePath}`);
      return tempFilePath;
    } catch (error) {
      this.logger.error(`Failed to generate CSV for jobRunId: ${jobRunId}: ${error.message}`);
      throw error;
    }
  }

  async mergeCsvFiles(input: MergeCsvFilesInput): Promise<string> {
    const { csvFilePaths, outputPath } = input;
    this.logger.log(`Merging ${csvFilePaths.length} CSV files into ${outputPath}`);

    const allHeaders: string[] = [];

    for (const filePath of csvFilePaths) {
      const fd = await fsPromises.open(filePath, 'r');
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
      await fd.close();
      const firstLine = buf.toString('utf8', 0, bytesRead).split(/\r?\n/)[0];
      if (!firstLine) continue;
      const headers = this.parseCsvLine(firstLine);
      for (const h of headers) {
        if (!allHeaders.includes(h)) allHeaders.push(h);
      }
    }

    const orderedHeaders = DISCOVERY_CSV_HEADER_ORDER.filter((h) => allHeaders.includes(h));
    const extraHeaders = allHeaders.filter((h) => !DISCOVERY_CSV_HEADER_ORDER.includes(h));
    const allHeadersOrdered = [...orderedHeaders, ...extraHeaders];

    const headerLine = allHeadersOrdered.map((h) =>
      (h.includes(',') || h.includes('"') ? `"${h.replace(/"/g, '""')}"` : h)
    ).join(',');

    const writeStream = fs.createWriteStream(outputPath);
    writeStream.write(headerLine + '\n');

    let totalRows = 0;
    for (const filePath of csvFilePaths) {
      const content = await fsPromises.readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length <= 1) {
        await fsPromises.unlink(filePath).catch(() => {});
        continue;
      }

      const fileHeaders = this.parseCsvLine(lines[0]);
      for (let j = 1; j < lines.length; j++) {
        const values = this.parseCsvLine(lines[j]);
        const outputLine = allHeadersOrdered.map((h) => {
          const idx = fileHeaders.indexOf(h);
          return escapeCsvValue(idx >= 0 ? (values[idx] ?? '') : '');
        }).join(',');
        const canContinue = writeStream.write(outputLine + '\n');
        if (!canContinue) {
          await new Promise<void>((resolve) => writeStream.once('drain', resolve));
        }
        totalRows++;
      }

      await fsPromises.unlink(filePath).catch((e) => {
        this.logger.warn(`Failed to unlink temp CSV ${filePath}: ${e?.message}`);
      });
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on('error', reject);
    });

    this.logger.log(`CSV merge complete. Total rows: ${totalRows}`);
    return outputPath;
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if ((c === ',' && !inQuotes) || (c === '\n' && !inQuotes)) {
        result.push(current.trim());
        current = '';
      } else {
        current += c;
      }
    }
    result.push(current.trim());
    return result;
  }

  async cleanupTempFiles(input: CleanupTempFilesInput): Promise<void> {
    const { filePaths } = input;
    for (const filePath of filePaths) {
      try {
        await fsPromises.access(filePath);
        await fsPromises.unlink(filePath);
        this.logger.log(`Cleaned up temp file: ${filePath}`);
      } catch (error) {
        this.logger.warn(`Failed to cleanup temp file ${filePath}: ${error.message}`);
      }
    }
  }

  async updateConsolidatedReportStatus(input: UpdateConsolidatedReportStatusInput): Promise<void> {
    const { fileServerId, workflowId, status, errorMessage, reportPath } = input;
    
    await this.fileServerRepo.update(
      { id: fileServerId },
      {
        consolidatedReportStatus: status as ConsolidatedReportStatus,
        consolidatedReportPath: reportPath || undefined,
        consolidatedReportWorkflowId: workflowId || undefined,
        consolidatedReportUpdatedAt: new Date(),
      }
    );

    this.logger.log(`Updated consolidated report status for fileServerId: ${fileServerId} to ${status}`);
  }

  async getConsolidatedReportStatus(fileServerId: string): Promise<{
    status: ConsolidatedReportStatus | null;
    reportPath: string | null;
    workflowId: string | null;
    updatedAt: Date | null;
  } | null> {
    const fileServer = await this.fileServerRepo.findOne({
      where: { id: fileServerId },
      select: ['consolidatedReportStatus', 'consolidatedReportPath', 'consolidatedReportWorkflowId', 'consolidatedReportUpdatedAt'],
    });

    if (!fileServer) {
      return null;
    }

    return {
      status: fileServer.consolidatedReportStatus,
      reportPath: fileServer.consolidatedReportPath,
      workflowId: fileServer.consolidatedReportWorkflowId,
      updatedAt: fileServer.consolidatedReportUpdatedAt,
    };
  }

  async initializeStatus(fileServerId: string, workflowId: string, configName: string): Promise<void> {
    await this.fileServerRepo.update(
      { id: fileServerId },
      {
        consolidatedReportStatus: ConsolidatedReportStatus.IN_PROGRESS,
        consolidatedReportWorkflowId: workflowId,
        consolidatedReportPath: null,
        consolidatedReportUpdatedAt: new Date(),
      }
    );

    this.logger.log(`Initialized consolidated report status for fileServerId: ${fileServerId}`);
  }

  async getReportFilePath(fileServerId: string): Promise<string | null> {
    const fileServer = await this.fileServerRepo.findOne({
      where: { id: fileServerId },
      select: ['consolidatedReportPath'],
    });
    
    if (!fileServer?.consolidatedReportPath) {
      return null;
    }

    try {
      await fsPromises.access(fileServer.consolidatedReportPath);
      return fileServer.consolidatedReportPath;
    } catch (error) {
      this.logger.warn(`Report file not accessible: ${fileServer.consolidatedReportPath}`);
      return null;
    }
  }

  async readReportFile(filePath: string): Promise<Buffer> {
    return fsPromises.readFile(filePath);
  }

  async clearStatus(fileServerId: string): Promise<void> {
    await this.fileServerRepo.update(
      { id: fileServerId },
      {
        consolidatedReportStatus: null,
        consolidatedReportPath: null,
        consolidatedReportWorkflowId: null,
        consolidatedReportUpdatedAt: null,
      }
    );

    this.logger.log(`Cleared consolidated report status for fileServerId: ${fileServerId}`);
  }

  async onModuleDestroy() {
    if (this.browserInstance) {
      try {
        await this.browserInstance.close();
        this.logger.log(`Closed Puppeteer browser instance on module destroy`);
      } catch (error) {
        this.logger.warn(`Failed to close browser on shutdown: ${error.message}`);
      }
    }
  }
}
