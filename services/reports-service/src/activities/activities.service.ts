import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { DiscoveryReportService } from './discovery-report/discovery-report.service';
import { GenerateDiscoveryReportInput, GetDiscoverySectionInput, UpdateDiscoveryReportInput } from './discovery-report/discovery-report.type';
import { ProjectIdCacheService } from '../utils/project-id-cache.service';
import { 
    ConsolidatedReportService,
    GetDiscoveryJobsInput,
    GeneratePdfForJobRunInput,
    GenerateCsvForJobRunInput,
    MergePdfFilesInput,
    MergeCsvFilesInput,
    GetConsolidatedReportPathInput,
    CleanupTempFilesInput,
    UpdateConsolidatedReportStatusInput,
} from './consolidated-report/consolidated-report.service';
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
        private readonly consolidatedReportService: ConsolidatedReportService,
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
    /* ----------- Consolidated Report Activities -------------*/

    async getDiscoveryJobsForFileServer(input: GetDiscoveryJobsInput) {
        this.logger.log(`Starting getDiscoveryJobsForFileServer for fileServerId: ${input.fileServerId}`);
        
        try {
            const result = await this.consolidatedReportService.getDiscoveryJobsForFileServer(input);
            this.logger.log(`Completed getDiscoveryJobsForFileServer for fileServerId: ${input.fileServerId}, found ${result.length} jobs`);
            return result;
        } catch (error) {
            this.logger.error(`Error in getDiscoveryJobsForFileServer for fileServerId: ${input.fileServerId}: ${error.message}`, error?.stack || error);
            throw error;
        }
    }

    async generatePdfForJobRun(input: GeneratePdfForJobRunInput) {
        this.logger.log(`Starting generatePdfForJobRun for jobRunId: ${input.jobRunId}`);
        
        try {
            const result = await this.consolidatedReportService.generatePdfForJobRun(input);
            this.logger.log(`Completed generatePdfForJobRun for jobRunId: ${input.jobRunId}`);
            return result;
        } catch (error) {
            this.logger.error(`Error in generatePdfForJobRun for jobRunId: ${input.jobRunId}: ${error.message}`, error?.stack || error);
            throw error;
        }
    }

    async mergePdfFilesActivity(input: MergePdfFilesInput) {
        this.logger.log(`Starting mergePdfFilesActivity with ${input.pdfFilePaths.length} files`);
        
        try {
            const result = await this.consolidatedReportService.mergePdfFiles(input);
            this.logger.log(`Completed mergePdfFilesActivity`);
            return result;
        } catch (error) {
            this.logger.error(`Error in mergePdfFilesActivity: ${error.message}`, error?.stack || error);
            throw error;
        }
    }

    async generateCsvForJobRun(input: GenerateCsvForJobRunInput) {
        this.logger.log(`Starting generateCsvForJobRun for jobRunId: ${input.jobRunId}`);
        
        try {
            const result = await this.consolidatedReportService.generateCsvForJobRun(input);
            this.logger.log(`Completed generateCsvForJobRun for jobRunId: ${input.jobRunId}`);
            return result;
        } catch (error) {
            this.logger.error(`Error in generateCsvForJobRun for jobRunId: ${input.jobRunId}: ${error.message}`, error?.stack || error);
            throw error;
        }
    }

    async mergeCsvFilesActivity(input: MergeCsvFilesInput) {
        this.logger.log(`Starting mergeCsvFilesActivity with ${input.csvFilePaths.length} files`);
        
        try {
            const result = await this.consolidatedReportService.mergeCsvFiles(input);
            this.logger.log(`Completed mergeCsvFilesActivity`);
            return result;
        } catch (error) {
            this.logger.error(`Error in mergeCsvFilesActivity: ${error.message}`, error?.stack || error);
            throw error;
        }
    }

    async getConsolidatedReportPathActivity(input: GetConsolidatedReportPathInput) {
        this.logger.log(`Starting saveConsolidatedReport for fileServerId: ${input.fileServerId}`);
        
        try {
            const result = await this.consolidatedReportService.getConsolidatedReportPath(input);
            this.logger.log(`Completed getConsolidatedReportPath for fileServerId: ${input.fileServerId}`);
            return result;
        } catch (error) {
            this.logger.error(`Error in getConsolidatedReportPath for fileServerId: ${input.fileServerId}: ${error.message}`, error?.stack || error);
            throw error;
        }
    }

    async cleanupTempFilesActivity(input: CleanupTempFilesInput) {
        this.logger.log(`Starting cleanupTempFilesActivity for ${input.filePaths.length} files`);
        
        try {
            await this.consolidatedReportService.cleanupTempFiles(input);
            this.logger.log(`Completed cleanupTempFilesActivity`);
        } catch (error) {
            this.logger.error(`Error in cleanupTempFilesActivity: ${error.message}`, error?.stack || error);
            throw error;
        }
    }

    async updateConsolidatedReportStatus(input: UpdateConsolidatedReportStatusInput) {
        this.logger.log(`Starting updateConsolidatedReportStatus for fileServerId: ${input.fileServerId}, status: ${input.status}`);
        
        try {
            await this.consolidatedReportService.updateConsolidatedReportStatus(input);
            this.logger.log(`Completed updateConsolidatedReportStatus for fileServerId: ${input.fileServerId}`);
        } catch (error) {
            this.logger.error(`Error in updateConsolidatedReportStatus for fileServerId: ${input.fileServerId}: ${error.message}`, error?.stack || error);
            throw error;
        }
    }
}