import { Injectable } from '@nestjs/common';
import { DiscoveryReportService } from './discovery-report/discovery-report.service';
import { GenerateDiscoveryReportInput, GetDiscoverySectionInput, UpdateDiscoveryReportInput } from './discovery-report/discovery-report.type';

@Injectable()
export class ActivitiesService {
    constructor(private readonly discoveryReportService: DiscoveryReportService) {}

    /* ----------- Discovery Report Generation Start -------------*/
    async generateDiscoveryJsonReport(input: GetDiscoverySectionInput) {
        return this.discoveryReportService.getSection(input);
    }

    async generateDiscoveryPdfReport(input: GenerateDiscoveryReportInput) {
        return this.discoveryReportService.generatePdfReport(input);
    }

    async generateDiscoveryCsvReport(input: GenerateDiscoveryReportInput) {
        return this.discoveryReportService.generateCsvReport(input);
    }

    async updateDiscoveryReport(input: UpdateDiscoveryReportInput) {
        return this.discoveryReportService.updateJsonReport(input);
    }
    /* ----------- Discovery Report Generation End  -------------*/
}