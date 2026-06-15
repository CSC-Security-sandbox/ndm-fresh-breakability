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

    const { totalFileServers, totalDiscoverJobs, totalMigrationJobs, totalCutOverJobs } =
      await this.getAggregatedCounts(schema, projectId, configId, jobConfigId);

    this.logger.log(`totalFileServers - ${totalFileServers}`);

    let totalDiscoveredSize = 0;
    let totalMigratedSize = 0;
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

  private async getAggregatedCounts(
    schema: string,
    projectId?: string,
    configId?: string,
    jobConfigId?: string,
  ): Promise<{
    totalFileServers: number;
    totalDiscoverJobs: number;
    totalMigrationJobs: number;
    totalCutOverJobs: number;
  }> {
    const conditions: string[] = [];
    const params: string[] = [];

    if (projectId) {
      params.push(projectId);
      conditions.push(`c.project_id = $${params.length}`);
    }
    if (configId) {
      params.push(configId);
      conditions.push(`c.id = $${params.length}`);
    }

    const whereStr = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const fsCountQuery = `
      SELECT COUNT(DISTINCT fs.id) AS count
      FROM ${schema}.file_server fs
      JOIN ${schema}.config c ON c.id = fs.config_id
      ${whereStr}
    `;
    const fsResult = await this.projectRepository.query(fsCountQuery, params);
    const totalFileServers = parseInt(fsResult?.[0]?.count || '0', 10);

    let jobWhere = `jc.is_deleted = false`;
    const jobParams: string[] = [...params];
    if (conditions.length > 0) {
      jobWhere += ` AND ${conditions.join(' AND ')}`;
    }
    if (jobConfigId) {
      jobParams.push(jobConfigId);
      jobWhere += ` AND jc.id = $${jobParams.length}`;
    }

    const jobCountQuery = `
      SELECT jc.job_type, COUNT(*) AS count
      FROM ${schema}.jobconfig jc
      JOIN ${schema}.volume v ON v.id = jc.source_path_id
      JOIN ${schema}.file_server fs ON fs.id = v.file_server_id
      JOIN ${schema}.config c ON c.id = fs.config_id
      WHERE ${jobWhere}
      GROUP BY jc.job_type
    `;
    const jobResult = await this.projectRepository.query(jobCountQuery, jobParams);

    let totalDiscoverJobs = 0;
    let totalMigrationJobs = 0;
    let totalCutOverJobs = 0;
    for (const row of jobResult || []) {
      const count = parseInt(row.count, 10) || 0;
      switch (row.job_type) {
        case JobType.Discover:
          totalDiscoverJobs = count;
          break;
        case JobType.Migrate:
          totalMigrationJobs = count;
          break;
        case JobType.CutOver:
          totalCutOverJobs = count;
          break;
      }
    }

    return { totalFileServers, totalDiscoverJobs, totalMigrationJobs, totalCutOverJobs };
  }
  
}
