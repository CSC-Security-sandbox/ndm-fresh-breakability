import * as fs from 'fs';
import * as path from "path";
import { Repository } from 'typeorm';
import * as puppeteer from 'puppeteer';
import * as hbs from 'hbs';
import { InjectRepository } from '@nestjs/typeorm';
import { Injectable, Logger } from '@nestjs/common';
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

    async generatePdf(jobRunId:string, reportType:ReportType): Promise<Buffer> {
      this.logger.log( `Creating report for jobRunId: ${jobRunId} and reportType: ${reportType}`);

      if(reportType === ReportType.JOBS_RREPORT) return await this.generateJobsReportPdf(jobRunId);

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

    async generateJobsReportPdf(jobRunId: string): Promise<Buffer> {
      const reportPath = path.join(__dirname, '../../templates/views/jobs_report.hbs');
      const reportContent = fs.readFileSync(reportPath, 'utf8');
      const report = hbs.compile(reportContent);
      // const latestReportData = await this.reportsRepo.query(
      //   `SELECT * FROM jobs_report WHERE job_run_id = $1 and job_type = $2
      //   order by created_at DESC
      //   limit 1;
      //   `,
      //   [jobRunId, 'JOBS_REPORT']
      // )
      const html = report({
        "coc": [{
          path: "/var/lib/data/47a8475a-51ce-4d57-9932-872873d3ae48-coc.csv",
          size: "20 KB",
          digest: "SHA-1 c411e73dea8c130632bfc34647733635097b2f61"
        },
        {
          path: "/var/lib/data/85ec8aa1-13c9-429e-94a8-cb57554f5ac6-coc.csv",
          size: "20 KB",
          digest: "SHA-1 c411e73dea8c130632b872873d3ae4850979932"
        },
        {
          path: "/var/lib/data/9f0bd560-a8d3-40ff-95eb-e7f84600e746-coc.csv",
          size: "20 KB",
          digest: "SHA-1 c411e73dea89f0bd560872873d3ae4844600e76"
        }
      ],
        "summary": {
            "source": {
                "path": "/home/datamigrate/nfs/1000_files",
                "items": 1001,
                "path_id": "a6735940-b10c-4c2f-8e4c-185b9572fa8e",
                "job_type": "MIGRATE",
                "protocol": "NFS",
                "file_server": "source_migrate",
                "protocol_version": "v4.0",
                "capacity": "137 MB"
              },
              "target": {
                "path": "/home/datamigrate/nfs/refresh_Validation",
                "path_id": "fb215f7b-2d85-415d-8714-78ca8b06dce5",
                "capacity": "137 MB",
                "protocol": "NFS",
                "file_server": "source_migrate",
                "protocol_version": "v4.0"
            },
            "last_run": {
                "id": "47a8475a-51ce-4d57-9932-872873d3ae48",
                "state": "COMPLETED",
                "duration": "25 sec",
                "failures": "-",
                "start_time": "2025-02-24T12:04:40.084471"
            }
        },
        "cutover": {
          start_time: "2025-02-24T12:04:40.084471",
          duration: "2 min",
          capacity: "137 MB",
          items: 1001,
          directories: 10,
          operations: 10,
          errors: 0,
          others: 0
        },
        "last_errors": {
          permission_denied: 0,
          out_of_space: 0,
          not_found: 0,
          in_use: 0,
          timed_out: 0,
          network_issue: 0,
          modified_externally: 0,
          others: 1
        },
        "last_iteration": {
            "s_files": 1001,
            "s_capacity": "137 MB",
            "s_errors": 0,
            "job_run_id": "47a8475a-51ce-4d57-9932-872873d3ae48",
            "s_duration": '25 sec',
            "start_time": "2025-02-24T12:04:40.076",
            "s_operations": 10,
            "job_config_id": "812a3e1c-2ebe-4c1a-9bec-338b000daebd",
            "s_directories": 0,
            delta_items: 2,
            delta_operations: 2,
            capacity_copied: "5 KB",
            capacity_deleted: "-",
            source_scan_spped: "-",
            target_scan_speed:"-",
            bandwidth: "-",
            throughput: "-",
        },
        "scan_iterations": [
            {
              "s_duration": '25 sec',
              "s_files": 2,
              "s_directories": 0,
              s_others: 0,
              s_capacity:  "5 KB",
              s_errors: 0,
              t_duration: '25 sec',
              t_files: 2,
              t_directories: 0,
              t_others: 0,
              t_capacity: "5 KB",
              t_errors: 0,
                "status": "COMPLETED",
                "job_type": "MIGRATE",
                "job_run_id": "47a8475a-51ce-4d57-9932-872873d3ae48",
                "start_time": "2025-02-24T12:04:40.076",
                "s_operations": 10,
                "job_config_id": "812a3e1c-2ebe-4c1a-9bec-338b000daebd",
            },
            {
              "s_files": '60',
              "s_capacity": "26 KB",
              s_directories: 0,
              s_others: 0,
              s_errors: 0,
              t_files: '60',
              t_capacity: "26 KB",
              t_directories: 0,
              t_others: 0,
              t_errors: 0,
              t_duration: '60 sec',
                "status": "COMPLETED",
                "job_type": "MIGRATE",
                "job_run_id": "85ec8aa1-13c9-429e-94a8-cb57554f5ac6",
                "s_duration": '60 sec',
                "start_time": "2025-02-24T10:55:45.42",
                "job_config_id": "812a3e1c-2ebe-4c1a-9bec-338b000daebd",
            },
            {
              "s_duration": '5 min',
              "s_files": 1001,
              "s_directories": 0,
              s_others: 0,
              s_capacity:  "137 MB",
              s_errors: 0,
              t_duration: '5 min',
              t_files: 1001,
              t_directories: 0,
              t_others: 0,
              t_capacity: "137 MB",
              t_errors: 0,
                "status": "COMPLETED",
                "job_type": "MIGRATE",
                "job_run_id": "9f0bd560-a8d3-40ff-95eb-e7f84600e746",
                "start_time": "2025-02-24T10:24:00.001",
                "job_config_id": "812a3e1c-2ebe-4c1a-9bec-338b000daebd",
            }
        ],
        "todo_operations": null,
        "current_iteration": [],
        "aggregated_operations": [
            {
                "status": "COMPLETED",
                "job_type": "MIGRATE",
                "job_run_id": "47a8475a-51ce-4d57-9932-872873d3ae48",
                "start_time": "2025-02-24T12:04:40.076",
                "job_config_id": "812a3e1c-2ebe-4c1a-9bec-338b000daebd",
                "completed_duration": 25.633000,
                "completed_operations": 10
            },
            {
                "status": "COMPLETED",
                "job_type": "MIGRATE",
                "job_run_id": "85ec8aa1-13c9-429e-94a8-cb57554f5ac6",
                "start_time": "2025-02-24T10:55:45.42",
                "job_config_id": "812a3e1c-2ebe-4c1a-9bec-338b000daebd",
                "completed_duration": 81.688000,
                "completed_operations": 1011
            },
            {
                "status": "COMPLETED",
                "job_type": "MIGRATE",
                "job_run_id": "9f0bd560-a8d3-40ff-95eb-e7f84600e746",
                "start_time": "2025-02-24T10:24:00.001",
                "job_config_id": "812a3e1c-2ebe-4c1a-9bec-338b000daebd",
                "completed_duration": 13.692000,
                "completed_operations": 1
            }
        ]
    });
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
