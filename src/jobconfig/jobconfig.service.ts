import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In } from "typeorm";
import { Response } from "express";
import { createReadStream, existsSync, stat } from "fs";
import { join } from "path";
import { validate as isUUID, v4 as uuidv4 } from "uuid";
import { FindManyOptions, Repository } from "typeorm";
import { JobConfigEntity } from "../entities/jobconfig.entity";
import { JobConfigDto } from "./dto/jobconfig.dto";
import { JobListingDTO } from "./dto/joblisting.dto";
import {
  JobConfigCutoverBulk,
  JobConfigDiscoverBulk,
  JobConfigMigrateBulk,
  JobConfigPrecheck,
} from "./dto/jobdicoverybulk.dto";
import {
  JobConfigBulkMigrateResStatus,
  JobRunStatus,
  JobStatus,
  JobType,
  Protocol,
  TemplateType,
  WorkFlows,
} from "src/constants/enums";
import { InventoryEntity } from "src/entities/inventory.entity";
import {
  InActivateJobConfigPayload,
  JobConfigBulkCutoverRes,
  JobConfigBulkMigrateRes,
  JobConfigPrecheckRes,
} from "./jobconfig.types";
import { OnEvent } from "@nestjs/event-emitter";
import { EmitterEvents } from "src/constants/events";
import { ScheduleStatus } from "src/constants/status";
import { nextDate } from "src/utils/mapper";
import { BulkMigrateJobConfig } from "./dto/bulkMigrateJob.dto";
import { ProjectEntity } from "src/entities/project.entity";
import { VolumeEntity } from "src/entities/volume.entity";
import { FileServerEntity } from "src/entities/fileserver.entity";
import { StartWorkFlowPayload } from "src/workflow/workflow.types";
import { str } from "@temporalio/common";
import { WorkflowService } from "src/workflow/workflow.service";
import { ConfigService } from "@nestjs/config";
import { Options } from "src/constants/types";

@Injectable()
export class JobConfigService {
  private readonly logger = new Logger(JobConfigService.name);
  constructor(
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
    @InjectRepository(InventoryEntity)
    private inventoryRepo: Repository<InventoryEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(VolumeEntity)
    private readonly volumeRepo: Repository<VolumeEntity>,
    private readonly workFlowService: WorkflowService,
    private readonly configService: ConfigService
  ) {}

  // ------------ Events ---------------- //
  @OnEvent(EmitterEvents.IN_ACTIVE_JOB_CONFIG)
  async inActivateJobConfig(payload: InActivateJobConfigPayload) {
    await this.jobConfigRepo.update(
      { id: payload.jobConfigId },
      { status: JobStatus.InActive }
    );
  }

  // ------------ Bulk Discovery ---------------- //
  async createBulkDiscovery(
    bulkDiscovery: JobConfigDiscoverBulk
  ): Promise<JobConfigEntity[]> {
    const firstRunAt = bulkDiscovery?.firstRunAt ?? new Date();
    const existingList = await this.jobConfigRepo.find({
      where: {
        jobType: JobType.DISCOVER,
        sourcePath: In(bulkDiscovery.sourcePathIds ?? []),
      },
      select: { sourcePathId: true, scheduler: true },
    });

    await this.jobConfigRepo.update(
      {
        jobType: JobType.DISCOVER,
        sourcePathId: In(bulkDiscovery?.sourcePathIds),
        scheduler: In([
          ScheduleStatus.READY_TO_BE_SCHEDULED,
          ScheduleStatus.SCHEDULING,
        ]),
      },
      {
        excludeFilePatterns: bulkDiscovery.excludeFilePatterns,
        preserveAccessTime: bulkDiscovery.preserveAccessTime,
        excludeOlderThan: bulkDiscovery.excludeOlderThan,
        firstRunAt: firstRunAt,
        scheduler: ScheduleStatus.SCHEDULING,
      }
    );

    const existingSet = new Set(existingList.map((it) => it.sourcePathId));
    const entries: JobConfigEntity[] = [];

    bulkDiscovery.sourcePathIds.forEach((path: string) => {
      if (!existingSet.has(path))
        entries.push(
          this.jobConfigRepo.create({
            status: JobStatus.Active,
            excludeFilePatterns: bulkDiscovery.excludeFilePatterns,
            jobType: JobType.DISCOVER,
            preserveAccessTime: bulkDiscovery.preserveAccessTime,
            sourcePathId: path,
            excludeOlderThan: bulkDiscovery.excludeOlderThan,
            firstRunAt: firstRunAt,
            scheduler: ScheduleStatus.SCHEDULING,
            createdBy: bulkDiscovery.createdBy,
          })
        );
    });

    return await this.jobConfigRepo.save(entries);
  }

  async createBulkMigrate(
    bulkMigrate: BulkMigrateJobConfig
  ): Promise<JobConfigBulkMigrateRes[]> {
    const firstRunAt = bulkMigrate?.firstRunAt ?? new Date();
    const jobConfigs: Partial<JobConfigEntity>[] = [];

    if (!bulkMigrate?.migrateConfigs) {
      return [];
    }

    for (const config of bulkMigrate.migrateConfigs) {
      if (!config?.destinationPathId) {
        continue;
      }

      for (const destinationPath of config.destinationPathId) {
        const existingJobConfigs = await this.jobConfigRepo.find({
          where: {
            jobType: JobType.MIGRATE,
            sourcePathId: config?.sourcePathId,
            targetPathId: destinationPath,
          },
          select: { sourcePathId: true, targetPathId: true, scheduler: true },
        });

        const existingSet = new Set(
          existingJobConfigs.map(
            (jobConfig) =>
              `${jobConfig?.sourcePathId}-${jobConfig?.targetPathId}`
          )
        );

        if (existingSet.has(`${config?.sourcePathId}-${destinationPath}`)) {
          await this.jobConfigRepo.update(
            {
              jobType: JobType.MIGRATE,
              sourcePathId: config?.sourcePathId,
              targetPathId: destinationPath,
              scheduler: In([
                ScheduleStatus.READY_TO_BE_SCHEDULED,
                ScheduleStatus.SCHEDULING,
              ]),
            },
            {
              excludeFilePatterns: bulkMigrate?.options?.excludeFilePatterns,
              preserveAccessTime: bulkMigrate?.options?.preserveAccessTime,
              excludeOlderThan: bulkMigrate?.options?.excludeOlderThan,
              firstRunAt: firstRunAt,
              scheduler: ScheduleStatus.SCHEDULING,
            }
          );
        } else {
          jobConfigs.push(
            this.jobConfigRepo.create({
              status: JobStatus.Active,
              excludeFilePatterns: bulkMigrate?.options?.excludeFilePatterns,
              jobType: JobType.MIGRATE,
              preserveAccessTime: bulkMigrate?.options?.preserveAccessTime,
              sourcePathId: config?.sourcePathId,
              targetPathId: destinationPath,
              excludeOlderThan: bulkMigrate?.options?.excludeOlderThan,
              firstRunAt: firstRunAt,
              scheduler: ScheduleStatus.SCHEDULING,
              futureScheduleAt: bulkMigrate?.futureRunSchedule,
            })
          );
        }
      }
    }

    if (jobConfigs.length > 0) {
      return (await this.jobConfigRepo.save(jobConfigs)).map(
        ({ id, jobType, sourcePathId, targetPathId }) => ({
          id,
          jobType,
          status: JobConfigBulkMigrateResStatus.CREATED,
          sourcePathId,
          targetPathId,
        })
      );
    } else {
      return [];
    }
  }

  async createBulkCutover(
    bulkCutover: JobConfigCutoverBulk
  ): Promise<JobConfigBulkCutoverRes[]> {
    return [
      {
        id: "b84f2e0a-c013-4c19-9fe7-4ff8c7d65d39",
        jobType: JobType.CutOver,
        status: JobStatus.Active,
        firstRunAt: new Date("2025-01-25T12:00:00+00:00"),
        sourcePathId: "e98cb64f-57d5-40b7-b7fe-1c4fda581b6d",
        targetPathId: ["fc3d1b79-7288-4d8d-8bc3-ec0b7753dbfc"],
      },
    ];
  }

  async precheck(data: JobConfigPrecheck) {
      const pathIds = new Set<string>();
    try {
      const serverMappings = new Map();
      for (const config of data.migrateConfigs) {
        const destinationPathIds = config.destinationPathId;
        pathIds.add(config.sourcePathId);
        destinationPathIds.forEach((id) => pathIds.add(id));
        const pathToWorkerMapping = await this.volumeRepo.find({
          where: { id: In([...pathIds]) },
          relations: {
            fileServer: { workers: true, workingDirectory: true },
          },
        });
        const sourceVolume = pathToWorkerMapping.find(
          (p) => p.id === config.sourcePathId
        );
        if (!sourceVolume)
          return {
            status: "error",
            erros: ["SOURCE_PATH_NOT_FOUND"],
            message: `Source path ${config.sourcePathId} not found`,
          };

        const sourceFileServer = sourceVolume.fileServer;
        const sourceWorkers =
          sourceFileServer?.workers?.filter((w) => w.status === "Online") || [];

        let sourceEntry = serverMappings.get(sourceFileServer.id);
        if (!sourceEntry) {
          sourceEntry = {
            sourceServerCredentials: {
              id: sourceFileServer.id,
              host: sourceFileServer.host,
              userName: sourceFileServer.userName,
              password: sourceFileServer.password,
              protocol: sourceFileServer.protocol,
              serverType: sourceFileServer.serverType,
            },
            sourcePaths: [],
          };
          serverMappings.set(sourceFileServer.id, sourceEntry);
        }

        const sourcePathEntry = {
          pathId: config.sourcePathId,
          preserveAccessTime: config.preserveAccessTime,
          workingDirectory : sourceFileServer.workingDirectory?.workingDirectory,
          workingDirectoryPathId: sourceFileServer.workingDirectory?.pathId,
          mountBasePath: this.configService.get<string>("app.paths.mountBasePath"),
          exportPathName: sourceVolume.volumePath,
          workingDirectoryExportPathName: sourceFileServer.workingDirectory?.pathName,
          destinations: [],
          commonWorkers: [],
        };
        for (const destinationPathId of destinationPathIds) {
          const destinationVolume = pathToWorkerMapping.find(
            (p) => p.id === destinationPathId
          );
          if (!destinationVolume)
            return {
              status: "error",
              erros: ["DESTINATION_PATH_NOT_FOUND"],
              message: `Destination path ${destinationPathId} not found`,
            };

          const destinationFileServer = destinationVolume.fileServer;
          const destinationWorkers =
            destinationFileServer?.workers?.filter(
              (w) => w.status === "Online"
            ) || [];

          const commonWorkers = sourceWorkers.filter((sw) =>
            destinationWorkers.some((dw) => dw.workerId === sw.workerId)
          );
          if (commonWorkers.length === 0)
            return {
              status: "error",
              erros: ["NO_COMMON_WORKERS"],
              message: `No common workers found for source path ${config.sourcePathId} and destination path ${destinationPathId}`,
            };

          sourcePathEntry.destinations.push({
            destinationPathId,
            destinationServerCredentials: {
              id: destinationFileServer.id,
              host: destinationFileServer.host,
              userName: destinationFileServer.userName,
              protocol: destinationFileServer.protocol,
              serverType: destinationFileServer.serverType,
              workingDirectory: destinationFileServer.workingDirectory?.workingDirectory,
              workingDirectoryPathId: destinationFileServer.workingDirectory?.pathId,
              mountBasePath: this.configService.get<string>("app.paths.mountBasePath"),
              exportPathName: destinationVolume.volumePath,
              workingDirectoryExportPathName: destinationFileServer.workingDirectory?.pathName, 
            },
          });
          sourcePathEntry.commonWorkers = commonWorkers.map((w) => ({
            workerId: w.workerId,
          }))
        }
        sourceEntry.sourcePaths.push(sourcePathEntry);
      }
      const finalResult = Array.from(serverMappings.values());
      this.logger.debug(`[${data.trackId}] Precheck payload: ${JSON.stringify(finalResult)}`);
      const startPrecheckWorkPayload: StartWorkFlowPayload = {
        workflowId: WorkFlows.PRECHECK + "-" + data.trackId,
        taskQueue: "ParentWorkflow-TaskQueue",
        args: [
          {
            traceId: data.trackId,
            payload: finalResult,
            options: new Options()
          },
        ],
      }
         const workflow = await this.workFlowService.startWorkflow(WorkFlows.PRECHECK, startPrecheckWorkPayload);
         return { workflowId: workflow.workflowId };
    } catch (error) {
        this.logger.error(`${data.trackId}] Failed to perform the precheck: ${error}`);
        return {
          status: "error",
          erros: ["PRECHECK_FAILED"],
          message: `Failed to perform the precheck: ${error}`,
        };
    }
  }

  // ------------  update ---------------- //
  async updateJobConfig(
    id: string,
    data: Partial<JobConfigDto>
  ): Promise<JobConfigEntity> {
    const job = await this.jobConfigRepo.findOne({ where: { id } });
    if (!job) {
      throw new Error(`Job with id ${id} not found`);
    }
    Object.assign(job, data);
    return this.jobConfigRepo.save(job);
  }

  // ------------ Bulk delete ---------------- //
  async deleteJobConfig(id: string): Promise<{ message: string }> {
    const job = await this.jobConfigRepo.findOne({ where: { id } });
    if (!job) {
      throw new Error(`Job with id ${id} not found`);
    }
    await this.jobConfigRepo.remove(job);
    return { message: `Job with id ${id} has been deleted` };
  }

  // ------------ Job Config By Id ---------------- //
  async getJobConfigById(id: string): Promise<any> {
    const jobConfig = await this.jobConfigRepo.findOne({
      where: { id },
      relations: [
        "jobRuns",
        "sourcePath",
        "sourcePath.fileServer",
        "sourcePath.fileServer.config",
        "targetPath",
        "targetPath.fileServer",
        "targetPath.fileServer.config",
      ],
    });

    if (!jobConfig) throw new Error(`Job with id ${id} not found`);

    const runStats = await Promise.all(
      jobConfig.jobRuns.map(async (jobRun) => {
        const inventoryCounts = await this.inventoryRepo
          .createQueryBuilder("inventory")
          .select([
            "SUM(CASE WHEN inventory.isDirectory = false THEN 1 ELSE 0 END) AS fileCount",
            "SUM(CASE WHEN inventory.isDirectory = true THEN 1 ELSE 0 END) AS directoryCount",
            "SUM(inventory.fileSize) AS totalSize",
          ])
          .where("inventory.jobRunId = :jobRunId", { jobRunId: jobRun.id })
          .getRawOne();
        return {
          jobRunId: jobRun.id,
          isReportReady: jobRun.isReportReady,
          status: jobRun.status,
          startTime: jobRun.startTime,
          endTime: jobRun.endTime,
          jobType: jobConfig.jobType,
          timeElapsed: jobRun.endTime
            ? jobRun.endTime.getTime() - jobRun.startTime.getTime()
            : Date.now() - jobRun.startTime.getTime(),
          scannedFilesCount: BigInt(
            inventoryCounts.filecount || "0"
          )?.toString(),
          scannedDirectoriesCount: BigInt(
            inventoryCounts.directorycount || "0"
          )?.toString(),
          totalScannedSize: this.covertBytes(
            Number(inventoryCounts.totalsize || "0")
          ),
          errors: [],
        };
      })
    );

    const payload = {
      jobConfigId: id,
      jobType: jobConfig.jobType,
      sourceServer: {
        serverName:
          jobConfig.sourcePath?.fileServer?.config?.configName || null,
        path: jobConfig.sourcePath?.volumePath || null,
        protocol: jobConfig.sourcePath?.fileServer?.protocol || null,
      },

      destinationServer: jobConfig.targetPath
        ? {
            serverName:
              jobConfig.targetPath?.fileServer?.config?.configName || null,
            path: jobConfig.targetPath?.volumePath || null,
            protocol: jobConfig.targetPath?.fileServer?.protocol || null,
          }
        : {},

      status: jobConfig.status,
      createdAt: jobConfig.createdAt,
      jobRuns: runStats,
      aggregateData: {
        timeElapsed: 0,
        scannedFilesCount: 0,
        scannedDirectoriesCount: 0,
        totalScannedSize: "0 B",
      },
      errors: [],
    };

    return payload;
  }

  async getCutoverDetailsByFileServerId(fileServerId: string) {
    return [
      {
        protocol: Protocol.NFS,
        sourcePath: {
          id: "b84f2e0a-c013-4c19-9fe7-4ff8c7d65d39",
          sourcePathName: "/source/test",
        },
        destinationFileServer: {
          id: "b84f2e0a-c013-4c19-9fe7-4ff8c7d65d39",
          destinationFileServerName: "fileServer1",
        },
        destinationPath: {
          id: "b84f2e0a-c013-4c19-9fe7-4ff8c7d65d39",
          destinationPathName: "/destination/test",
        },
        jobConfig: [
          {
            id: "b84f2e0a-c013-4c19-9fe7-4ff8c7d65d39",
            jobType: JobType.MIGRATE,
            jobRunDetails: {
              id: "b84f2e0a-c013-4c19-9fe7-4ff8c7d65d39",
              status: JobRunStatus.Completed,
            },
          },
        ],
      },
    ];
  }

  async getConfigsByProjectId(projectId: string) {
    if (!isUUID(projectId)) throw new BadRequestException("Invalid projectId");

    const project = await this.projectRepo.findOne({
      select: {
        id: true,
        projectName: true,
        configs: {
          id: true,
          configName: true,
          fileServers: {
            id: true,
            protocol: true,
            volumes: {
              id: true,
              volumePath: true,
            },
          },
        },
      },
      where: { id: projectId },
      relations: {
        configs: {
          fileServers: {
            volumes: true,
          },
        },
      },
    });

    if (!project)
      throw new NotFoundException(`Project for id ${projectId} not found.`);
    return project;
  }

  // ------------ Job Config All ---------------- //
  async getAllJobConfig(projectId: string): Promise<JobListingDTO[]> {
    const allJobsDetails = await this.jobConfigRepo
      .createQueryBuilder("jobconfig")
      .leftJoin("jobconfig.jobRuns", "jobRun")
      .leftJoin("jobconfig.sourcePath", "sourceVolumes")
      .leftJoin("jobconfig.targetPath", "targetVolumes")
      .leftJoin("sourceVolumes.fileServer", "sourceFileServer")
      .leftJoin("targetVolumes.fileServer", "targetFileServer")
      .leftJoin("sourceFileServer.config", "sourceConfig")
      .leftJoin("targetFileServer.config", "targetConfig")
      .select([
        "jobconfig.id AS jobConfigId",
        "jobconfig.jobType AS jobType",
        "jobconfig.status AS jobConfigStatus",
        "jobconfig.firstRunAt AS firstRunAt",
        "jobconfig.sourcePathId AS sourcePath",
        "jobconfig.targetPathId AS targetPath",
        "jobconfig.futureScheduleAt AS futureSchedule",
        "sourceVolumes.volumePath AS sourcePath",
        "targetVolumes.volumePath AS targetPath",
        "sourceFileServer.protocol AS sourceProtocol",
        "targetFileServer.protocol AS targetProtocol",
        "sourceConfig.configName AS sourceServerName",
        "targetConfig.configName AS targetServerName",
        'jobconfig.createdAt AS "createdAt"',
      ])
      .addSelect("COUNT(jobRun.id)", "totalRuns")
      .where("sourceConfig.projectId = :projectId", { projectId })
      .orWhere("targetConfig.projectId = :projectId", { projectId })
      .groupBy("jobconfig.id")
      .addGroupBy("jobconfig.jobType")
      .addGroupBy("jobconfig.status")
      .addGroupBy("jobconfig.sourcePathId")
      .addGroupBy("jobconfig.targetPathId")
      .addGroupBy("jobconfig.futureScheduleAt")
      .addGroupBy("sourceVolumes.volumePath")
      .addGroupBy("targetVolumes.volumePath")
      .addGroupBy("sourceFileServer.protocol")
      .addGroupBy("targetFileServer.protocol")
      .addGroupBy("sourceConfig.configName")
      .addGroupBy("targetConfig.configName")
      .addGroupBy("jobconfig.createdAt")
      .getRawMany();

    const payload: JobListingDTO[] = [];
    allJobsDetails.forEach((job) => {
      payload.push({
        jobConfigId: job.jobconfigid,
        jobType: job.jobtype,
        jobStatus: job.jobconfigstatus,
        nextScheduleDate: nextDate(
          job.jobtype,
          job.firstrunat,
          job.futureschedule
        ),
        sourceServer: {
          serverName: job.sourceservername,
          path: job.sourcepath,
          protocol: job.sourceprotocol,
        },
        destinationServer: job.targetpath
          ? {
              serverName: job.targetservername,
              path: job.targetpath,
              protocol: job.targetprotocol,
            }
          : {},
        errors: 0,
        totalRuns: job.totalRuns,
        configName: job.configname,
        createdAt: job.createdAt,
      });
    });
    return payload;
  }

  private templates = {
    sid: "sid_template.csv",
    gid: "gid_template.csv",
    uid: "uid_template.csv",
  };

  getTemplateFilename(type: TemplateType) {
    return this.templates[type];
  }

  sendCsvFile(filename: string, res: Response) {
    const filePath = join(process.cwd(), process.env.TEMPLATES_PATH, filename);
    this.logger.log(`filePath ${filePath}`);

    if (!existsSync(filePath)) {
      throw new NotFoundException(
        `CSV file ${filename} not found at ${filePath}`
      );
    }

    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.setHeader("Content-Type", "text/csv");

    const fileStream = createReadStream(filePath);

    fileStream.pipe(res);
  }

  covertBytes(bytes: number): string {
    const bytesInKB = 1024;
    const bytesInMB = bytesInKB * 1024;
    const bytesInGB = bytesInMB * 1024;
    const bytesInTB = bytesInGB * 1024;
    const bytesInPB = bytesInTB * 1024;

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
  hasCommonWorkers(data: any): boolean {
    const workerIds = new Set<string>();
    for (const volume of data) {
      if (volume.fileServer.workers.length === 0) {
        return false;
      }
      for (const worker of volume.fileServer.workers) {
        if (workerIds.has(worker.id)) {
          return true;
        }
        if (worker.status === "Online") {
          workerIds.add(worker.id);
        }
      }
    }
    return false;
  }
  async getPrecheckPayload(data: any): Promise<any> {
    const mountBasePath = this.configService.get<string>(
      "app.paths.mountBasePath"
    );
    const payload = [];
    for (const [sourceDetails, destinationPathIds] of data) {
      const ids = [sourceDetails?.pathId, ...destinationPathIds];
      const pathDetails = await this.volumeRepo.find({
        where: { id: In(ids) },
        relations: {
          fileServer: { workingDirectory: true },
        },
      });
      const sourceFileServer = pathDetails.filter(
        (p) => p.id === sourceDetails.pathId
      )[0].fileServer;
      const exportPathName = pathDetails.filter(
        (p) => p.id === sourceDetails.pathId
      )[0].volumePath;
      const workingDirectoryExportPathName =
        sourceFileServer.workingDirectory.pathName;
      payload.push({
        workerIds: ["6cf21220-5627-4614-a947-778915dba29f"],
        sourceCredentials: {
          hostName: sourceFileServer.host,
          pathId: sourceDetails.pathId,
          protocol: sourceFileServer.protocol,
          exportPathName: exportPathName,
          user: sourceFileServer.userName,
          password: sourceFileServer.password,
          workingDirectory: sourceFileServer.workingDirectory?.workingDirectory,
          workingDirectoryPathId: sourceFileServer.workingDirectory?.pathId,
          mountBasePath: mountBasePath,
          workingDirectoryExportPathName: workingDirectoryExportPathName,
        },
        destinationCredentials: destinationPathIds.map((id) => {
          const destinationFileServer = pathDetails.filter(
            (p) => p.id === id
          )[0].fileServer;
          const destinationExportPathName = pathDetails.filter(
            (p) => p.id === id
          )[0].volumePath;
          const workingDirectoryExportPathName =
            destinationFileServer.workingDirectory.pathName;
          return {
            hostName: destinationFileServer.host,
            pathId: id,
            exportPathName: destinationExportPathName,
            user: destinationFileServer.userName,
            protocol: destinationFileServer.protocol,
            password: destinationFileServer.password,
            workingDirectory:
              destinationFileServer.workingDirectory?.workingDirectory,
            workingDirectoryPathId:
              destinationFileServer.workingDirectory?.pathId,
            mountBasePath: mountBasePath,
            workingDirectoryExportPathName: workingDirectoryExportPathName,
          };
        }),
        preserveAccessTime: sourceDetails.preserveAccessTime,
      });
    }
    return payload;
  }
}
