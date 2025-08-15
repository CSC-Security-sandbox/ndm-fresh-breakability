import { Injectable } from '@nestjs/common';
import { DiscoveryReportService } from './discovery-report/discovery-report.serivce';
import { GenerateDiscoveryReportJsonInput } from './discovery-report/discovery-report.type';

@Injectable()
export class ActivitiesService {
    constructor(private readonly discoveryReportService: DiscoveryReportService) {}

    async generateDiscoveryJsonReport(input: GenerateDiscoveryReportJsonInput) {
        return this.discoveryReportService.generateJsonReport(input);
    }

    async generateDiscoveryPdfReport() {
        return this.discoveryReportService.generatePdfReport();
    }

    async generateDiscoveryCsvReport() {
        return this.discoveryReportService.generateCsvReport();
    }
}