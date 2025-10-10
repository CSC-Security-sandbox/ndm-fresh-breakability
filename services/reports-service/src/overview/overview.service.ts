import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { OverviewDTO } from "src/overview/overview.dto";
import { InventoryEntity } from "src/entities/inventory.entity";
import { ProjectEntity } from "src/entities/project.entity";
import { Repository } from "typeorm";
import { JobRunStatus, JobType } from "src/constants/enums";
import { formatBytes } from "@netapp-cloud-datamigrate/jobs-lib";
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';
import { StorageOverviewSummaryEntity } from "src/entities/storage-summary-mv.entity";

@Injectable()
export class OverviewService {
  private readonly logger : LoggerService;
  constructor(
    @InjectRepository(InventoryEntity)
    private readonly inventoryRepository: Repository<InventoryEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
    @InjectRepository(StorageOverviewSummaryEntity)
    private readonly storageOverviewSummaryRepository: Repository<StorageOverviewSummaryEntity>,
    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory
  ) {
    if (loggerFactory) {
      this.logger = loggerFactory.create(OverviewService.name);
    } else {
      // Fallback to basic NestJS Logger for worker threads
      this.logger = new Logger(OverviewService.name) as any;
    }
  }

  async getStorageAndJobsOverview(
    projectId: string,
    configId: string,
    jobConfigId: string
  ) {
    const getStorageAndJobsOverviewStart = Date.now();
    const schema = process.env.SCHEMA || "datamigrator";
    const whereClause = {};
    if (projectId) {
      whereClause["id"] = projectId;
    }

    if (configId) {
      whereClause["configs"] = {
        ...whereClause["configs"],
        id: configId,
      };
    }

    if (jobConfigId) {
      whereClause["configs"] = {
        ...whereClause["configs"],
        fileServers: {
          ...whereClause["configs?.fileServers"],
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

    const projectQueryStart = Date.now();

    const projectDetails = await this.projectRepository.find({
      where: whereClause,
      relations: [
        "configs",
        "configs.fileServers",
        "configs.fileServers.volumes",
        "configs.fileServers.volumes.sourceConfig",
        "configs.fileServers.volumes.sourceConfig.jobRuns",
      ],
    });

    const projectQueryEnd = Date.now();

    this.logger.debug("projectDetails - " + projectDetails.length);
    this.logger.debug("projectDetails - " + JSON.stringify(projectDetails));

    this.logger.debug(
      `projectDetails query took ${projectQueryEnd - projectQueryStart} ms`
    );

    let totalDiscoveredSize = 0;
    let totalMigratedSize = 0;
    let totalFileServers = projectDetails?.flatMap(
      (project) => project?.configs ?? []
    ).length;

    this.logger.log(`totalFileServers - ${totalFileServers}`);


    const {
      totalDiscoverJobs,
      totalMigrationJobs,
      totalCutOverJobs
    } = this.countAllJobTypes(projectDetails);
    let lastRefreshed: Date = new Date();
    if(projectId){
      this.logger.log(`Project ID provided: ${projectId}`);
      const projectStorageOverview = await this.storageOverviewSummaryRepository.find({
        where: { projectId: projectId },
      })
      totalDiscoveredSize = projectStorageOverview?.reduce((acc, item) => {
        return acc + (Number(item.totalDiscoveredSize) || 0);
      }, 0) || 0;
      
      totalMigratedSize = projectStorageOverview?.reduce((acc, item) => {
        return acc + (Number(item.totalMigratedSize) || 0);
      }, 0) || 0;
      if(projectStorageOverview && projectStorageOverview.length > 0) {
        lastRefreshed = projectStorageOverview[0]?.lastRefreshed
      }
      this.logger.debug(`Total Discovered Size for ${projectId}: ${totalDiscoveredSize}`);
      this.logger.debug(`Total Migrated Size for ${projectId}: ${totalMigratedSize}`);
      this.logger.log(`Project Storage Overview: ${JSON.stringify(projectStorageOverview)}`);
    }
    if(configId){
      this.logger.log(`Config ID provided: ${configId}`);
      const configStorageOverview = await this.storageOverviewSummaryRepository.findOne({
        where: { configId: configId },
      });
      if(configStorageOverview) {
        lastRefreshed= configStorageOverview?.lastRefreshed;
      }
      totalDiscoveredSize = configStorageOverview?.totalDiscoveredSize ?? 0;
      totalMigratedSize = configStorageOverview?.totalMigratedSize ?? 0;
      this.logger.debug(`Total Discovered Size for ${configId}: ${totalDiscoveredSize}`);
      this.logger.debug(`Total Migrated Size for ${configId}: ${totalMigratedSize}`);
      this.logger.log(`Config Storage Overview: ${JSON.stringify(configStorageOverview)}`);
    }  
    
    let totalPending = totalDiscoveredSize - totalMigratedSize;
    let totalPendingSize = formatBytes(Number(totalPending));

    let updateTotalMigratedSize = formatBytes(Number(totalMigratedSize));
    let updateTotalDiscoveredSize = formatBytes(Number(totalDiscoveredSize));

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
        totalDiscoverJobs,
        totalMigrateJobs: totalMigrationJobs,
        totalCutoverJobs: totalCutOverJobs,
      },
      lastRefreshed: lastRefreshed
    };
    const getStorageAndJobsOverviewEnd = Date.now();
    this.logger.log(
      `getStorageAndJobsOverview whole logic took time to execute: ${getStorageAndJobsOverviewEnd - getStorageAndJobsOverviewStart} ms`
    );
    this.logger.debug(`OVERVIEW DATA: ${JSON.stringify(overViewData)}`);
    return overViewData;
  }

  countAllJobTypes(projects: any) {
    try {
      const allConfigs =
        projects?.flatMap((project) =>
          project?.configs?.flatMap((config) =>
            config?.fileServers?.flatMap((fileServer) =>
              fileServer?.volumes?.flatMap((volume) =>
                volume?.sourceConfig || []
              )
            )
          )
        ) || [];

      let totalDiscoverJobs = 0;
      let totalMigrationJobs = 0;
      let totalCutOverJobs = 0;

      for (const config of allConfigs) {
        switch (config.jobType) {
          case JobType.Discover:
            totalDiscoverJobs++;
            break;
          case JobType.Migrate:
            totalMigrationJobs++;
            break;
          case JobType.CutOver:
            totalCutOverJobs++;
            break;
        }
      }

      return {
        totalDiscoverJobs,
        totalMigrationJobs,
        totalCutOverJobs,
      };
    } catch (error) {
      this.logger.error('Error counting job configs:', error?.message);
      return {
        totalDiscoverJobs: 0,
        totalMigrationJobs: 0,
        totalCutOverJobs: 0,
      };
    }
  }
  
}
