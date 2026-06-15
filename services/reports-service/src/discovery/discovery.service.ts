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
import * as os from "os";
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

  /** Async path existence check (replaces fs.existsSync for I/O-bound checks). */
  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return false;
      throw err;
    }
  }

  async createReportFile(jobRunId: string, reportType: string): Promise<any> {
    this.logger.log(
      `Creating report for jobRunId: ${jobRunId} and reportType: ${reportType}`,
    );
    try {
      if (!(await this.pathExists(this.reportsDirectory))) {
        await fs.promises.mkdir(this.reportsDirectory, { recursive: true });
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
        await this.formatAndWriteToFile(reportData, csvFilePath);

        const pdfBuffer = await this.generatePdfFromData(reportData);
        await fs.promises.writeFile(pdfFilePath, pdfBuffer);

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

  private compiledDiscoveryTemplate: ReturnType<typeof hbs.compile> | null = null;

  private async getDiscoveryTemplate(): Promise<ReturnType<typeof hbs.compile>> {
    if (!this.compiledDiscoveryTemplate) {
      const templatePath = path.join(__dirname, '../../templates/views/discovery_pdf_report.hbs');
      const templateSource = await fs.promises.readFile(templatePath, 'utf8');
      this.compiledDiscoveryTemplate = hbs.compile(templateSource);
    }
    return this.compiledDiscoveryTemplate;
  }

  async generatePdfFromData(reportData: any[]): Promise<Buffer> {
    const template = await this.getDiscoveryTemplate();
    const categories: { [key: string]: any[] } = groupAndOrder(reportData, ReportType.DISCOVERY);
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
    try {
      const page = await browser.newPage();
      await page.setContent(htmlOutput, { waitUntil: "networkidle0" });
      const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
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

  async formatAndWriteToFile(reportData: any[], filePath: string) {
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

    await fs.promises.writeFile(filePath, csvContent);
  }

  /**
   * Same search order as JobRunService.ensureWritableReportsBaseDir so COC CSV files
   * is found whether it was written under REPORT_DOWNLOAD_LOCATION, ./reports, or /tmp/ndm-reports.
   */
  private getCandidateReportBaseDirs(): string[] {
    const candidates: string[] = [];
    const configured = process.env.REPORT_DOWNLOAD_LOCATION?.trim();
    if (configured) {
      candidates.push(path.resolve(configured));
    }
    candidates.push(path.resolve(process.cwd(), "reports"));
    candidates.push(path.join(os.tmpdir(), "ndm-reports"));
    return candidates;
  }

  private normalizeJobRunId(jobRunId: string): string {
    if (!isUUID(jobRunId)) {
      throw new BadRequestException("Invalid jobRunId format");
    }
    return jobRunId.toLowerCase();
  }

  private resolvePathInsideBase(baseDir: string, fileName: string): string {
    const resolvedBase = path.resolve(baseDir);
    const resolvedPath = path.resolve(resolvedBase, fileName);
    if (!resolvedPath.startsWith(`${resolvedBase}${path.sep}`)) {
      throw new BadRequestException("Invalid file path");
    }
    return resolvedPath;
  }

  private async findCocReportZipPath(jobRunId: string): Promise<string | null> {
    if (!isUUID(jobRunId)) return null;
    const safeJobRunId = this.normalizeJobRunId(jobRunId);
    const zipName = `${safeJobRunId}-coc-report.zip`;

    for (const base of this.getCandidateReportBaseDirs()) {
      if (!(await this.pathExists(base))) continue;
      const zipPath = this.resolvePathInsideBase(base, zipName);
      if (await this.pathExists(zipPath)) {
        return zipPath;
      }
    }
    return null;
  }

  private async findCocReportCsvBundlePaths(jobRunId: string): Promise<string[]> {
    if (!isUUID(jobRunId)) return [];
    const safeJobRunId = this.normalizeJobRunId(jobRunId);
    const bundleFileNames = [
      "coc-report.csv",
      "excluded-report.csv",
      "skipped-report.csv",
      "deleted-report.csv",
    ];

    for (const base of this.getCandidateReportBaseDirs()) {
      if (!(await this.pathExists(base))) continue;
      const bundleDir = this.resolvePathInsideBase(base, `${safeJobRunId}-coc-report`);
      const paths = bundleFileNames.map((name) =>
        this.resolvePathInsideBase(bundleDir, name),
      );
      const existsFlags = await Promise.all(
        paths.map((p) => this.pathExists(p)),
      );
      if (existsFlags.every(Boolean)) return paths;
    }
    return [];
  }

  async getReportsAsZip(
    jobRunIds: string[],
    reportType: string,
  ): Promise<Buffer> {
    const filesToZip: string[] = [];
    const isCoc = reportType.toUpperCase() === ReportType.COC;

    if (!isCoc) {
      if (!(await this.pathExists(this.reportsDirectory))) {
        throw new NotFoundException(
          `Reports directory does not exist: ${this.reportsDirectory}`,
        );
      }
    }

    for (const jobRunId of jobRunIds) {
      if (isCoc) {
        const cocZipPath = await this.findCocReportZipPath(jobRunId);
        if (cocZipPath) {
          filesToZip.push(cocZipPath);
        } else {
          const cocBundlePaths = await this.findCocReportCsvBundlePaths(jobRunId);
          if (cocBundlePaths.length > 0) {
            this.logger.log(
              `COC zip not found for ${jobRunId}; falling back to existing CSV bundle for on-demand zip`,
            );
            filesToZip.push(...cocBundlePaths);
          } else {
            this.logger.warn(
              `COC report zip and CSV bundle not found for jobRunId ${jobRunId}`,
            );
          }
        }
      } else {
        const fileName = `${jobRunId}-${reportType.toLowerCase()}-report.csv`;
        const filePath = path.join(this.reportsDirectory, fileName);

        if (await this.pathExists(filePath)) {
          filesToZip.push(filePath);
        } else {
          console.warn(`File not found: ${filePath}`);
        }
      }
    }

    if (filesToZip.length === 0) {
      throw new NotFoundException(
        "No valid report files found for the given inputs.",
      );
    }

    // COC artifacts are already zip files generated by job-run service.
    // For a single COC report, return that zip directly (avoid zip-in-zip).
    if (isCoc && filesToZip.length === 1) {
      return fs.promises.readFile(filesToZip[0]);
    }

    const zipBuffer = await this.createZipArchive(filesToZip);

    return zipBuffer;
  }

  async prepareDownload(
    jobRunId: string,
    reportType: string,
  ): Promise<string> {
    const safeJobRunId = this.normalizeJobRunId(jobRunId);
    const safeReportType = reportType.replace(/[^a-zA-Z]/g, "");

    const zipFilePath = this.getZipFilePath(safeJobRunId, safeReportType);

    if (!zipFilePath.startsWith(this.reportsDirectory)) {
      throw new BadRequestException('Invalid file path');
    }

    const zipExists = await fs.promises.access(zipFilePath).then(() => true).catch(() => false);
    if (!zipExists) {
      const reportTypeUpper = reportType.toUpperCase();
      const isCoc = reportTypeUpper === ReportType.COC;
      let sourcePath: string | null = null;

      if (isCoc) {
        const cocZipPath = await this.findCocReportZipPath(safeJobRunId);
        if (cocZipPath) {
          await fs.promises.mkdir(path.dirname(zipFilePath), { recursive: true });
          if (path.resolve(cocZipPath) !== path.resolve(zipFilePath)) {
            await fs.promises.copyFile(cocZipPath, zipFilePath);
          }
          this.logger.log(`Prepared existing COC ZIP at ${zipFilePath} from ${cocZipPath}`);
          sourcePath = zipFilePath;
        } else {
          const cocBundlePaths = await this.findCocReportCsvBundlePaths(safeJobRunId);
          if (cocBundlePaths.length > 0) {
            const zipBuffer = await this.createZipArchive(cocBundlePaths);
            await fs.promises.mkdir(path.dirname(zipFilePath), { recursive: true });
            await fs.promises.writeFile(zipFilePath, zipBuffer);
            this.logger.log(`Generated on-demand COC ZIP at ${zipFilePath} from ${cocBundlePaths.length} CSV files`);
            sourcePath = zipFilePath;
          }
        }
      } else {
        const csvPath = this.resolvePathInsideBase(
          this.reportsDirectory,
          `${safeJobRunId}-${safeReportType.toLowerCase()}-report.csv`,
        );
        const csvExists = await fs.promises.access(csvPath).then(() => true).catch(() => false);
        sourcePath = csvExists ? csvPath : null;
      }

      if (!sourcePath) {
        throw new NotFoundException(
          `Report not found for jobRunId: ${jobRunId}. Report may not be generated yet.`,
        );
      }

      if (!isCoc) {
        const zipBuffer = await this.createZipArchive([sourcePath]);
        await fs.promises.mkdir(path.dirname(zipFilePath), { recursive: true });
        await fs.promises.writeFile(zipFilePath, zipBuffer);
        this.logger.log(`Generated on-demand ZIP at ${zipFilePath} from ${sourcePath}`);
      }
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
    const tempZipPath = path.join(os.tmpdir(), `ndm-zip-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
    await this.createZipArchiveToFile(filePaths, tempZipPath);
    try {
      return await fs.promises.readFile(tempZipPath);
    } finally {
      await fs.promises.unlink(tempZipPath).catch(() => {});
    }
  }

  private createZipArchiveToFile(filePaths: string[], outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", () => resolve());
      output.on("error", (err) => reject(err));
      archive.on("error", (err) => reject(err));

      archive.pipe(output);
      filePaths.forEach((filePath) => {
        archive.file(filePath, { name: path.basename(filePath) });
      });
      archive.finalize();
    });
  }

  async getDiscoveryByFileServerId(fileServerId: string) {
    const singleRecord = await this.inventoryRepo.findOne({
      where: { fileServerPathId: fileServerId },
    });

    if (!singleRecord) {
      return [];
    }

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
