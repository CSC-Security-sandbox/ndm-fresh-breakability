import { randomUUID } from "crypto";
import { isUUID } from "class-validator";
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  Inject,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import * as path from "path";
import { Repository } from "typeorm";
import * as fs from "fs";
import * as archiver from "archiver";
import puppeteer from "puppeteer";
import * as hbs from 'hbs';

import { ReportsEntity } from "src/entities/reports.entity";
import { InventoryEntity } from "../entities/inventory.entity";
import { groupAndOrder } from "../utils/group-order";
import {
  escapeCsvValue,
  sanitizeReportData,
  validateFilePath,
} from "src/utils/utils";
import { ReportType } from "../constants/enums";
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';

const DOWNLOAD_TOKEN_TTL_MS = 60_000;

@Injectable()
export class DiscoveryService {
  private readonly logger: LoggerService | Logger;

  private readonly downloadTokens = new Map<string, { filePath: string; fileName: string; expiresAt: number }>();

  constructor(
    @InjectRepository(InventoryEntity)
    private readonly inventoryRepo: Repository<InventoryEntity>,
    @InjectRepository(ReportsEntity)
    private readonly reportsRepo: Repository<ReportsEntity>,
    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory,
  ) {
    if (loggerFactory) {
      this.logger = loggerFactory.create(DiscoveryService.name);
    } else {
      // Fallback to basic NestJS Logger
      this.logger = new Logger(DiscoveryService.name);
    }
  }

  get getReportsDirectory(): string {
    return process.env.REPORT_DOWNLOAD_LOCATION || "./reports";
  }

  private readonly reportsDirectory =
    process.env.REPORT_DOWNLOAD_LOCATION || "./reports";

  async createReportFile(jobRunId: string, reportType: string): Promise<any> {
    this.logger.log(
      `Creating report for jobRunId: ${jobRunId} and reportType: ${reportType}`,
    );
    try {
      if (!fs.existsSync(this.reportsDirectory)) {
        fs.mkdirSync(this.reportsDirectory, { recursive: true });
      }
      const pdfFileName = `${jobRunId}-${reportType.toLowerCase()}-report.pdf`;
      const pdfFilePath = path.join(this.reportsDirectory, pdfFileName);
      if (!validateFilePath(pdfFilePath)) {
        this.logger.error(
          `File path contains invalid characters: ${pdfFilePath}`,
        );
        throw new Error("File path contains invalid characters.");
      } else {
        this.logger.log(`File path validation passed: ${pdfFilePath}`);
      }

      const startTime = Date.now();
      await this.inventoryRepo.query(
        `CALL ${process.env.SCHEMA}.generate_discovery_report($1, $2)`,
        [jobRunId, process.env.SCHEMA],
      );
      this.logger.log(`procedure ended in ${Date.now() - startTime}`);
      const latestReport = await this.reportsRepo.find({
        where: { jobRunId: jobRunId, reportType: reportType },
        order: { createdAt: "DESC" },
        take: 1,
      });
      this.logger.log(
        `Latest report fetched for jobRunId: ${jobRunId} and latestReport: ${JSON.stringify(latestReport)}`,
      );

      if (latestReport?.length === 0) {
        this.logger.error(
          `No report data found for jobRunId: ${jobRunId} and reportType: ${reportType}`,
        );
        throw new Error("No report data found");
      } else {
        const reportData = JSON.parse(latestReport[0]?.reportData);
        const csvFileName = `${jobRunId}-${reportType.toLowerCase()}-report.csv`;
        const csvFilePath = path.join(this.reportsDirectory, csvFileName);
        this.formatAndWriteToFile(reportData, csvFilePath);

        const pdfBuffer = await this.generatePdfFromData(reportData);
        fs.writeFileSync(pdfFilePath, pdfBuffer);

        return {
          message: "Report generated successfully",
        };
      }
    } catch (error) {
      this.logger.log(error);
      throw new InternalServerErrorException(
        `Failed to generate report for jobRunId: ${jobRunId} and reportType: ${reportType}`,
      );
    }
  }

  async generatePdfFromData(reportData: any[]): Promise<Buffer> {
    const templatePath = path.join(__dirname, '../../templates/views/discovery_pdf_report.hbs');
    const templateSource = fs.readFileSync(templatePath, 'utf8');
    const template = hbs.compile(templateSource);

    const categories: { [key: string]: any[] } = groupAndOrder(reportData, ReportType.DISCOVERY);

    // Step 2: Generate HTML from template and data
    const htmlOutput = template(categories);
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
      ],
      protocolTimeout: 60000,
    });
    const page = await browser.newPage();
    await page.setContent(htmlOutput, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });

    await browser.close();
    return Buffer.from(pdfBuffer);
  }

  async createJobsPDFReportData(jobRunId: string): Promise<any> {
    this.logger.log(`Creating jobs report data for jobRunId: ${jobRunId}`);
    try {
      this.logger.log(`Schema used: ${process.env.SCHEMA}`);
      this.logger.log(
        `Executing: CALL ${process.env.SCHEMA}.jobs_report_data_v2('${jobRunId}'::UUID, ${process.env.SCHEMA});`,
      );
      await this.inventoryRepo.query(
        `CALL ${process.env.SCHEMA}.jobs_report_data_v2($1::UUID, $2);`,
        [jobRunId, process.env.SCHEMA],
      );
      return { message: "Report data generated successfully for jobs report" };
    } catch (error) {
      this.logger.log(
        `Failed to generate report for jobRunId: ${jobRunId}, error: ${error}`,
      );
      throw new InternalServerErrorException(
        `Failed to generate report for jobRunId: ${jobRunId}`,
      );
    }
  }

  formatAndWriteToFile(reportData: any[], filePath: string) {
    if (!validateFilePath(filePath)) {
      this.logger.error(`File path contains invalid characters: ${filePath}`);
      throw new Error("File path contains invalid characters.");
    } else {
      this.logger.log(`File path validation passed: ${filePath}`);
    }
    const csvReportData = Object.values(
      groupAndOrder(reportData, ReportType.DISCOVERY),
    ).flat();
    const dynamicHeaders = new Set<string>();
    if (csvReportData && csvReportData.length > 0) {
      csvReportData.forEach((entry) => {
        const subCategory = entry.sub_category;
        if (subCategory && entry.value !== null) {
          dynamicHeaders.add(subCategory);
        }
      });
    }
    
    const allHeaders = [...Array.from(dynamicHeaders)];

    const row: string[] = [];
    allHeaders.forEach((header) => {
      let value = "";
      if (csvReportData && csvReportData.length > 0) {
        csvReportData?.forEach((entry) => {
          if (header in entry) {
            value =
              entry[header] !== undefined ? entry[header]?.toString() : "";
          } else if (header === entry?.sub_category) {
            value = entry?.value !== undefined ? entry?.value?.toString() : "";
          }
        });
      }
      row.push(value);
    });

    const csvContent = [
      allHeaders.join(","),
      row.map(escapeCsvValue).join(","),
    ].join("\n");

    fs.writeFileSync(filePath, csvContent);
  }

  async getReportsAsZip(
    jobRunIds: string[],
    reportType: string,
  ): Promise<Buffer> {
    const filesToZip: string[] = [];

    if (!fs.existsSync(this.reportsDirectory)) {
      throw new NotFoundException(
        `Reports directory does not exist: ${this.reportsDirectory}`,
      );
    }
    for (const jobRunId of jobRunIds) {
      const fileName = `${jobRunId}-${reportType.toLowerCase()}-report.csv`;
      const filePath = path.join(this.reportsDirectory, fileName);

      if (fs.existsSync(filePath)) {
        filesToZip.push(filePath);
      } else {
        console.warn(`File not found: ${filePath}`);
      }
    }

    if (filesToZip.length === 0) {
      throw new NotFoundException(
        "No valid report files found for the given inputs.",
      );
    }

    const zipBuffer = await this.createZipArchive(filesToZip);

    return zipBuffer;
  }

  async prepareDownload(
    jobRunId: string,
    reportType: string,
  ): Promise<string> {
    if (!isUUID(jobRunId)) {
      throw new BadRequestException('Invalid jobRunId format');
    }

    const zipFilePath = this.getZipFilePath(jobRunId, reportType);

    if (!zipFilePath.startsWith(this.reportsDirectory)) {
      throw new BadRequestException('Invalid file path');
    }

    const zipExists = await fs.promises.access(zipFilePath).then(() => true).catch(() => false);
    if (!zipExists) {
      throw new NotFoundException(
        `Report not found for jobRunId: ${jobRunId}. Report may not be generated yet.`,
      );
    }

    const token = randomUUID();
    // Derive the filename from the already-sanitized path to avoid using raw
    // user input a second time.
    const fileName = path.basename(zipFilePath);
    this.downloadTokens.set(token, {
      filePath: zipFilePath,
      fileName,
      expiresAt: Date.now() + DOWNLOAD_TOKEN_TTL_MS,
    });
    this.cleanupExpiredTokens();
    this.logger.log(
      `Prepared download token ${token} for jobRunId: ${jobRunId} (stored in memory, expires in ${DOWNLOAD_TOKEN_TTL_MS / 1000}s)`,
    );
    return token;
  }

  async streamZipToResponse(token: string, res: import('express').Response): Promise<void> {
    const { filePath, fileName } = await this.getAndConsumeDownloadToken(token);
    const stat = await fs.promises.stat(filePath);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': stat.size.toString(),
    });
    const stream = fs.createReadStream(filePath);

    stream.on('error', (err) => {
      this.logger.error(`Stream error while downloading ${fileName}: ${err.message}`, err.stack);
      if (!res.headersSent) {
        res.status(500).end('Failed to download file.');
      } else {
        res.end();
      }
    });

    res.on('close', () => {
      if (!stream.destroyed) {
        stream.destroy();
      }
    });

    stream.pipe(res);
  }

  async getAndConsumeDownloadToken(token: string): Promise<{ filePath: string; fileName: string }> {
    const entry = this.downloadTokens.get(token);
    if (!entry) {
      throw new NotFoundException("Download token not found, expired, or already used");
    }
    this.downloadTokens.delete(token);
    if (Date.now() > entry.expiresAt) {
      throw new NotFoundException("Download token has expired");
    }
    return { filePath: entry.filePath, fileName: entry.fileName };
  }

  private cleanupExpiredTokens(): void {
    const now = Date.now();
    for (const [key, entry] of this.downloadTokens) {
      if (now > entry.expiresAt) this.downloadTokens.delete(key);
    }
  }

  getZipFilePath(jobRunId: string, reportType: string): string {
    // Strip to known-safe character sets before using either value in a path
    // expression. UUIDs are hex digits and hyphens; report types are letters only.
    const safeJobRunId = jobRunId.replace(/[^a-zA-Z0-9-]/g, '');
    const safeReportType = reportType.replace(/[^a-zA-Z]/g, '');
    const fileName = `${safeJobRunId}-${safeReportType.toLowerCase()}-report.zip`;
    return path.join(this.reportsDirectory, fileName);
  }

  async createZipArchive(filePaths: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const archive = archiver("zip", { zlib: { level: 9 } });
      const buffers: Buffer[] = [];

      filePaths.forEach((filePath) => {
        const fileName = path.basename(filePath);
        archive.file(filePath, { name: fileName });
      });

      archive.on("data", (data) => buffers.push(data));

      archive.on("end", () => resolve(Buffer.concat(buffers)));

      archive.on("error", (err) => reject(err));

      archive.finalize();
    });
  }

  async getDiscoveryByFileServerId(fileServerId: string) {
    const singleRecord = await this.inventoryRepo.findOne({
      where: { fileServerPathId: fileServerId },
    });

    const data = await this.getDataFromParentPath(
      fileServerId,
      singleRecord.path,
    );
    const transformedData = data.map((item) => ({
      ...item,
      childs: [],
    }));

    return [
      {
        root: path.basename(singleRecord.path),
        childs: transformedData,
      },
    ];
  }

  async getDiscoveryByFileServerIdAndParentPath(
    fileServerId: string,
    parentPath: string,
  ) {
    const data = await this.getDataFromParentPath(fileServerId, parentPath);
    return data.map((item) => ({
      ...item,
      childs: [],
    }));
  }

  getDataFromParentPath = async (fileServerId: string, parentPath: string) => {
    return await this.inventoryRepo.find({
      where: { fileServerPathId: fileServerId, parentPath: parentPath },
    });
  };
}
