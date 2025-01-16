import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import * as path from "path";
import { InventoryEntity } from "../entities/inventory.entity";
import { Repository } from "typeorm";
import * as fs from "fs";
import * as archiver from "archiver";
import { ReportsEntity } from "src/entities/reports.entity";
@Injectable()
export class DiscoveryService {
  private logger: Logger = new Logger(DiscoveryService.name);
  constructor(
    @InjectRepository(InventoryEntity)
    private readonly inventoryRepo: Repository<InventoryEntity>,
    @InjectRepository(ReportsEntity)
    private readonly reportsRepo: Repository<ReportsEntity>
  ) {}

  get getReportsDirectory(): string {
    return process.env.REPORT_DOWNLOAD_LOCATION || "./reports";
  }

  private readonly reportsDirectory =
    process.env.REPORT_DOWNLOAD_LOCATION || "./reports";

  async createReportFile(jobRunId: string, reportType: string): Promise<any> {
    this.logger.log(
      `Creating report for jobRunIdooo: ${jobRunId} and reportType: ${reportType}`
    );
    try {
      if (!fs.existsSync(this.reportsDirectory)) {
        fs.mkdirSync(this.reportsDirectory, { recursive: true });
      }

      await this.inventoryRepo.query(
        "CALL migrateadmin.generate_discovery_report($1)",
        [jobRunId]
      );

      const latestReport = await this.reportsRepo.find({
        where: { jobRunId: jobRunId, reportType: reportType },
        order: { createdAt: "DESC" },
        take: 1,
      });

      const fileName = `${jobRunId}-${reportType.toLowerCase()}-report.csv`;
      const filePath = path.join(this.reportsDirectory, fileName);

      if (latestReport?.length > 0) {
        this.formatAndWriteToFile(
          JSON.parse(latestReport[0].reportData),
          filePath
        );
      }

      return {
        message: "Report generated successfully",
      };
    } catch (error) {
      this.logger.log(error);
      throw new InternalServerErrorException(
        `Failed to generate report for jobRunId: ${jobRunId} and reportType: ${reportType}`
      );
    }
  }

  formatAndWriteToFile(data: any[], filePath: string): void {
    const resultRow: { [key: string]: string | number } = {};

    data.forEach((entry) => { 
      resultRow[entry.sub_category] = entry.value;
    });
    const headers = Object.keys(resultRow);
    const values = headers.map((header) => {
      const value = resultRow[header] || "";
      return typeof value === 'string' && value.includes(";") ? `"${value}"` : value;
  });

    const csvData = [headers.join(","), values.join(",")].join("\n");
    console.log("csvData: ", csvData);
    if(filePath.startsWith(this.reportsDirectory)) {
      fs.writeFileSync(filePath, csvData);
      console.log(`Data has been written to ${filePath}`);
    }
  }

  async getReportsAsZip(
    jobRunIds: string[],
    reportType: string
  ): Promise<Buffer> {
    const filesToZip: string[] = [];

    if (!fs.existsSync(this.reportsDirectory)) {
      throw new NotFoundException(
        `Reports directory does not exist: ${this.reportsDirectory}`
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
        "No valid report files found for the given inputs."
      );
    }

    const zipBuffer = await this.createZipArchive(filesToZip);

    return zipBuffer;
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
      singleRecord.path
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
    parentPath: string
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
