import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
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
  constructor(
    @InjectRepository(InventoryEntity)
    private readonly inventoryRepo: Repository<InventoryEntity>,
    @InjectRepository(ReportsEntity)
    private readonly reportsRepo: Repository<ReportsEntity>
  ) {}

  private readonly reportsDirectory =
    process.env.REPORT_DOWNLOAD_LOCATION || "./reports";

  async createReportFile(jobRunId: string, reportType: string): Promise<any> {
    function formatAndWriteToFile(data: any[], filePath: string): void {
        const groupedData = data.reduce((acc, entry) => {
          if (!acc[entry.category]) {
            acc[entry.category] = [];
          }
          acc[entry.category].push(entry);
          return acc;
        }, {});
       
        const formattedString = Object.entries(groupedData)
          .map(([category, entries]) => {
            let categoryString = `== ${category} ==\n`;
       
            const tableRows = (entries as any[])
              .map(
                (entry) => `${entry.sub_category.padEnd(20)} | ${entry.count_or_space}`
              )
              .join("\n");
       
            return `${categoryString}${tableRows}\n`;
          })
          .join("\n");
       
        fs.writeFileSync(filePath, formattedString);
        console.log(`Data has been written to ${filePath}`);
      }

    try {
      if (!fs.existsSync(this.reportsDirectory)) {
        fs.mkdirSync(this.reportsDirectory, { recursive: true });
      }
      const result = await this.inventoryRepo.query(
        "CALL migrateadmin.generate_discovery_report($1)",
        [jobRunId]
      );

      const latestReport = await this.reportsRepo.find({
        order: { createdAt: "DESC" },
        take: 1,
      });


      const fileName = `${jobRunId}-${reportType.toLowerCase()}-report.txt`;
      const filePath = path.join(this.reportsDirectory, fileName);

      if (latestReport) {
        formatAndWriteToFile(JSON.parse(latestReport[0].reportData), filePath)
      }

      return {
        message: "Report generated successfully",
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to generate report for jobRunId: ${jobRunId} and reportType: ${reportType}`
      );
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
      const fileName = `${jobRunId}-${reportType.toLowerCase()}-report.txt`;
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

  private async createZipArchive(filePaths: string[]): Promise<Buffer> {
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
