import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { OverviewDTO } from "src/overview/overview.dto";
import { InventoryEntity } from "src/entities/inventory.entity";
import { ProjectEntity } from "src/entities/project.entity";
import { Repository } from "typeorm";
import { JobRunStatus, JobType } from "src/constants/enums";
import { covertBytes } from "src/utils/mapper";
import { time } from "console";

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
    this.logger.log(
      `Fetching Storage and Jobs Overview for ProjectId: ${projectId}, ConfigId: ${configId}, JobConfigId: ${jobConfigId}`
    );
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

    const projectDetails = await this.measureExecutionTime(
      "[Overview][projectDetails]",
      () =>
        this.projectRepository.find({
          where: whereClause,
          relations: [
            "configs",
            "configs.fileServers",
            "configs.fileServers.volumes",
            "configs.fileServers.volumes.sourceConfig",
            "configs.fileServers.volumes.sourceConfig.jobRuns",
          ],
        })
    );
    let totalDiscoveredSize = 0;
    let totalMigratedSize = 0;
    let totalFileServers = projectDetails?.flatMap(
      (project) => project?.configs ?? []
    ).length;
    let totalDiscoverJobs = 0;
    this.logger.log(`Total File Servers: ${totalFileServers}`);
    this.logger.log(`Started Fetching the Discovery Jobs Details`);
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
    this.logger.log(`Done Fetching the Discovery Jobs Details`);
    totalDiscoverJobs = scanRunDetails?.length ?? 0;

    this.logger.log(`Total Discovered Jobs: ${totalDiscoverJobs}`);

    const completedJobRunDetails = scanRunDetails?.filter(
      (jobRun) => jobRun.status === JobRunStatus.Completed
    );
    this.logger.log(`Total Completed Jobs: ${completedJobRunDetails?.length}`);
    const completedJobRunIds = completedJobRunDetails?.map((run) => run.id);
    this.logger.log(`Completed Job Run Ids: ${completedJobRunIds}`);

    const discoveredSize =
      await this.calculateTotalDiscoveredSize(completedJobRunIds);
    totalDiscoveredSize = discoveredSize[0]?.totalSize ?? 0;

    this.logger.log(`Total Discovered Size: ${totalDiscoveredSize}`);

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
    this.logger.log(`Total Migrate Jobs: ${migrateRun?.length}`);
    this.logger.log(`Total CutOver Jobs: ${cutOverRun?.length}`);
    if (migrateRun?.length > 0) {
      totalMigratedSize = await this.calculateTotalMigratedSize(migrateRun);
      this.logger.log(`Total Migrated Size: ${totalMigratedSize}`);
    }

    let totalPending = totalDiscoveredSize - totalMigratedSize;
    this.logger.log(`Total Pending Size: ${totalPending}`);
    let totalPendingSize = covertBytes(Number(totalPending));
    this.logger.log(`Total Pending Size after converting: ${totalPendingSize}`);

    let updateTotalMigratedSize = covertBytes(Number(totalMigratedSize));
    this.logger.log(
      `Total Migrated Size after converting: ${updateTotalMigratedSize}`
    );
    let updateTotalDiscoveredSize = covertBytes(Number(totalDiscoveredSize));
    this.logger.log(
      `Total Discovered Size after converting: ${updateTotalDiscoveredSize}`
    );

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
    return overViewData;
  }

  /**
   * Measures and logs the execution time of an asynchronous function.
   *
   * @param label - A label to identify the function in the log.
   * @param fn - The async function to execute.
   * @returns The result of the async function.
   */
  async measureExecutionTime<T>(
    label: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    const result = await fn();
    const endTime = Date.now();
    this.logger.debug(`${label} executed in ${endTime - startTime} ms`);
    return result;
  }

  /**
   *
   * @param completedJobRunIds
   * @returns total discovered size
   */
  async calculateTotalDiscoveredSize(
    completedJobRunIds: string[]
  ): Promise<number> {
    const inventoryQueryBuilder = this.inventoryRepository
      .createQueryBuilder("inventory")
      .select("SUM(inventory.fileSize)", "totalSize")
      .where("inventory.jobRunId IN (:...completedJobRunIds)", {
        completedJobRunIds: completedJobRunIds.length
          ? completedJobRunIds
          : ["00000000-0000-0000-0000-000000000000"],
      });

    return await this.measureExecutionTime(
      "[Overview][calculateTotalDiscoveredSize]",
      async () => {
        const discoveredSize = await inventoryQueryBuilder.getRawMany();
        return discoveredSize[0]?.totalSize ?? 0;
      }
    );
  }

  async calculateTotalMigratedSize(migrateRun: any): Promise<number> {
    const migrationQueryBuilder = this.inventoryRepository
      .createQueryBuilder()
      .select('SUM(subquery."maxFileSize")', "totalMigratedSize")
      .from((subQuery) => {
        return subQuery
          .select("inventory.path", "path")
          .addSelect("MAX(inventory.fileSize)", "maxFileSize")
          .from("inventory", "inventory")
          .where("inventory.job_run_id IN(:...jobRunId)", {
            jobRunId: migrateRun.map((run) => run.id),
          })
          .groupBy("inventory.path");
      }, "subquery");
    return await this.measureExecutionTime(
      "[Overview][calculateTotalMigratedSize]",
      async () => {
        const migratedSize = await migrationQueryBuilder.getRawOne();
        return migratedSize?.totalMigratedSize ?? 0;
      }
    );
  }
}
