import { HttpException, HttpStatus, Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from "path";
import { ReportType } from 'src/constants/enums';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { ReportsEntity } from 'src/entities/reports.entity';
import { PDFGeneratorService } from 'src/generator/pdf-generator.service';
import { PDFTemplate } from 'src/generator/pdf-generator.type';
import { Repository } from 'typeorm';
import { DiscoveryService } from '../discovery/discovery.service';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { ProjectIdCacheService } from '../utils/project-id-cache.service';

@Injectable()
export class PdfService {
    private readonly logger: Logger | LoggerService;
    private readonly reportsDirectory =
    process.env.REPORT_DOWNLOAD_LOCATION || "./reports";
    constructor( 
      @InjectRepository(InventoryEntity)
      private readonly inventoryRepo: Repository<InventoryEntity>,
      @InjectRepository(ReportsEntity)
      private readonly reportsRepo: Repository<ReportsEntity>,
      private readonly discoveryService: DiscoveryService,
      private readonly pdfGeneratorService: PDFGeneratorService,
      private readonly projectIdCacheService: ProjectIdCacheService,
      @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory,
    ) {
      if (loggerFactory) {
        this.logger = loggerFactory.create(PdfService.name);
      } else {
        // Fallback to basic NestJS Logger
        this.logger = new Logger(PdfService.name) as any;
      }
    }

    async generatePdf(jobRunId: string, reportType: ReportType): Promise<Buffer> {
      const projectId = await this.projectIdCacheService.getProjectIdFromCache(jobRunId);
      this.logger.log(`projectId: ${projectId} Checking for existing report for jobRunId: ${jobRunId} and reportType: ${reportType}`);
      
      try {
        const sanitizedFileName = `${jobRunId.toString().replace(/[^a-zA-Z0-9-]/g, '')}-${reportType.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '')}-report.pdf`;
        const filePath = path.join(this.reportsDirectory, sanitizedFileName);
        
        if (!filePath.startsWith(path.resolve(this.reportsDirectory))) {
          this.logger.error(`projectId: ${projectId} Invalid file path: ${filePath}`);
          throw new HttpException("Invalid file path", HttpStatus.BAD_REQUEST);
        }
        
        if (reportType === ReportType.JOBS_RREPORT) {
          this.logger.log(`projectId: ${projectId} Generating jobs report PDF for jobRunId: ${jobRunId}`);
          let response = await this.generateJobsReportPdf(jobRunId);
          return response;
        }
        
        const fileExists = await fs.promises.access(filePath).then(() => true).catch(() => false);
        if (fileExists && reportType == ReportType.DISCOVERY) { 
            this.logger.log(`projectId: ${projectId} Report found. Returning existing report: ${filePath}`);
            return fs.promises.readFile(filePath); 
        } else {
          this.logger.warn(`projectId: ${projectId} Report not found for jobRunId: ${jobRunId}, reportType: ${reportType}`);
          throw new HttpException("Report not found, try again later",  HttpStatus.INTERNAL_SERVER_ERROR);
        }
      } catch (error) {
        this.logger.error(`projectId: ${projectId} Error in generatePdf for jobRunId: ${jobRunId}, reportType: ${reportType}: ${error.message}`, error?.stack || error);
        throw error;
      }
    }

    async generateJobsReportPdf(jobRunId: string): Promise<Buffer> {
      const projectId = await this.projectIdCacheService.getProjectIdFromCache(jobRunId);
      this.logger.log(`projectId: ${projectId} Starting generateJobsReportPdf for jobRunId: ${jobRunId}`);
      
      try {
        const schema = process.env.SCHEMA || 'datamigrator';

        const projectData = await this.inventoryRepo.query(
          `
            select p.* from ${schema}.jobrun j 
            left join ${schema}.jobconfig j2 on j2.id = j.job_config_id
            left join ${schema}.volume v on v.id = j2.source_path_id
            left join ${schema}.file_server fs on fs.id = v.file_server_id
            left join ${schema}.config c on c.id = fs.config_id 
            left join ${schema}.project p on p.id = c.project_id
            where j.id = $1
          `,
        [jobRunId]);

        const data = await this.reportsRepo.query(
          `SELECT * FROM ${schema}.reports WHERE job_run_id = $1 and report_type = $2
          order by created_at DESC
          limit 1;
          `,
          [jobRunId, 'JOBS_REPORT']
        );

        if(!data.length) {
          // if report data is not found, should call report generation again and return error
          this.logger.error(`projectId: ${projectId} Report data not found for jobRunId: ${jobRunId} and reportType: JOBS_REPORT`);
          this.logger.log(`projectId: ${projectId} Calling discoveryService.createJobsPDFReportData for jobRunId: ${jobRunId}`);
          this.discoveryService.createJobsPDFReportData(jobRunId);
          this.logger.log(`projectId: ${projectId} Called discoveryService.createJobsPDFReportData for jobRunId: ${jobRunId}, try again later`);
          throw new HttpException("Report data not found", HttpStatus.INTERNAL_SERVER_ERROR);
        }

        this.logger.log(`projectId: ${projectId} Found report data, processing for jobRunId: ${jobRunId}`);
        const reportData = JSON.parse(data[0].report_data);
         reportData.last_iteration = reportData.last_iteration || {};
        reportData.last_errors = reportData.last_errors || {};
        if (!Array.isArray(reportData.summary) || reportData.summary.length === 0) { throw new Error("Invalid or missing summary data in reportData") }
        reportData.last_iteration.summary = reportData.summary[0];
        reportData.last_errors.summary = reportData.summary[0];
        reportData.cutovers = reportData.summary.filter((item) => item.source.job_type === 'CUT_OVER') ?? [];
        // add customerInfo and report generation date
        reportData.customerInfo = {
          projectName: projectData.length > 0 ? projectData[0].project_name : 'NetApp Data Migrator',
          reportDate: new Date().toISOString().slice(0, 10),
        }
        
        this.logger.log(`projectId: ${projectId} Generating PDF for jobs report, jobRunId: ${jobRunId}`);
        return await this.pdfGeneratorService.generatePDF({
          data: reportData, 
          template: PDFTemplate.JOBS_REPORT, 
          pdfOptions: {
            format: 'A0', printBackground: true, scale: 0.5, landscape: true, 
          },
          context: {
            jobRunId,
            projectId
          }
        });
      } catch (error) {
        this.logger.error(`projectId: ${projectId} Failed to generate jobs report for jobRunId: ${jobRunId}, error: ${error.message}`, error?.stack || error);
        throw new HttpException("Failed to generate jobs report", HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }
}
