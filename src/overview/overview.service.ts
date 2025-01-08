import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OverviewDTO } from 'src/overview/overview.dto';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { Repository } from 'typeorm';
import { JobRunStatus, JobType } from 'src/constants/enums';

@Injectable()
export class OverviewService {
    constructor(@InjectRepository(InventoryEntity) private readonly inventoryRepository: Repository<InventoryEntity>,
        @InjectRepository(ProjectEntity) private readonly projectRepository: Repository<ProjectEntity>) { }

    async getStorageAndJobsOverview(projectId: string, fileServerId: string, jobConfigId: string) {
        const whereClause ={};
            if (projectId) {
                whereClause['id'] = projectId;
            }
        
            if (fileServerId) {
                whereClause['configs'] = {
                    ...whereClause['configs'],
                    fileServers: {
                        ...whereClause['configs?.fileServers'],
                        id: fileServerId,
                    },
                };
            }
        
            if (jobConfigId) {
                whereClause['configs'] = {
                    ...whereClause['configs'],
                    fileServers: {
                        ...whereClause['configs?.fileServers'],
                        volumes: {
                            jobConfig: {
                                id: jobConfigId,
                                jobRunDetails: {
                                    status: JobRunStatus.Completed,
                                },
                            },
                        },
                    },
                };
            }
        
            const projectDetails = await this.projectRepository.find({
                where: whereClause,
                relations: [
                    'configs',
                    'configs.fileServers',
                    'configs.fileServers.volumes',
                    'configs.fileServers.volumes.jobConfig',
                    'configs.fileServers.volumes.jobConfig.jobRunDetails',
                ],
            });
            let totalDiscoveredSize = 0;
            let totalMigratedSize = 0;
            let totalFileServers = projectDetails?.flatMap(project => project?.configs ?? []).length;
            let totalDiscoverJobs = 0;
            const scanRunDetails = projectDetails?.flatMap(project =>
                project.configs.flatMap(config =>
                    config.fileServers.flatMap(fileServer =>
                        fileServer.volumes.flatMap(volume =>
                            volume.jobConfig
                                .filter(jobConfig => jobConfig.jobType === JobType.Discover)
                                .map(jobConfig => jobConfig.jobRunDetails)
                                .flat()
                        )
                    )
                )
            )
            .filter(jobRun => jobRun.status === JobRunStatus.Completed)
            .reduce((acc, jobRun) => {
                const existing = acc.find(j => j.jobConfigId === jobRun.jobConfigId);
                if (!existing || new Date(jobRun.createdAt) > new Date(existing.createdAt)) {
                    return [...acc.filter(j => j.jobConfigId !== jobRun.jobConfigId), jobRun];
                }
                return acc;
            }, []);

            totalDiscoverJobs = scanRunDetails?.length;
            const completedJobRunIds = scanRunDetails?.map(run => run.id);

        const inventoryQueryBuilder = this.inventoryRepository
            .createQueryBuilder('inventory')
            .select('SUM(inventory.fileSize)', 'totalSize')
            .where('inventory.jobRunId IN (:...completedJobRunIds)', { completedJobRunIds: completedJobRunIds.length ? completedJobRunIds : ['00000000-0000-0000-0000-000000000000'] });

            const discoveredSize = await inventoryQueryBuilder.getRawMany();
            totalDiscoveredSize = (discoveredSize[0]?.totalSize !== null && discoveredSize.length > 0) ? discoveredSize[0]?.totalSize : 0;

            const migrateRun = projectDetails?.flatMap(project =>
                project?.configs?.flatMap(config =>
                    config?.fileServers?.flatMap(fileServer =>
                        fileServer?.volumes?.flatMap(volume =>
                            volume?.jobConfig?.filter(jobConfig => jobConfig.jobType == JobType.Migrate)?.flatMap(jobConfig =>
                                jobConfig.jobRunDetails
                            )
                        )
                    )
                )
            )
            const cutOverRun= projectDetails?.flatMap(project =>
                project?.configs?.flatMap(config =>
                    config?.fileServers?.flatMap(fileServer =>
                        fileServer?.volumes?.flatMap(volume =>
                            volume?.jobConfig?.filter(jobConfig => jobConfig.jobType == JobType.CutOver)?.flatMap(jobConfig =>
                                jobConfig.jobRunDetails
                            )
                        )
                    )
                )
            )
            if (migrateRun?.length > 0) {
                const migrationQueryBuilder =
                    this.inventoryRepository.createQueryBuilder('inventory')
                        .select('SUM(MAX(inventory.fileSize))', 'totalMigratedSize')
                        .addSelect('SUM(inventory.filePath)', 'filePath')
                        .where('inventory.job_run_id IN(:...jobRunId)', { jobRunId: migrateRun.map(run => run.id) })
                        .groupBy('inventory.filePath')
                const migratedSize = await migrationQueryBuilder.getRawMany();
                totalMigratedSize = (migratedSize && migratedSize.length > 0) ? migratedSize[0]?.totalMigratedSize : 0;
            }
           let totalPending = totalDiscoveredSize - totalMigratedSize;
           let totalPendingSize = this.covertBytes(totalPending);
           
           let updateTotalMigratedSize = this.covertBytes(totalMigratedSize);
           let updateTotalDiscoveredSize = this.covertBytes(totalDiscoveredSize);
          
           const overViewData: OverviewDTO = {
            storageDetails: {
                totalDiscoveredSize: updateTotalDiscoveredSize,
                totalMigratedSize: updateTotalMigratedSize,
                totalFileServers,
                totalPendingSize: totalPendingSize,
            },
            jobDetails: {
                totalDiscoverJobs:totalDiscoverJobs ,
                totalMigrateJobs: {
                    baseLineJob: migrateRun?.length>0 ? 1 : 0,
                    incrementalJob: migrateRun?.length>1 ? migrateRun.length - 1 : 0,
                },
                totalCutoverJobs: cutOverRun?.length,
            },
           }
            return overViewData;
        }

        covertBytes(bytes: number): string {
            if (bytes === 0) return '0 B';
        
            const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
            let size = bytes;
            let unitIndex = 0;
        
            while (size >= 1024 && unitIndex < units.length - 1) {
                size /= 1024;
                unitIndex++;
            }
        
            return size === Math.floor(size)
                ? `${size?.toFixed(0)} ${units[unitIndex]}`
                : `${size?.toFixed(2)} ${units[unitIndex]}`;
        }

    }

