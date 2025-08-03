import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  Optional,
  Inject
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import * as path from "path";
import { InventoryEntity } from "../entities/inventory.entity";
import { Repository } from "typeorm";
import * as fs from "fs";
import * as archiver from "archiver";
import { ReportsEntity } from "src/entities/reports.entity";
import puppeteer from "puppeteer";
import { groupAndOrder } from "../utils/group-order";
import {
  escapeCsvValue,
  escapeReportData,
  sanitizeReportData,
  validateFilePath,
} from "src/utils/utils";
import { ReportType } from "../constants/enums";
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class DiscoveryService {
  private readonly logger : LoggerService;
  constructor(
    @InjectRepository(InventoryEntity)
    private readonly inventoryRepo: Repository<InventoryEntity>,
    @InjectRepository(ReportsEntity)
    private readonly reportsRepo: Repository<ReportsEntity>,
    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory
  ) {
    if (loggerFactory) {
      this.logger = loggerFactory.create(DiscoveryService.name);
    } else {
      // Fallback to basic NestJS Logger for worker threads
      this.logger = new Logger(DiscoveryService.name) as any;
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
        throw new BadRequestException("File path contains invalid characters.");
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
        throw new NotFoundException("No report data found");
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
      if (error instanceof BadRequestException ||
          error instanceof NotFoundException ||
          error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to generate report for jobRunId: ${jobRunId} and reportType: ${reportType}`,
      );
    }
  }
  generateHtmlTable(data: any[]): string {
    const categories: { [key: string]: any[] } = groupAndOrder(
      data,
      ReportType.DISCOVERY,
    );
    let htmlString = `
      <html>
      <head>
        <style>
          table {
            border-collapse: collapse;
            width: 100%;
          }
          th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
          }
          th {
            background-color: #f2f2f2;
          }
          tr:nth-child(even) {
            background-color: #f9f9f9;
          }
          tr:hover {
            background-color: #ddd;
          }
        </style>
      </head>
      <body>
        <h1>Data Summary</h1>
    `;
    for (const category in categories) {
      htmlString += `
        <h2>${category}</h2>
        <table>
          <tr>
            <th>Sub Category</th>
            <th></th>
          </tr>
      `;

      categories[category].forEach((entry) => {
        const subCategory = entry.sub_category;
        const value = entry.value;
        if (!!value) {
          htmlString += `
          <tr>
            <td>${subCategory}</td>
            <td>${value}</td>
          </tr>
        `;
        }
      });
      htmlString += `</table>`;
    }

    htmlString += `
      </body>
      </html>
    `;

    return htmlString;
  }

  async generatePdfFromData(reportData: any[]): Promise<Buffer> {
    try {
      // Sanitize and escape the report data to prevent XSS attacks
    const sanitizedData = sanitizeReportData(reportData);
    const escapedData = escapeReportData(sanitizedData);

    const htmlOutput = this.generateHtmlTable(escapedData);
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
      ],
      executablePath: "/usr/bin/chromium-browser",
      protocolTimeout: 60000,
    });
    const page = await browser.newPage();
    await page.setContent(htmlOutput, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });

    await browser.close();
    return Buffer.from(pdfBuffer);
    } catch(error) {
      this.logger.error(`Failed to generate PDF from data, error: ${error}`);
      if (error instanceof BadRequestException ||
          error instanceof NotFoundException ||
          error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException("Failed to generate PDF from data");
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

  formatAndWriteToFile(reportData: any[], filePath: string) {
    try {
      if (!validateFilePath(filePath)) {
      this.logger.error(`File path contains invalid characters: ${filePath}`);
      throw new BadRequestException("File path contains invalid characters.");
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
    } catch (error) {
      this.logger.error(`Error writing to file: ${filePath}`, error);
      if (error instanceof BadRequestException || 
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException) {
          throw error;
      }
      throw new InternalServerErrorException(
        `Failed to write report data to file: ${filePath}`,
      );
    }
  }

  async getReportsAsZip(
    jobRunIds: string[],
    reportType: string,
  ): Promise<Buffer> {

    try {
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
    } catch (error) {
      this.logger.error(`Error in getReportsAsZip:`, error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        "Failed to create zip archive for the reports.",
      );
    }
  }

  async createZipArchive(filePaths: string[]): Promise<Buffer> {
    try {
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
    } catch (error) {
      this.logger.error(`Error creating zip archive:`, error);
      throw new InternalServerErrorException(
        "Failed to create zip archive for the reports.",
      );
    }
  }

  async getDiscoveryByFileServerId(fileServerId: string) {
    const singleRecord = await this.inventoryRepo.findOne({
      where: { fileServerPathId: fileServerId },
    });

    try {
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
    } catch (error) {
      this.logger.error(`Error in getDiscoveryByFileServerId:`, error);
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to retrieve discovery data for the specified file server.');
    }
  }

  async getDiscoveryByFileServerIdAndParentPath(
    fileServerId: string,
    parentPath: string,
  ) {
    try {
      const data = await this.getDataFromParentPath(fileServerId, parentPath);
      return data.map((item) => ({
        ...item,
        childs: [],
      }));
    } catch (error) {
      this.logger.error(`Error in getDiscoveryByFileServerIdAndParentPath:`, error);
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to retrieve discovery data for the specified file server and path.');
    }
  }

  getDataFromParentPath = async (fileServerId: string, parentPath: string) => {
    try {
      return await this.inventoryRepo.find({
        where: { fileServerPathId: fileServerId, parentPath: parentPath },
      });
    } catch (error) {
      this.logger.error(`Error in getDataFromParentPath:`, error);
      throw new ServiceUnavailableException('Unable to fetch data at this time. Please try again later.');
    }
  };
}
