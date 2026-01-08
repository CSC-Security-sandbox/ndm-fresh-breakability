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
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';

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

export interface GetConsolidatedReportPathInput {
  fileServerId: string;
  configName: string;
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

  async mergePdfFiles(input: MergePdfFilesInput): Promise<string> {
    const { pdfFilePaths, outputPath } = input;
    this.logger.log(`Merging ${pdfFilePaths.length} PDF files into ${outputPath}`);

    const mergedPdf = await PDFDocument.create();

    for (let i = 0; i < pdfFilePaths.length; i++) {
      try {
        const pdfBuffer = await fsPromises.readFile(pdfFilePaths[i]);
        const pdf = await PDFDocument.load(pdfBuffer);
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        
        copiedPages.forEach((page) => {
          mergedPdf.addPage(page);
        });
        
        this.logger.log(`Added ${copiedPages.length} pages from PDF ${i + 1}`);
        await fsPromises.unlink(pdfFilePaths[i]);
      } catch (error) {
        this.logger.error(`Failed to process PDF buffer ${i + 1}: ${error.message}`);
        throw new Error(`Failed to process PDF ${i + 1}: ${error.message}`);
      }
    }

    const mergedPdfBytes = await mergedPdf.save();
    await fsPromises.writeFile(outputPath, Buffer.from(mergedPdfBytes));
    this.logger.log(`PDF merge complete. Total pages: ${mergedPdf.getPageCount()}`);

    return outputPath;
  }

  async getConsolidatedReportPath(input: GetConsolidatedReportPathInput): Promise<string> {
    const { configName } = input;
  
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sanitizedConfigName = configName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const fileName = `${sanitizedConfigName}-consolidated-discovery-report-${timestamp}.pdf`;
    return path.join(this.reportsDirectory, fileName);
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
