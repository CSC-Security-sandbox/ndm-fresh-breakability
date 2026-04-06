import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from "fs";
import * as archiver from "archiver";
import * as path from "path";
import { ReportType } from 'src/constants/enums';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { ReportsEntity } from 'src/entities/reports.entity';
import { PDFGeneratorService } from 'src/generator/pdf-generator.service';
import { PDFTemplate } from 'src/generator/pdf-generator.type';
import { groupAndOrder } from 'src/utils/group-order';
import { escapeCsvValue } from 'src/utils/utils';
import { DataSource, Repository } from 'typeorm';
import { DiscoveryReportSection, GenerateDiscoveryReportInput, GetDiscoverySectionInput, UpdateDiscoveryReportInput } from './discovery-report.type';
import { QueryMapper } from './query/discovery-report.query-mapper';
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';
import { ProjectIdCacheService } from '../../utils/project-id-cache.service';

@Injectable()
export class DiscoveryReportService {

    private readonly logger : LoggerService;
    private basePath: string;
    private readonly schemaName: string;

    constructor(
        private dataSource: DataSource,
        private readonly pdfGenerator: PDFGeneratorService,
        private readonly configService: ConfigService,
        @InjectRepository(ReportsEntity)
        private readonly reportsRepo: Repository<ReportsEntity>,
        @InjectRepository(JobRunEntity)
        private readonly jobRunRepo: Repository<JobRunEntity>,
        private readonly projectIdCacheService: ProjectIdCacheService,
        @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory,
    ) {
        if (loggerFactory) {
            this.logger = loggerFactory.create(DiscoveryReportService.name);
        } else {
            // Fallback to basic NestJS Logger
            this.logger = new Logger(DiscoveryReportService.name) as any;
        }
        this.basePath = this.configService.get<string>('app.baseDir') ;
        this.schemaName = this.configService.get<string>('typeorm.schema') || 'datamigrator';
    }

    async getSection({ jobRunId, section, updateSection }: GetDiscoverySectionInput): Promise<DiscoveryReportSection[]> {
        const projectId = await this.projectIdCacheService.getProjectIdFromCache(jobRunId);
        this.logger.log(`projectId: ${projectId} Processing getSection for jobRunId: ${jobRunId}, section: ${section}, updateSection: ${updateSection}`);
        
        try {
            const output = await this.dataSource.query(QueryMapper[section].query(this.schemaName), [jobRunId]);
            const sectionData = QueryMapper[section].mapper(output);
            
            this.logger.log(`projectId: ${projectId} Retrieved ${sectionData.length} records for section ${section} in jobRunId: ${jobRunId}`);
            
            if (!updateSection) 
                return sectionData;
            
            await this.updateJsonReport({ jobRunId, data: sectionData, updateType: 'data' });
            return [];
        } catch (error) {
            this.logger.error(`projectId: ${projectId} Error in getSection for jobRunId: ${jobRunId}, section: ${section}: ${error.message}`, error?.stack || error);
            throw error;
        }
    }

    async generatePdfReport({jobRunId}: GenerateDiscoveryReportInput) {
        const projectId = await this.projectIdCacheService.getProjectIdFromCache(jobRunId);
        this.logger.log(`projectId: ${projectId} Starting PDF report generation for jobRunId: ${jobRunId}`);
        
        try {
            const report = await this.reportsRepo.findOne({ where: { jobRunId, reportType: ReportType.DISCOVERY } });
            
            if (!report) {
                this.logger.error(`projectId: ${projectId} No discovery report found in database for jobRunId: ${jobRunId}`);
                throw new Error(`No discovery report found for jobRunId: ${jobRunId}`);
            }
            
            const categories = groupAndOrder(JSON.parse(report.reportData), ReportType.DISCOVERY);
            this.logger.log(`projectId: ${projectId} Parsed report data with ${Object.keys(categories).length} categories for jobRunId: ${jobRunId}`);
            
            // Generate PDF using the PDF generator service
            const pdfBuffer = await this.pdfGenerator.generatePDF({
              data: categories,
              template: PDFTemplate.DISCOVERY_REPORT,
              pdfOptions: {
                format: 'A2',
                printBackground: true,
                scale: 0.5,
                landscape: false,
                width: '420mm', // A2 width
                height: '594mm', // A2 height
              },
              context: {
                jobRunId,
                projectId
              }
            });
            
            const pdfFilePath = `${this.basePath}/${jobRunId}-discover-report.pdf`;
            await fs.promises.writeFile(pdfFilePath, pdfBuffer);
            this.logger.log(`projectId: ${projectId} PDF report generated successfully at: ${pdfFilePath}`);
            return { message: 'PDF report generated successfully', path: pdfFilePath };
        } catch (error) {
            this.logger.error(`projectId: ${projectId} Error generating PDF report for jobRunId: ${jobRunId}: ${error.message}`, error?.stack || error);
            throw error;
        }
    }

    async generateCsvReport({jobRunId}: GenerateDiscoveryReportInput) {
        const projectId = await this.projectIdCacheService.getProjectIdFromCache(jobRunId);
        this.logger.log(`projectId: ${projectId} Starting CSV report generation for jobRunId: ${jobRunId}`);
        
        try {
            const report = await this.reportsRepo.findOne({ where: { jobRunId, reportType: ReportType.DISCOVERY } });
            
            if (!report) {
                this.logger.error(`projectId: ${projectId} No discovery report found in database for CSV generation, jobRunId: ${jobRunId}`);
                throw new Error(`No discovery report found for jobRunId: ${jobRunId}`);
            }
            
            const reportData = Object.values(groupAndOrder(JSON.parse(report.reportData), ReportType.DISCOVERY)).flat();
            this.logger.log(`projectId: ${projectId} Processing ${reportData.length} data entries for CSV generation, jobRunId: ${jobRunId}`);

            // Dynamically determine headers based on sub_category
            const dynamicHeaders = new Set<string>();  
            reportData?.forEach(entry => {
                if (entry.sub_category && entry.value !== null)
                    dynamicHeaders.add(entry.sub_category);
            });
            const headers = Array.from(dynamicHeaders);
            this.logger.log(`projectId: ${projectId} Generated ${headers.length} CSV headers for jobRunId: ${jobRunId}`);
            
            // Build Rows
            const rows: string[] = []
            headers.forEach(header => {
                for (const entry of reportData) {
                    if (header in entry) {
                        rows.push(entry[header] !== undefined ? entry[header]?.toString() : "");
                        break;
                    } else if (header === entry?.sub_category) {
                        rows.push(entry?.value !== undefined ? entry?.value?.toString() : "");
                        break;
                    }
                }
            });
            const csvContent = [headers.join(","), rows.map(escapeCsvValue).join(",")].join("\n");

            // Write CSV to a temp file, zip it, then remove the raw CSV
            const csvFilePath = `${this.basePath}/${jobRunId}-discover-report.csv`;
            await fs.promises.writeFile(csvFilePath, csvContent);

            const zipFilePath = `${this.basePath}/${jobRunId}-discover-report.zip`;
            await this.createZipArchive(csvFilePath, zipFilePath);
            await fs.promises.unlink(csvFilePath);

            this.logger.log(`projectId: ${projectId} CSV report zipped successfully at: ${zipFilePath}`);
            return { message: 'CSV report generated successfully', path: zipFilePath };
        } catch (error) {
            this.logger.error(`projectId: ${projectId} Error generating CSV report for jobRunId: ${jobRunId}: ${error.message}`, error?.stack || error);
            throw error;
        }
    }

    async updateJsonReport({jobRunId, updateType, data}: UpdateDiscoveryReportInput) {
        const projectId = await this.projectIdCacheService.getProjectIdFromCache(jobRunId);
        this.logger.log(`projectId: ${projectId} Starting updateJsonReport for jobRunId: ${jobRunId}, updateType: ${updateType}`);
        
        try {
            if(updateType === 'status') {
                const update = await this.jobRunRepo.update({ id: jobRunId }, { isReportReady: true });
                this.logger.log(`projectId: ${projectId} Discovery report status updated for jobRunId: ${jobRunId}`);
                return "Updated The report status Successfully";
            }

            let report = await this.reportsRepo.findOne({ where: { jobRunId, reportType: ReportType.DISCOVERY } });
            if (!report) {
                this.logger.log(`projectId: ${projectId} Creating new discovery report entry for jobRunId: ${jobRunId}`);
                report = this.reportsRepo.create({
                    jobRunId,
                    reportType: ReportType.DISCOVERY,
                });
            }

            const currentData = report.reportData ? JSON.parse(report.reportData) : [];
            const updatedData = [...currentData, ...data];
            report.reportData = JSON.stringify(updatedData);
            await this.reportsRepo.save(report);
            
            this.logger.log(`projectId: ${projectId} Updated discovery report data for jobRunId: ${jobRunId}, added ${data.length} new entries`);
            return "Updated The report Data Successfully";
        } catch (error) {
            this.logger.error(`projectId: ${projectId} Error in updateJsonReport for jobRunId: ${jobRunId}, updateType: ${updateType}: ${error.message}`, error?.stack || error);
            throw error;
        }
    }

    private createZipArchive(csvFilePath: string, zipFilePath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipFilePath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            output.on('close', resolve);
            archive.on('error', reject);

            archive.pipe(output);
            archive.file(csvFilePath, { name: path.basename(csvFilePath) });
            archive.finalize();
        });
    }
}