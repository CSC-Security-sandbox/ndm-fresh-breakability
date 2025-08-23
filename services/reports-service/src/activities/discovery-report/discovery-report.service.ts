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
        this.schemaName = this.configService.get<string>('typeorm.schema') || 'datamigrator';
    }

    async getSection({ jobRunId, section, updateSection }: GetDiscoverySectionInput): Promise<DiscoveryReportSection[]> {
        const output = await this.dataSource.query(QueryMapper[section].query(this.schemaName), [jobRunId]);
        const sectionData = QueryMapper[section].mapper(output);
        if (!updateSection) 
            return sectionData;
        await this.updateJsonReport({ jobRunId, data: sectionData, updateType: 'data' });
        return [];
    }

    async generatePdfReport({jobRunId}: GenerateDiscoveryReportInput) {
        const report = await this.reportsRepo.findOne({ where: { jobRunId, reportType: ReportType.DISCOVERY } });
        const categories = groupAndOrder(JSON.parse(report.reportData), ReportType.DISCOVERY);
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

    async generateCsvReport({jobRunId}: GenerateDiscoveryReportInput) {
        const report = await this.reportsRepo.findOne({ where: { jobRunId, reportType: ReportType.DISCOVERY } });
        const reportData = Object.values(groupAndOrder(JSON.parse(report.reportData), ReportType.DISCOVERY)).flat();

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

    async updateJsonReport({jobRunId, updateType, data}: UpdateDiscoveryReportInput) {
        if(updateType === 'status') {
            const update = await this.jobRunRepo.update({ id: jobRunId }, { isReportReady: true });
            this.logger.log(`Discovery report updated for jobRunId: ${jobRunId}`);
            return "Updated The report status Successfully";
        }

        let report = await this.reportsRepo.findOne({ where: { jobRunId, reportType: ReportType.DISCOVERY } });
        if (!report) {
            report = this.reportsRepo.create({
                jobRunId,
            reportType: ReportType.DISCOVERY,
            });
        }

        const currentData = report.reportData ? JSON.parse(report.reportData) : [];
        const updatedData = [...currentData, ...data];
        report.reportData = JSON.stringify(updatedData);
        await this.reportsRepo.save(report);
        return "Updated The report Data Successfully";
    }
}