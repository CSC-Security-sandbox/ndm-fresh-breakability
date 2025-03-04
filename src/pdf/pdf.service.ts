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
      
      if (reportType === ReportType.JOBS_RREPORT) {
        const pdfBuffer = await this.generateJobsReportPdf(jobRunId);
        fs.writeFileSync(filePath, pdfBuffer);
        return pdfBuffer;
      }
      
      if (fs.existsSync(filePath) && reportType==ReportType.DISCOVERY) {
          this.logger.log(`Report found. Returning existing report: ${filePath}`);
          return fs.readFileSync(filePath);
      } else {
        throw new HttpException("Report not found, try again later",  HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }

    async generateJobsReportPdf(jobRunId: string): Promise<Buffer> {
      const reportPath = path.join(__dirname, '../../templates/views/jobs_report.hbs');
      const reportContent = fs.readFileSync(reportPath, 'utf8');
      const report = hbs.compile(reportContent);
      const latestReportData = await this.reportsRepo.query(
        `SELECT * FROM jobs_report WHERE job_run_id = $1 and job_type = $2
        order by created_at DESC
        limit 1;
        `,
        [jobRunId, 'JOBS_REPORT']
      )
      const html = report(latestReportData[0].report_data);
      const browser = await puppeteer.launch();
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({ 
        format: 'A4', 
        printBackground: true,
        scale: 0.6,
        landscape: true
      });
      await browser.close();
      return Buffer.from(pdfBuffer);
    }
}
