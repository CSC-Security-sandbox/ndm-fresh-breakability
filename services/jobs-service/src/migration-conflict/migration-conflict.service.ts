import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobRunStatus, JobStatus, JobType } from '../constants/enums';
import { PreCheckCircularDependency } from '../jobconfig/jobconfig.types';
import { MigrationConflictCheckConfig, MigrationConflictCheckData } from './types';

@Injectable()
export class MigrationConflictService {
    private readonly logger = new Logger(MigrationConflictService.name);

    constructor(
        @InjectRepository(JobConfigEntity)
        private readonly jobConfigEntity: Repository<JobConfigEntity>,
        @InjectRepository(JobRunEntity)
        private readonly jobRunRepo: Repository<JobRunEntity>,
    ) { }

    /**
     * Checks for migration conflicts in job configurations
     * @param data - Data containing migrate configurations to check
     * @returns Array of migration conflicts found
     */
    async checkMigrationConflicts(data: MigrationConflictCheckData): Promise<PreCheckCircularDependency[]> {
        try {
            const migrationConflicts: PreCheckCircularDependency[] = [];
            this.logger.log(`Checking migration conflicts for data: ${JSON.stringify(data)}`);
            if (data.migrateConfigs.length === 0) {
                return migrationConflicts;
            }

            for (const config of data.migrateConfigs) {
                const conflicts = await this.findMigrationConflictForConfig(config);
                migrationConflicts.push(...conflicts);
            }

            this.logger.log(`Migration conflict check completed. Found ${migrationConflicts.length} conflicts`);
            return migrationConflicts;
        } catch (error) {
            this.logger.error(`Failed to check migration conflicts: ${error}`);
            throw new Error(`Failed to check migration conflicts: ${error}`);
        }
    }

    /**
     * Checks for circular dependencies in job configurations (legacy method for backward compatibility)
     * @param data - Data containing migrate configurations to check
     * @returns Array of circular dependencies found
     */
    async checkCircularDependency(data: MigrationConflictCheckData): Promise<PreCheckCircularDependency[]> {
        return this.checkMigrationConflicts(data);
    }

    /**
     * Verifies migration conflicts (alias for checkMigrationConflicts for backward compatibility)
     * @param data - Data containing migrate configurations to check
     * @returns Array of migration conflicts found
     */
    async verifyMigrationConflicts(data: MigrationConflictCheckData): Promise<PreCheckCircularDependency[]> {
        return this.checkMigrationConflicts(data);
    }

    /**
     * Verifies circular task dependency (legacy method for backward compatibility)
     * @param data - Data containing migrate configurations to check
     * @returns Array of circular dependencies found
     */
    async verifyCircularTaskDependency(data: MigrationConflictCheckData): Promise<PreCheckCircularDependency[]> {
        return this.checkMigrationConflicts(data);
    }

    /**
     * Finds migration conflicts for a single configuration
     * @param config - Configuration to check
     * @returns Array of migration conflicts found for this config
     */
    private async findMigrationConflictForConfig(config: MigrationConflictCheckConfig): Promise<PreCheckCircularDependency[]> {
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

        // Check if any destination path is already used in a config
        const destinationPathConflictingJobs = await this.jobConfigEntity.find({
            where: {
                jobType: In([JobType.MIGRATE, JobType.CUT_OVER]),
                targetPathId: In(config.destinationPathId),
            },
            relations: [
                'jobRuns',
                'targetPath',
                'sourcePath',
                'sourcePath.fileServer.config',
                'targetPath.fileServer.config'
            ]
        });

        // Circular dependency conflicts (always added regardless of active job runs)
        for (const job of conflictingJobs) {
            dependencies.push({
                status: job.status.toString(),
                jobId: job.id,
                sourcePathId: job.targetPath.volumePath,
                targetPathId: job.sourcePath.volumePath,
                sourceServerId: job.sourcePath.fileServer.config.configName,
                targetServerId: job.targetPath.fileServer.config.configName,
                conflictType: 'circular',
                jobType: job.jobType,
            });
        }

        // Process destination path conflicts (avoid duplicates from conflictingJobs)
        const conflictingJobIds = conflictingJobs.map(job => job.id);
        const uniqueDestinationPathConflicts = destinationPathConflictingJobs.filter(
            job => !conflictingJobIds.includes(job.id)
        );

        // Normal destination path conflicts
        for (const job of uniqueDestinationPathConflicts) {
            // Only block if it's a different source path with same destination (not same source+destination)
            if (job.sourcePathId !== config.sourcePathId) {
                dependencies.push({
                    status: job.status.toString(),
                    jobId: job.id,
                    sourcePathId: job.sourcePath.volumePath,
                    targetPathId: job.targetPath.volumePath,
                    sourceServerId: job.sourcePath.fileServer.config.configName,
                    targetServerId: job.targetPath.fileServer.config.configName,
                    conflictType: 'destination',
                    jobType: job.jobType,
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
     * Checks if there are any migration conflicts in the provided configurations
     * @param data - Data containing migrate configurations to check
     * @returns Boolean indicating if migration conflicts exist
     */
    async hasMigrationConflicts(data: MigrationConflictCheckData): Promise<boolean> {
        const conflicts = await this.checkMigrationConflicts(data);
        return conflicts.length > 0;
    }

    /**
     * Checks if there are any circular dependencies in the provided configurations (legacy method for backward compatibility)
     * @param data - Data containing migrate configurations to check
     * @returns Boolean indicating if circular dependencies exist
     */
    async hasCircularDependencies(data: MigrationConflictCheckData): Promise<boolean> {
        return this.hasMigrationConflicts(data);
    }

    /**
     * Gets migration conflict details for a specific source and destination path
     * @param sourcePathId - Source path ID
     * @param destinationPathIds - Array of destination path IDs
     * @returns Array of migration conflicts found
     */
    async getMigrationConflictDetails(sourcePathId: string, destinationPathIds: string[]): Promise<PreCheckCircularDependency[]> {
        const data: MigrationConflictCheckData = {
            migrateConfigs: [{
                sourcePathId,
                destinationPathId: destinationPathIds
            }]
        };
        return this.checkMigrationConflicts(data);
    }

    /**
     * Gets circular dependency details for a specific source and destination path (legacy method for backward compatibility)
     * @param sourcePathId - Source path ID
     * @param destinationPathIds - Array of destination path IDs
     * @returns Array of circular dependencies found
     */
    async getCircularDependencyDetails(sourcePathId: string, destinationPathIds: string[]): Promise<PreCheckCircularDependency[]> {
        return this.getMigrationConflictDetails(sourcePathId, destinationPathIds);
    }
}
