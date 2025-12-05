import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { DiscoveryReportService } from './discovery-report/discovery-report.service';
import { GenerateDiscoveryReportInput, GetDiscoverySectionInput, UpdateDiscoveryReportInput } from './discovery-report/discovery-report.type';
import { ProjectIdCacheService } from '../utils/project-id-cache.service';
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class ActivitiesService {
    private readonly logger: LoggerService | Logger;

    constructor(
        private readonly discoveryReportService: DiscoveryReportService,
        private readonly projectIdCacheService: ProjectIdCacheService,
        @Optional() @Inject(LoggerFactory) private readonly loggerFactory?: LoggerFactory,
    ) {
        if (this.loggerFactory) {
            this.logger = this.loggerFactory.create(ActivitiesService.name);
        } else {
            // Fallback to basic NestJS Logger for worker threads
            this.logger = new Logger(ActivitiesService.name);
        }
    }

    /* ----------- Discovery Report Generation Start -------------*/
    async generateDiscoveryJsonReport(input: GetDiscoverySectionInput) {
        const projectId = await this.projectIdCacheService.getProjectIdFromCache(input.jobRunId);
        this.logger.log(`projectId: ${projectId} Starting generateDiscoveryJsonReport for jobRunId: ${input.jobRunId}, section: ${input.section}`);
        
        try {
            const result = await this.discoveryReportService.getSection(input);
            this.logger.log(`projectId: ${projectId} Completed generateDiscoveryJsonReport for jobRunId: ${input.jobRunId}, section: ${input.section}`);
            return result;
        } catch (error) {
            this.logger.error(`projectId: ${projectId} Error in generateDiscoveryJsonReport for jobRunId: ${input.jobRunId}, section: ${input.section}: ${error.message}`, error?.stack || error);
            throw error;
        }
    }

    async generateDiscoveryPdfReport(input: GenerateDiscoveryReportInput) {
        const projectId = await this.projectIdCacheService.getProjectIdFromCache(input.jobRunId);
        this.logger.log(`projectId: ${projectId} Starting generateDiscoveryPdfReport for jobRunId: ${input.jobRunId}`);
        
        try {
            const result = await this.discoveryReportService.generatePdfReport(input);
            this.logger.log(`projectId: ${projectId} Completed generateDiscoveryPdfReport for jobRunId: ${input.jobRunId}`);
            return result;
        } catch (error) {
            this.logger.error(`projectId: ${projectId} Error in generateDiscoveryPdfReport for jobRunId: ${input.jobRunId}: ${error.message}`, error?.stack || error);
            throw error;
        }
    }

    async generateDiscoveryCsvReport(input: GenerateDiscoveryReportInput) {
        const projectId = await this.projectIdCacheService.getProjectIdFromCache(input.jobRunId);
        this.logger.log(`projectId: ${projectId} Starting generateDiscoveryCsvReport for jobRunId: ${input.jobRunId}`);
        
        try {
            const result = await this.discoveryReportService.generateCsvReport(input);
            this.logger.log(`projectId: ${projectId} Completed generateDiscoveryCsvReport for jobRunId: ${input.jobRunId}`);
            return result;
        } catch (error) {
            this.logger.error(`projectId: ${projectId} Error in generateDiscoveryCsvReport for jobRunId: ${input.jobRunId}: ${error.message}`, error?.stack || error);
            throw error;
        }
    }

    async updateDiscoveryReport(input: UpdateDiscoveryReportInput) {
        const projectId = await this.projectIdCacheService.getProjectIdFromCache(input.jobRunId);
        this.logger.log(`projectId: ${projectId} Starting updateDiscoveryReport for jobRunId: ${input.jobRunId}, updateType: ${input.updateType}`);
        
        try {
            const result = await this.discoveryReportService.updateJsonReport(input);
            this.logger.log(`projectId: ${projectId} Completed updateDiscoveryReport for jobRunId: ${input.jobRunId}, updateType: ${input.updateType}`);
            return result;
        } catch (error) {
            this.logger.error(`projectId: ${projectId} Error in updateDiscoveryReport for jobRunId: ${input.jobRunId}, updateType: ${input.updateType}: ${error.message}`, error?.stack || error);
            throw error;
        }
    }
    /* ----------- Discovery Report Generation End  -------------*/
}