import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { OverviewDTO } from "src/overview/overview.dto";
import { InventoryEntity } from "src/entities/inventory.entity";
import { ProjectEntity } from "src/entities/project.entity";
import { Repository } from "typeorm";
import { JobRunStatus, JobType } from "src/constants/enums";
import { covertBytes } from "src/utils/mapper";

@Injectable()
export class OverviewService {
  private logger: Logger = new Logger(OverviewService.name);
  constructor(
    @InjectRepository(InventoryEntity)
    private readonly inventoryRepository: Repository<InventoryEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>
  ) {}

  async getStorageAndJobsOverview(
    projectId: string,
    configId: string,
    jobConfigId: string
  ) {
    const getStorageAndJobsOverviewStart = Date.now();
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
    this.logger.log(`projectDetails - ${JSON.stringify(projectDetails)}`);

    let totalDiscoveredSize = 0;
    let totalMigratedSize = 0;
    let totalFileServers = projectDetails?.flatMap(
      (project) => project?.configs ?? []
    ).length;

    this.logger.log(`totalFileServers - ${totalFileServers}`);

    let totalDiscoverJobs = 0;

    const scanRunDetailsStart = Date.now();

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

    totalDiscoverJobs = scanRunDetails?.length ?? 0;

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
    if (jobRunIds.length === 0) {
      this.logger.log("No job runs found, skipping migration query");
      totalMigratedSize = 0;
      return;
    }
    const discoverySizeQueryBuilder = this.inventoryRepository
    .createQueryBuilder()
    .select('COALESCE(SUM(latest_inventory."fileSize"), 0)', "totalDiscoveredSize")
    .from((subQuery) => {
      return subQuery
      .select("latest_inventory.*")
        .from((qb) => {
          return qb
            .select("inventory.path", "path")
            .addSelect("COALESCE(inventory.fileSize,0)", "fileSize")
            .addSelect(
              "ROW_NUMBER() OVER (PARTITION BY inventory.path ORDER BY inventory.createdAt DESC)",
              "row_num"
            )
            .from("inventory", "inventory")
            .where("inventory.job_run_id IN (:...jobRunId)", {
              jobRunId: jobRunIds,
            });
        }, "latest_inventory")
        .where("latest_inventory.row_num = 1")
    }, "latest_inventory");
  

    const discoveredSize = await discoverySizeQueryBuilder.getRawOne();

    const discoverySizeQueryBuilderEnd = Date.now();

    this.logger.log(
      `inventoryQueryBuilder query took ${discoverySizeQueryBuilderEnd - discoverySizeQueryBuilderStart} ms`
    );

    totalDiscoveredSize = discoveredSize?.totalDiscoveredSize ?? 0;

    this.logger.log(`discoveredSize - ${JSON.stringify(discoveredSize)}`);

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
      const migrationQueryBuilder = this.inventoryRepository
        .createQueryBuilder()
        .select('SUM(subquery."maxFileSize")', "totalMigratedSize")
        .from((subQuery) => {
          return subQuery
            .select("inventory.path", "path")
            .addSelect("MAX(inventory.fileSize)", "maxFileSize")
            .from("inventory", "inventory")
            .where("inventory.job_run_id IN(:...jobRunId)", {
              jobRunId: jobRunIds,
            })
            .groupBy("inventory.path");
        }, "subquery");

      const migratedSize = await migrationQueryBuilder.getRawOne();

      const migrationQueryBuilderEnd = Date.now();
      this.logger.log(
        `migrationQueryBuilder query took ${migrationQueryBuilderEnd - migrationQueryBuilderStart} ms`
      );

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
        totalDiscoverJobs: totalDiscoverJobs,
        totalMigrateJobs: {
          baseLineJob: migrateRun?.length > 0 ? 1 : 0,
          incrementalJob: migrateRun?.length > 1 ? migrateRun.length - 1 : 0,
        },
        totalCutoverJobs: cutOverRun?.length,
      },
    };
    const getStorageAndJobsOverviewEnd = Date.now();
    this.logger.log(
      `getStorageAndJobsOverview whole logic took time to execute: ${getStorageAndJobsOverviewEnd - getStorageAndJobsOverviewStart} ms`
    );
    return overViewData;
  }
}
