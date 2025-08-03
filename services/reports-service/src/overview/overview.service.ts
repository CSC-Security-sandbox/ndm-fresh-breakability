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

@Injectable()
export class OverviewService {
  private readonly logger : LoggerService;
  constructor(
    @InjectRepository(InventoryEntity)
    private readonly inventoryRepository: Repository<InventoryEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
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

    this.logger.log(
      `projectDetails query took ${projectQueryEnd - projectQueryStart} ms`
    );

    let totalDiscoveredSize = 0;
    let totalMigratedSize = 0;
    let totalFileServers = projectDetails?.flatMap(
      (project) => project?.configs ?? []
    ).length;

    this.logger.log(`totalFileServers - ${totalFileServers}`);

    const scanRunDetailsStart = Date.now();

    const {
      totalDiscoverJobs,
      totalMigrationJobs,
      totalCutOverJobs
    } = this.countAllJobTypes(projectDetails);

    const scanRunDetails = projectDetails
      ?.flatMap((project) =>
        project.configs.flatMap((config) =>
          config.fileServers.flatMap((fileServer) =>
            fileServer.volumes.flatMap((volume) =>
              volume.sourceConfig
                .filter((jobConfig) => jobConfig.jobType === JobType.Discover)
                .flatMap((jobConfig) => jobConfig.jobRuns)
            )
          )
        )
      )
      .reduce((acc, jobRun) => {
        const existing = acc.find((j) => j.jobConfigId === jobRun.jobConfigId);
        if (
          !existing ||
          new Date(jobRun.createdAt) > new Date(existing.createdAt)
        ) {
          return [
            ...acc.filter((j) => j.jobConfigId !== jobRun.jobConfigId),
            jobRun,
          ];
        }
        return acc;
      }, []);

    const scanRunDetailsEnd = Date.now();

    this.logger.log(
      `scanRunDetails query took ${scanRunDetailsEnd - scanRunDetailsStart} ms`
    );
    this.logger.log(`scanRunDetails - ${JSON.stringify(scanRunDetails)}`);

    const completedJobRunDetails = scanRunDetails?.filter(
      (jobRun) => jobRun.status === JobRunStatus.Completed
    );
    const completedDiscoveryJobRunIds = completedJobRunDetails?.map(
      (run) => run.id
    );

    const migrateRun = projectDetails?.flatMap((project) =>
      project?.configs?.flatMap((config) =>
        config?.fileServers?.flatMap((fileServer) =>
          fileServer?.volumes?.flatMap((volume) =>
            volume?.sourceConfig
              ?.filter((jobConfig) => jobConfig.jobType == JobType.Migrate)
              ?.flatMap((jobConfig) => jobConfig.jobRuns)
          )
        )
      )
    );
    const cutOverRun = projectDetails?.flatMap((project) =>
      project?.configs?.flatMap((config) =>
        config?.fileServers?.flatMap((fileServer) =>
          fileServer?.volumes?.flatMap((volume) =>
            volume?.sourceConfig
              ?.filter((jobConfig) => jobConfig.jobType == JobType.CutOver)
              ?.flatMap((jobConfig) => jobConfig.jobRuns)
          )
        )
      )
    );
    const discoverySizeQueryBuilderStart = Date.now();

    const jobRunIds = [
      ...(migrateRun?.length ? migrateRun.map((run) => run.id) : []),
      ...(cutOverRun?.length ? cutOverRun.map((run) => run.id) : []),
      ...(completedDiscoveryJobRunIds ?? []),
    ];
    if (jobRunIds && jobRunIds.length > 0) {
      const placeholders = jobRunIds.map((_, idx) => `$${idx + 1}`).join(",");
      const discoveredSize = await this.inventoryRepository.query(
        `
        SELECT COALESCE(SUM(latest_inventory.file_size), 0) as "totalDiscoveredSize"
        FROM (
          SELECT DISTINCT ON (i.path) i.file_size
          FROM  ${schema}.inventory i
          WHERE i.job_run_id IN (${placeholders})
          ORDER BY i.path, i.created_at DESC
        ) as latest_inventory
        `,
        jobRunIds
      );

      const discoverySizeQueryBuilderEnd = Date.now();

      this.logger.log(
        `inventoryQueryBuilder query took ${discoverySizeQueryBuilderEnd - discoverySizeQueryBuilderStart} ms`
      );

      totalDiscoveredSize = discoveredSize?.[0]?.totalDiscoveredSize ?? 0;

      this.logger.log(`discoveredSize - ${JSON.stringify(discoveredSize)}`);
    }

    if (migrateRun?.length > 0 || cutOverRun?.length > 0) {
      const migrationQueryBuilderStart = Date.now();
      const jobRunIds = [
        ...(migrateRun?.length ? migrateRun.map((run) => run.id) : []),
        ...(cutOverRun?.length ? cutOverRun.map((run) => run.id) : []),
      ];
      if (jobRunIds.length === 0) {
        this.logger.log("No job runs found, skipping migration query");
        totalMigratedSize = 0;
        return;
      }
      const placeholders = jobRunIds.map((_, idx) => `$${idx + 1}`).join(",");
      const migratedSize = await this.inventoryRepository.query(
        `
        SELECT COALESCE(SUM(latest_inventory.file_size), 0) as "totalMigratedSize"
        FROM (
          SELECT DISTINCT ON (i.path) i.file_size
          FROM  ${schema}.inventory i
          WHERE i.job_run_id IN (${placeholders})
          ORDER BY i.path, i.created_at DESC
        ) as latest_inventory
        `,
        jobRunIds
      );
      totalMigratedSize = migratedSize?.[0]?.totalMigratedSize ?? 0;
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
    };
    const getStorageAndJobsOverviewEnd = Date.now();
    this.logger.log(
      `getStorageAndJobsOverview whole logic took time to execute: ${getStorageAndJobsOverviewEnd - getStorageAndJobsOverviewStart} ms`
    );
    this.logger.log(`OVERVIEW DATA: ${overViewData} ms`);
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
