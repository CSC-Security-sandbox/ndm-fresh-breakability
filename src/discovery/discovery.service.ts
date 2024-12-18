import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as path from 'path';
import { InventoryEntity } from '../entities/inventory.entity';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as archiver from 'archiver';
@Injectable()
export class DiscoveryService {
    constructor(
        @InjectRepository(InventoryEntity)
        private readonly inventoryRepo: Repository<InventoryEntity>,
    ) {}

    private readonly reportsDirectory = process.env.REPORT_DOWNLOAD_LOCATION || "./reports"

    async createReportFile(jobRunId: string, reportType: string): Promise<Buffer> {
        try {
          if (!fs.existsSync(this.reportsDirectory)) {
            fs.mkdirSync(this.reportsDirectory, { recursive: true });
          }
      
          // Generate the filename using jobRunId and reportType
          const fileName = `${jobRunId}-${reportType.toLowerCase()}-report.txt`;
          const filePath = path.join(this.reportsDirectory, fileName);
      
          // Ensure the file exists or create it
          if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, '');
          }
      
          return fs.readFileSync(filePath);
        } catch (error) {
          throw new InternalServerErrorException(
            `Failed to generate report for jobRunId: ${jobRunId} and reportType: ${reportType}`,
          );
        }
      }


    async getReportsAsZip(jobRunIds: string[], reportType: string): Promise<Buffer> {
        const filesToZip: string[] = [];

        if (!fs.existsSync(this.reportsDirectory)) {
        throw new NotFoundException(`Reports directory does not exist: ${this.reportsDirectory}`);
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
        throw new NotFoundException('No valid report files found for the given inputs.');
        }

        const zipBuffer = await this.createZipArchive(filesToZip);

        return zipBuffer;
    }

    private async createZipArchive(filePaths: string[]): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const archive = archiver('zip', { zlib: { level: 9 } });
            const buffers: Buffer[] = [];

            filePaths.forEach((filePath) => {
                const fileName = path.basename(filePath);
                archive.file(filePath, { name: fileName });
            });

            archive.on('data', (data) => buffers.push(data));

            archive.on('end', () => resolve(Buffer.concat(buffers)));

            archive.on('error', (err) => reject(err));

            archive.finalize();
        });
    }  


    async getDiscoveryByFileServerId(fileServerId: string) {
        const singleRecord = await this.inventoryRepo.findOne({
            where: { fileServerPathId: fileServerId }
        });

        const data = await this.getDataFromParentPath(fileServerId, singleRecord.path);
        const transformedData = data.map((item) => ({
            ...item,
            childs: []
        }));
        
        return [{
            root: path.basename(singleRecord.path),
            childs: transformedData,
        }];
    }
    
    async getDiscoveryByFileServerIdAndParentPath(fileServerId: string, parentPath: string) {
        const data = await this.getDataFromParentPath(fileServerId, parentPath);
        return data.map((item) => ({
            ...item,
            childs: []
        }));
    }

    getDataFromParentPath = async (fileServerId: string, parentPath: string) => {
        return await this.inventoryRepo.find({
            where: { fileServerPathId: fileServerId, parentPath: parentPath }
        });
    }

}


