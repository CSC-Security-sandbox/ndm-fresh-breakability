import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from "fs";
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

@Injectable()
export class DiscoveryReportService {

    private readonly logger = new Logger(DiscoveryReportService.name);
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
    ) {
        this.basePath = this.configService.get<string>('app.baseDir') ;
        this.schemaName = this.configService.get<string>('typeorm.scheama') || 'datamigrator';
    }

    async getSection({ jobRunId, section }: GetDiscoverySectionInput): Promise<DiscoveryReportSection[]> {
        const output = await this.dataSource.query(QueryMapper[section].query(this.schemaName), [jobRunId]);
        return QueryMapper[section].mapper(output);
    }

    async generatePdfReport({data, jobRunId}: GenerateDiscoveryReportInput) {
        const categories = groupAndOrder(data, ReportType.DISCOVERY);
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
          }
        });
        const pdfFilePath = `${this.basePath}/${jobRunId}-discover-report.pdf`;
        await fs.promises.writeFile(pdfFilePath, pdfBuffer);
        this.logger.log(`PDF report generated at: ${pdfFilePath}`);
        return { message: 'PDF report generated successfully', path: pdfFilePath };
    }

    async generateCsvReport({data, jobRunId}: GenerateDiscoveryReportInput) {
        const reportData = Object.values(groupAndOrder(data, ReportType.DISCOVERY)).flat()
        
        // Dynamically determine headers based on sub_category
        const dynamicHeaders = new Set<string>();  
        reportData?.forEach(entry => {
            if (entry.sub_category && entry.value !== null)
                dynamicHeaders.add(entry.sub_category);
        });
        const headers = Array.from(dynamicHeaders);
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

        // Write CSV to file
        const csvFilePath = `${this.basePath}/${jobRunId}-discover-report.csv`;
        await fs.promises.writeFile(csvFilePath, csvContent);

        this.logger.log(`CSV report generated at: ${csvFilePath}`);
        return { message: 'CSV report generated successfully', path: csvFilePath };
    }

    async updateJsonReport(input: UpdateDiscoveryReportInput) {
        let report = await this.reportsRepo.findOne({ where: { jobRunId: input.jobRunId, reportType: ReportType.DISCOVERY } });
        if (!report) {
            report = this.reportsRepo.create({
                jobRunId: input.jobRunId,
                reportType: ReportType.DISCOVERY,
                reportData: JSON.stringify(input.data),
            });
        }
        const updatedReport = await this.reportsRepo.save(report);
        await this.jobRunRepo.update({ id: input.jobRunId }, { isReportReady: true });
        this.logger.log(`Discovery report updated for jobRunId: ${input.jobRunId}`);
        return updatedReport;
    }
}