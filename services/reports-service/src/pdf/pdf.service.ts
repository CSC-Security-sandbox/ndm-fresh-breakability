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
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class PdfService {
    private readonly logger : LoggerService;
    private readonly reportsDirectory =
    process.env.REPORT_DOWNLOAD_LOCATION || "./reports";
    constructor( 
      @InjectRepository(InventoryEntity)
      private readonly inventoryRepo: Repository<InventoryEntity>,
      @InjectRepository(ReportsEntity)
      private readonly reportsRepo: Repository<ReportsEntity>,
      private readonly discoveryService: DiscoveryService,
      private readonly pdfGeneratorService: PDFGeneratorService,
      @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory
    ) {
      if (loggerFactory) {
        this.logger = loggerFactory.create(PdfService.name);
      } else {
        // Fallback to basic NestJS Logger for worker threads
        this.logger = new Logger(PdfService.name) as any;
      }
    }

    async generatePdf(jobRunId: string, reportType: ReportType): Promise<Buffer> {
      this.logger.log(`Checking for existing report for jobRunId: ${jobRunId} and reportType: ${reportType}`);
      const sanitizedFileName = `${jobRunId.toString().replace(/[^a-zA-Z0-9-]/g, '')}-${reportType.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '')}-report.pdf`;
      const filePath = path.join(this.reportsDirectory, sanitizedFileName);
      
      if (!filePath.startsWith(path.resolve(this.reportsDirectory))) {
        this.logger.error(`Invalid file path: ${filePath}`);
        throw new HttpException("Invalid file path", HttpStatus.BAD_REQUEST);
      }
      
      if (reportType === ReportType.JOBS_RREPORT)
        {
          let response = await this.generateJobsReportPdf(jobRunId);
          return response;
        }
      
      if (fs.existsSync(filePath) && reportType == ReportType.DISCOVERY) { 
          this.logger.log(`Report found. Returning existing report: ${filePath}`);
          return fs.readFileSync(filePath); 
      } else {
        throw new HttpException("Report not found, try again later",  HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }

    async generateJobsReportPdf(jobRunId: string): Promise<Buffer> {
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
          this.logger.error(`Report data not found for jobRunId: ${jobRunId} and reportType: JOBS_REPORT`);
          this.logger.log(`Calling discoveryService.createJobsPDFReportData for jobRunId: ${jobRunId}`);
          this.discoveryService.createJobsPDFReportData(jobRunId);
          this.logger.log(`Called discoveryService.createJobsPDFReportData for jobRunId: ${jobRunId}, try again later`);
          throw new HttpException("Report data not found", HttpStatus.INTERNAL_SERVER_ERROR);
        }

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
          reportDate: new Date().toLocaleDateString(),
        }
        return await this.pdfGeneratorService.generatePDF({data: reportData, template: PDFTemplate.JOBS_REPORT, pdfOptions: {
          format: 'A0', printBackground: true, scale: 0.5, landscape: true,
        }});
      } catch (error) {
        this.logger.error(`Failed to generate jobs report for jobRunId: ${jobRunId}, error: ${error}`);
        if (error instanceof HttpException) {
          throw error; // Re-throw HttpExceptions to maintain the original status code
        }
        throw new HttpException("Failed to generate jobs report", HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }
}
