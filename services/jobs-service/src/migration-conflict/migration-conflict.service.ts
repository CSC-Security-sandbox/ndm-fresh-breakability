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

        // Circular dependency: conflict at export level only (reverse direction A→B vs B→A).
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
            // Block when destinations overlap (same dir or parent/child relationship)
            if (this.hasDirectoryOverlap(config.destinationDirectoryPath, job.targetDirectoryPath)) {
                // Allow only exact duplicate: same source path, same source directory, and same destination directory
                const isExactDuplicate = job.sourcePathId === config.sourcePathId &&
                    this.isSameDirectory(config.sourceDirectoryPath, job.sourceDirectoryPath) &&
                    this.isSameDirectory(config.destinationDirectoryPath, job.targetDirectoryPath);

                if (!isExactDuplicate) {
                    dependencies.push({
                        status: job.status.toString(),
                        jobId: job.id,
                        sourcePathId: job.sourcePath.volumePath,
                        targetPathId: job.targetPath.volumePath,
                        sourceServerId: job.sourcePath.fileServer.config.configName,
                        targetServerId: job.targetPath.fileServer.config.configName,
                        conflictType: 'destination',
                        jobType: job.jobType,
                        sourceDirectoryPath: job.sourceDirectoryPath ?? null,
                        targetDirectoryPath: job.targetDirectoryPath ?? null,
                    });
                }
            }
        }

        // Source-side parent-child conflicts: same source path with overlapping source directories
        const sourcePathConflictingJobs = await this.jobConfigEntity.find({
            where: {
                jobType: In([JobType.MIGRATE, JobType.CUT_OVER]),
                status: JobStatus.Active,
                sourcePathId: config.sourcePathId,
            },
            relations: [
                'targetPath',
                'sourcePath',
                'sourcePath.fileServer.config',
                'targetPath.fileServer.config'
            ]
        });
        const addedJobIds = new Set(dependencies.map(d => d.jobId));
        const uniqueSourcePathConflicts = sourcePathConflictingJobs.filter(
            job => !addedJobIds.has(job.id)
        );

        for (const job of uniqueSourcePathConflicts) {
            // Block when source directories overlap (same dir or parent/child relationship)
            if (this.hasDirectoryOverlap(config.sourceDirectoryPath, job.sourceDirectoryPath)) {
                // Allow only exact duplicate: same source path and same source directory
                const isExactDuplicate = this.isSameDirectory(config.sourceDirectoryPath, job.sourceDirectoryPath);

                if (!isExactDuplicate) {
                    dependencies.push({
                        status: job.status.toString(),
                        jobId: job.id,
                        sourcePathId: job.sourcePath.volumePath,
                        targetPathId: job.targetPath.volumePath,
                        sourceServerId: job.sourcePath.fileServer.config.configName,
                        targetServerId: job.targetPath.fileServer.config.configName,
                        conflictType: 'source',
                        jobType: job.jobType,
                        sourceDirectoryPath: job.sourceDirectoryPath ?? null,
                        targetDirectoryPath: job.targetDirectoryPath ?? null,
                    });
                }
            }
        }
        return dependencies;
    }

    /**
     * Trims trailing slashes from a path without using regex (avoids ReDoS on user-controlled input).
     */
    private trimTrailingSlashes(s: string): string {
        let end = s.length;
        while (end > 0 && s[end - 1] === '/') end--;
        return end === s.length ? s : s.slice(0, end);
    }

    /**
     * Checks if two directory paths overlap (one is a parent/ancestor of the other, or they are the same).
     * If either is null,undefined, or an empty string, it's an export-level job which overlaps with everything.
     */
    private hasDirectoryOverlap(dirA?: string, dirB?: string): boolean {
        // If either side is export-level (no directory), they always overlap
        if (!dirA || !dirB) return true;

        const normA = this.trimTrailingSlashes(dirA);
        const normB = this.trimTrailingSlashes(dirB);

        // Check if paths are exactly the same
        if (normA === normB) return true;

        // Check if one path is a parent of the other with proper directory boundary checking
        return this.isParentPath(normA, normB) || this.isParentPath(normB, normA);
    }

    /**
     * Checks if parentPath is a parent directory of childPath.
     * Ensures proper directory boundary checking to avoid false positives like "/data" vs "/data2".
     */
    private isParentPath(parentPath: string, childPath: string): boolean {
        // Child path must be longer than parent path
        if (childPath.length <= parentPath.length) return false;
        
        // Child path must start with parent path
        if (!childPath.startsWith(parentPath)) return false;
        
        // The character immediately after the parent path must be a directory separator
        return childPath[parentPath.length] === '/';
    }

    /**
     * Checks if two directory paths are exactly the same (normalized).
     */
    private isSameDirectory(dirA?: string, dirB?: string): boolean {
        const normA = this.trimTrailingSlashes(dirA || '');
        const normB = this.trimTrailingSlashes(dirB || '');
        return normA === normB;
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
