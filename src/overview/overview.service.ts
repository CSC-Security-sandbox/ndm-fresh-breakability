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
            let totalFileServers =  projectDetails.flatMap(project => project?.configs).length;
            let totalDiscoverJobs = 0;
            const scanRunDetails = projectDetails.flatMap(project =>
                project.configs.flatMap(config =>
                    config.fileServers.flatMap(fileServer =>
                        fileServer.volumes.flatMap(volume =>
                            volume.jobConfig
                                .filter(jobConfig => jobConfig.jobType === JobType.Scan)
                                .map(jobConfig => jobConfig.jobRunDetails)
                                .flat()
                        )
                    )
                )
            );
            totalDiscoverJobs = scanRunDetails.length;
            
            const lastScanRun = scanRunDetails
            .sort((a, b) => b.endTime.getTime() - a.endTime.getTime())
            .slice(0, 1);
        
            if (lastScanRun.length > 0) {
                const inventoryQueryBuilder =
                    this.inventoryRepository.createQueryBuilder('inventory')
                        .select('SUM(inventory.fileSize)', 'totalSize')

                const jobRunId = lastScanRun[0].id;
                if (lastScanRun[0].id) {
                    inventoryQueryBuilder.andWhere('job_run_id = :jobRunId', { jobRunId });
                }

                const discoveredSize = await inventoryQueryBuilder.getRawMany();
                totalDiscoveredSize = discoveredSize[0]?.totalSize || 0;
            }
            const migrateRun = projectDetails.flatMap(project =>
                project.configs.flatMap(config =>
                    config.fileServers.flatMap(fileServer =>
                        fileServer.volumes.flatMap(volume =>
                            volume.jobConfig.filter(jobConfig => jobConfig.jobType == JobType.Migrate).flatMap(jobConfig =>
                                jobConfig.jobRunDetails
                            )
                        )
                    )
                )
            )
            const cutOverRun= projectDetails.flatMap(project =>
                project.configs.flatMap(config =>
                    config.fileServers.flatMap(fileServer =>
                        fileServer.volumes.flatMap(volume =>
                            volume.jobConfig.filter(jobConfig => jobConfig.jobType == JobType.CutOver).flatMap(jobConfig =>
                                jobConfig.jobRunDetails
                            )
                        )
                    )
                )
            )
            if (migrateRun.length > 0) {
                const migrationQueryBuilder =
                    this.inventoryRepository.createQueryBuilder('inventory')
                        .select('SUM(MAX(inventory.fileSize))', 'totalMigratedSize')
                        .addSelect('SUM(inventory.filePath)', 'filePath')
                        .where('inventory.job_run_id IN(:...jobRunId)', { jobRunId: migrateRun.map(run => run.id) })
                        .groupBy('inventory.filePath')
                const migratedSize = await migrationQueryBuilder.getRawMany();
                totalMigratedSize =  migratedSize[0]?.totalMigratedSize || 0;
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
                totalCutoverJobs: cutOverRun.length,
            },
           }
            return overViewData;
        }

        covertBytes(bytes: number): string {
            const bytesInKB = 1024;
            const bytesInMB = bytesInKB ** 2;
            const bytesInGB = bytesInMB ** 2;
            const bytesInTB = bytesInGB ** 2;
            const bytesInPB = bytesInTB ** 2;
        
            if (bytes < bytesInKB) {
                return `${bytes} B`;
            } else if (bytes < bytesInMB) {
                return `${(bytes / bytesInKB).toFixed(2)} KB`;
            } else if (bytes < bytesInGB) {
                return `${(bytes / bytesInMB).toFixed(2)} MB`;
            } else if (bytes < bytesInTB) {
                return `${(bytes / bytesInGB).toFixed(2)} GB`;
            } else if (bytes < bytesInPB) {
                return `${(bytes / bytesInTB).toFixed(2)} TB`;
            } else {
                return `${(bytes / bytesInPB).toFixed(2)} PB`;
            }
        }
    }

