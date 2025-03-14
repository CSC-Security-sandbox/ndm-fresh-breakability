import { last } from 'rxjs';
import * as fs from 'fs';
import * as path from "path";
import { Repository } from 'typeorm';
import * as puppeteer from 'puppeteer';
import * as hbs from 'hbs';
import { InjectRepository } from '@nestjs/typeorm';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { ReportsEntity } from 'src/entities/reports.entity';
import { ReportType } from 'src/constants/enums';
import { error } from 'console';

@Injectable()
export class PdfService {
    private logger: Logger = new Logger(PdfService.name);
    private readonly reportsDirectory =
    process.env.REPORT_DOWNLOAD_LOCATION || "./reports";
    constructor( @InjectRepository(InventoryEntity)
    private readonly inventoryRepo: Repository<InventoryEntity>,
    @InjectRepository(ReportsEntity)
    private readonly reportsRepo: Repository<ReportsEntity>) {}

    async generatePdf(jobRunId: string, reportType: ReportType): Promise<Buffer> {
      this.logger.log(`Checking for existing report for jobRunId: ${jobRunId} and reportType: ${reportType}`);
  
      const fileName = `${jobRunId}-${reportType.toLowerCase()}-report.pdf`;
      const filePath = path.join(this.reportsDirectory, fileName);
      
      if (reportType === ReportType.JOBS_RREPORT) return await this.generateJobsReportPdf(jobRunId);
      if (fs.existsSync(filePath) && reportType == ReportType.DISCOVERY) {
          this.logger.log(`Report found. Returning existing report: ${filePath}`);
          return fs.readFileSync(filePath);
      } else {
        throw new HttpException("Report not found, try again later",  HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }

    async generateJobsReportPdf(jobRunId: string): Promise<Buffer> {
      try {
        const reportPath = path.join(__dirname, '../../templates/views/jobs_report.hbs');
        const reportContent = fs.readFileSync(reportPath, 'utf8');
        const report = hbs.compile(reportContent);
        const data = await this.reportsRepo.query(
          `SELECT * FROM ${process.env.SCHEMA}.reports WHERE job_run_id = $1 and report_type = $2
          order by created_at DESC
          limit 1;
          `,
          [jobRunId, 'JOBS_REPORT']
        )
        const reportData = JSON.parse(data[0].report_data);
        reportData.last_iteration = reportData.last_iteration || {};
        reportData.last_errors = reportData.last_errors || {};
        if (!Array.isArray(reportData.summary) || reportData.summary.length === 0) { throw new Error("Invalid or missing summary data in reportData") }
        reportData.last_iteration.summary = reportData.summary[0];
        reportData.last_errors.summary = reportData.summary[0];
        const html = report(reportData);
        let browser;
        try {
          browser = await puppeteer.launch({
            headless: true,
            args: [
              "--no-sandbox",
              "--disable-setuid-sandbox",
              "--disable-gpu",
              "--disable-dev-shm-usage",
              "--disable-accelerated-2d-canvas"
            ],
            executablePath: "/usr/bin/chromium-browser",
            protocolTimeout: 60000,
          });
          const page = await browser.newPage();
          await page.setContent(html, { waitUntil: 'networkidle0' });
          const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, scale: 0.6, landscape: true });
          return Buffer.from(pdfBuffer);
        }finally {
          if (browser) await browser.close();
        }
      } catch (error) {
        this.logger.error(`Failed to generate jobs report for jobRunId: ${jobRunId}, error: ${error}`);
        throw new HttpException("Failed to generate jobs report", HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }
}
