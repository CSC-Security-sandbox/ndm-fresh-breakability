import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as path from "path";
import * as puppeteer from 'puppeteer';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { ReportsEntity } from 'src/entities/reports.entity';
import { Repository } from 'typeorm';

@Injectable()
export class PdfService {
    private logger: Logger = new Logger(PdfService.name);
    private readonly reportsDirectory =
    process.env.REPORT_DOWNLOAD_LOCATION || "./reports";
    constructor( @InjectRepository(InventoryEntity)
    private readonly inventoryRepo: Repository<InventoryEntity>,
    @InjectRepository(ReportsEntity)
    private readonly reportsRepo: Repository<ReportsEntity>) {}

    async generatePdf(jobRunId:string,reportType:string): Promise<Buffer> {
      this.logger.log( `Creating report for jobRunId: ${jobRunId} and reportType: ${reportType}`);

      await this.inventoryRepo.query(
        "CALL generate_discovery_report($1)",
        [jobRunId]
      );

      const latestReport = await this.reportsRepo.find({
        where: { jobRunId: jobRunId, reportType: reportType },
        order: { createdAt: "DESC" },
        take: 1,
      });

      const fileName = `${jobRunId}-${reportType.toLowerCase()}-report.pdf`;
      const filePath = path.join(this.reportsDirectory, fileName);
      let htmlOutput = "";

      if (latestReport?.length > 0) 
        htmlOutput =   this.generateHtmlTable(JSON.parse(latestReport[0].reportData));

        const browser = await puppeteer.launch({
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });;
      const page = await browser.newPage();
      await page.setContent(htmlOutput, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
      });

      await browser.close();
      return Buffer.from(pdfBuffer);
    }

    generateHtmlTable(data: any[]): string {
        const categories: { [key: string]: any[] } = {};
        data.forEach((entry) => {
          const category = entry.category;
          if (!categories[category]) {
            categories[category] = [];
          }
          categories[category].push(entry);
        });
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
                <th>Count or Space</th>
              </tr>
          `;
      
          categories[category].forEach((entry) => {
            const subCategory = entry.sub_category;
            const value =  entry.value;
            htmlString += `
              <tr>
                <td>${subCategory}</td>
                <td>${value}</td>
              </tr>
            `;
          });
      
          htmlString += `</table>`;
        }
      
        htmlString += `
          </body>
          </html>
        `;
      
        return htmlString;
      }
}
