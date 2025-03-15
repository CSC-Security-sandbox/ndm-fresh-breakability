import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OverviewDTO } from 'src/overview/overview.dto';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { Repository } from 'typeorm';
import { JobRunStatus, JobType } from 'src/constants/enums';
import { covertBytes } from 'src/utils/mapper';

@Injectable()
export class OverviewService {
    private logger: Logger = new Logger(OverviewService.name);
    constructor(@InjectRepository(InventoryEntity) private readonly inventoryRepository: Repository<InventoryEntity>,
        @InjectRepository(ProjectEntity) private readonly projectRepository: Repository<ProjectEntity>) { }

    async getStorageAndJobsOverview(projectId: string, configId: string, jobConfigId: string) {
        const whereClause ={};
            if (projectId) {
                whereClause['id'] = projectId;
            }
        
            if (configId) {
                whereClause['configs'] = {
                    ...whereClause['configs'],
                    id: configId,
                };
            }
        
            if (jobConfigId) {
                whereClause['configs'] = {
                    ...whereClause['configs'],
                    fileServers: {
                        ...whereClause['configs?.fileServers'],
                        volumes: {
                            sourceConfig: {
                                id: jobConfigId,
                                jobRuns: {
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
                    'configs.fileServers.volumes.sourceConfig',
                    'configs.fileServers.volumes.sourceConfig.jobRuns',
                ],
            });

            this.logger.log(`projectDetails - ${JSON.stringify(projectDetails)}`);
            
            let totalDiscoveredSize = 0;
            let totalMigratedSize = 0;
            let totalFileServers = projectDetails?.flatMap(project => project?.configs ?? []).length;

            this.logger.log(`totalFileServers - ${totalFileServers}`);

            let totalDiscoverJobs = 0;
            const scanRunDetails = projectDetails?.flatMap(project =>
                project.configs.flatMap(config =>
                    config.fileServers.flatMap(fileServer =>
                        fileServer.volumes.flatMap(volume =>
                            volume.sourceConfig
                                .filter(jobConfig => jobConfig.jobType === JobType.Discover)
                                .flatMap(jobConfig => jobConfig.jobRuns)
                        )
                    )
                )
            ).reduce((acc, jobRun) => {
                const existing = acc.find(j => j.jobConfigId === jobRun.jobConfigId);
                if (!existing || new Date(jobRun.createdAt) > new Date(existing.createdAt)) {
                    return [...acc.filter(j => j.jobConfigId !== jobRun.jobConfigId), jobRun];
                }
                return acc;
            }, []);

            this.logger.log(`scanRunDetails - ${JSON.stringify(scanRunDetails)}`);

            totalDiscoverJobs = scanRunDetails?.length ?? 0;

            const completedJobRunDetails = scanRunDetails?.filter(jobRun => jobRun.status === JobRunStatus.Completed);
            const completedJobRunIds = completedJobRunDetails?.map(run => run.id);

        const inventoryQueryBuilder = this.inventoryRepository
            .createQueryBuilder('inventory')
            .select('SUM(inventory.fileSize)', 'totalSize')
            .where('inventory.jobRunId IN (:...completedJobRunIds)', { completedJobRunIds: completedJobRunIds.length ? completedJobRunIds : ['00000000-0000-0000-0000-000000000000'] });

            const discoveredSize = await inventoryQueryBuilder.getRawMany();
            totalDiscoveredSize = discoveredSize[0]?.totalSize ?? 0;

            this.logger.log(`discoveredSize - ${JSON.stringify(discoveredSize)}`);

            const migrateRun = projectDetails?.flatMap(project =>
                project?.configs?.flatMap(config =>
                    config?.fileServers?.flatMap(fileServer =>
                        fileServer?.volumes?.flatMap(volume =>
                            volume?.sourceConfig?.filter(jobConfig => jobConfig.jobType == JobType.Migrate)?.flatMap(jobConfig =>
                                jobConfig.jobRuns
                            )
                        )
                    )
                )
            )
            const cutOverRun= projectDetails?.flatMap(project =>
                project?.configs?.flatMap(config =>
                    config?.fileServers?.flatMap(fileServer =>
                        fileServer?.volumes?.flatMap(volume =>
                            volume?.sourceConfig?.filter(jobConfig => jobConfig.jobType == JobType.CutOver)?.flatMap(jobConfig =>
                                jobConfig.jobRuns
                            )
                        )
                    )
                )
            )
        if (migrateRun?.length > 0) {
            const migrationQueryBuilder = this.inventoryRepository
                .createQueryBuilder()
                .select('SUM(subquery."maxFileSize")', 'totalMigratedSize')
                .from(subQuery => {
                    return subQuery
                        .select('inventory.path', 'path')
                        .addSelect('MAX(inventory.fileSize)', 'maxFileSize')
                        .from('inventory', 'inventory')
                        .where('inventory.job_run_id IN(:...jobRunId)', { jobRunId: migrateRun.map(run => run.id) })
                        .groupBy('inventory.path');
                }, 'subquery');

            const migratedSize = await migrationQueryBuilder.getRawOne();
            totalMigratedSize = migratedSize?.totalMigratedSize ?? 0;
        }

           let totalPending = totalDiscoveredSize - totalMigratedSize;
           let totalPendingSize = covertBytes(Number(totalPending));
           
           let updateTotalMigratedSize = covertBytes(Number(totalMigratedSize));
           let updateTotalDiscoveredSize = covertBytes(Number(totalDiscoveredSize));

           this.logger.log(`totalDiscoveredSize - ${totalDiscoveredSize}`);
           this.logger.log(`totalMigratedSize - ${totalMigratedSize}`);
           this.logger.log(`totalPending - ${totalPending}`);

           this.logger.log(`updateTotalDiscoveredSize - ${updateTotalDiscoveredSize}`);
           this.logger.log(`updateTotalMigratedSize - ${updateTotalMigratedSize}`);
           this.logger.log(`totalPendingSize - ${totalPendingSize}`);

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

        

    }

