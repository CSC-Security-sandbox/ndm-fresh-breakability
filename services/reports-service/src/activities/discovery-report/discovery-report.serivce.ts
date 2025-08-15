import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { QueryMapper } from './discovery-report.query-mapper';
import { DiscoveryReportSection, GenerateDiscoveryReportJsonInput } from './discovery-report.type';
import * as path from "path";
import * as fs from "fs";
import * as hbs from "hbs";
import { groupAndOrder } from 'src/utils/group-order';
import { ReportType } from 'src/constants/enums';
import { PDFOptions } from 'puppeteer';
import { PDFGeneratorService } from 'src/generator/pdf-generator.service';

@Injectable()
export class DiscoveryReportService {
    private readonly logger = new Logger(DiscoveryReportService.name);
    private pdfTemplatePath: string;
    constructor(
        private dataSource: DataSource,
        private readonly pdfGenerator: PDFGeneratorService
    ) {
        this.pdfTemplatePath = path.join(__dirname,"../../../templates/views/discovery_pdf_report.hbs");
    }

    async generateJsonReport({ jobRunId, section }: GenerateDiscoveryReportJsonInput): Promise<DiscoveryReportSection[]> {
        const output = await this.dataSource.query(QueryMapper[section].query, [jobRunId]);
        return QueryMapper[section].mapper(output);
    }

    async generatePdfReport(section: DiscoveryReportSection[]) {
        const templateSource = fs.readFileSync(this.pdfTemplatePath, "utf8");
        const template = hbs.compile(templateSource);
        const categories = groupAndOrder(section, ReportType.DISCOVERY);
        const htmlOutput = template(categories);
        const options: PDFOptions = { format: "A4", printBackground: true };
        const pdfBuffer = await this.pdfGenerator.generatePDF(htmlOutput, options);
        const outputDir = process.env.REPORT_DOWNLOAD_LOCATION || "/tmp";
        const pdfFilePath = path.join(outputDir, `discovery_report_${Date.now()}.pdf`);
        await fs.promises.writeFile(pdfFilePath, pdfBuffer);
        return { message: 'PDF report generated successfully', path: pdfFilePath };
    }

    async generateCsvReport() {
        this.logger.log('Generating CSV report...');
        // Logic to generate CSV report
        // This is a placeholder for the actual implementation
        return { message: 'CSV report generated successfully' };
    }
}