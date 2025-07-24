import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobRunStatus, JobStatus, JobType } from '../constants/enums';
import { PreCheckCircularDependency } from '../jobconfig/jobconfig.types';
import { CircularDependencyCheckConfig, CircularDependencyCheckData } from './types';

@Injectable()
export class CircularDependencyService {
    private readonly logger = new Logger(CircularDependencyService.name);

    constructor(
        @InjectRepository(JobConfigEntity)
        private readonly jobConfigEntity: Repository<JobConfigEntity>,
        @InjectRepository(JobRunEntity)
        private readonly jobRunRepo: Repository<JobRunEntity>,
    ) { }

    /**
     * Checks for circular dependencies in job configurations
     * @param data - Data containing migrate configurations to check
     * @returns Array of circular dependencies found
     */
    async checkCircularDependency(data: CircularDependencyCheckData): Promise<PreCheckCircularDependency[]> {
        try {
            const circularDependencies: PreCheckCircularDependency[] = [];
            this.logger.log(`Checking circular dependencies for data: ${JSON.stringify(data)}`);
            if (data.migrateConfigs.length === 0) {
                return circularDependencies;
            }

            for (const config of data.migrateConfigs) {
                const dependencies = await this.findCircularDependencyForConfig(config);
                circularDependencies.push(...dependencies);
            }

            this.logger.log(`Circular dependency check completed. Found ${circularDependencies.length} dependencies`);
            return circularDependencies;
        } catch (error) {
            this.logger.error(`Failed to check circular dependencies: ${error}`);
            throw new Error(`Failed to check circular dependencies: ${error}`);
        }
    }

    /**
     * Verifies circular task dependencies (alias for checkCircularDependency for backward compatibility)
     * @param data - Data containing migrate configurations to check
     * @returns Array of circular dependencies found
     */
    async verifyCircularTaskDependency(data: CircularDependencyCheckData): Promise<PreCheckCircularDependency[]> {
        return this.checkCircularDependency(data);
    }

    /**
     * Finds circular dependencies for a single configuration
     * @param config - Configuration to check
     * @returns Array of circular dependencies found for this config
     */
    private async findCircularDependencyForConfig(config: CircularDependencyCheckConfig): Promise<PreCheckCircularDependency[]> {
        const dependencies: PreCheckCircularDependency[] = [];

        // Check if any destination path is used as source in an active job
        // and the source path is used as target in that same job
        const conflictingJobs = await this.jobConfigEntity.find({
            where: {
                jobType: In([JobType.MIGRATE, JobType.CUT_OVER]),
                status: JobStatus.Active,
                sourcePathId: In(config.destinationPathId),
                targetPathId: config.sourcePathId,
            },
            relations: [
                'jobRuns',
                'targetPath',
                'sourcePath',
                'sourcePath.fileServer.config',
                'targetPath.fileServer.config'
            ]
        });

        for (const job of conflictingJobs) {
            const activeDependencies = await this.getActiveJobRunDependencies(job);
            if (activeDependencies.length > 0) {
                dependencies.push({
                    status: job.status.toString(),
                    jobId: job.id,
                    jobRunIds: activeDependencies,
                    sourcePathId: job.targetPath.volumePath,
                    targetPathId: job.sourcePath.volumePath,
                    sourceServerId: job.sourcePath.fileServer.config.configName,
                    targetServerId: job.targetPath.fileServer.config.configName,
                });
            }
        }

        return dependencies;
    }

    /**
     * Gets active job run IDs for a job configuration
     * @param job - Job configuration to check
     * @returns Array of active job run IDs
     */
    private async getActiveJobRunDependencies(job: JobConfigEntity): Promise<string[]> {
        const jobRunIds = job.jobRuns.map((run) => run.id);

        if (jobRunIds.length === 0) {
            return [];
        }

        const activeJobRuns = await this.jobRunRepo.find({
            where: {
                id: In(jobRunIds),
                status: In([
                    JobRunStatus.Ready,
                    JobRunStatus.Stopping,
                    JobRunStatus.Running,
                    JobRunStatus.Pending,
                    JobRunStatus.Pausing,
                    JobRunStatus.Paused
                ])
            },
        });

        return activeJobRuns.map(run => run.id);
    }

    /**
     * Checks if there are any circular dependencies in the provided configurations
     * @param data - Data containing migrate configurations to check
     * @returns Boolean indicating if circular dependencies exist
     */
    async hasCircularDependencies(data: CircularDependencyCheckData): Promise<boolean> {
        const dependencies = await this.checkCircularDependency(data);
        return dependencies.length > 0;
    }

    /**
     * Gets circular dependency details for a specific source and destination path
     * @param sourcePathId - Source path ID
     * @param destinationPathIds - Array of destination path IDs
     * @returns Array of circular dependencies found
     */
    async getCircularDependencyDetails(sourcePathId: string, destinationPathIds: string[]): Promise<PreCheckCircularDependency[]> {
        const data: CircularDependencyCheckData = {
            migrateConfigs: [{
                sourcePathId,
                destinationPathId: destinationPathIds
            }]
        };
        return this.checkCircularDependency(data);
    }
}
