import { Injectable, Logger } from '@nestjs/common';
import { DiscoveryReportSection, GenerateDiscoveryReportJsonInput } from './discovery-report.type';
import { DataSource } from 'typeorm';
import { QueryMapper } from './discovery-report.query-mapper';

@Injectable()
export class DiscoveryReportService {
    private readonly logger = new Logger(DiscoveryReportService.name);
    constructor(private dataSource: DataSource) {}

    async generateJsonReport({ jobRunId, section }: GenerateDiscoveryReportJsonInput) {
        this.logger.log('Generating JSON report...');
        // Logic to generate JSON report
        // This is a placeholder for the actual implementation
        const output = await this.dataSource.query(QueryMapper[section].query, [jobRunId]);
        if (QueryMapper[section]?.mapper) {
            return QueryMapper[section].mapper(output);
        }
        return output
    }

    async generatePdfReport() {
        this.logger.log('Generating PDF report...');
        // Logic to generate PDF report
        // This is a placeholder for the actual implementation
        return { message: 'PDF report generated successfully' };
    }

    async generateCsvReport() {
        this.logger.log('Generating CSV report...');
        // Logic to generate CSV report
        // This is a placeholder for the actual implementation
        return { message: 'CSV report generated successfully' };
    }
}