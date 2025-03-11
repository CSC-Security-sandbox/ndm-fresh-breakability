import {
  BadRequestException,
  HttpException, HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Response } from "express";
import { createReadStream, existsSync } from "fs";
import { join } from "path";
import {
  JobConfigBulkMigrateResStatus,
  JobRunStatus,
  JobStatus,
  JobType,
  Protocol,
  TemplateType,
  WorkFlows,
} from "src/constants/enums";
import { ScheduleStatus } from "src/constants/status";
import { Options } from "src/constants/types";
import { InventoryEntity } from "src/entities/inventory.entity";
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { ProjectEntity } from "src/entities/project.entity";
import { VolumeEntity } from "src/entities/volume.entity";
import { nextDate } from "src/utils/mapper";
import { WorkflowService } from "src/workflow/workflow.service";
import { StartWorkFlowPayload } from "src/workflow/workflow.types";
import { In, Repository } from "typeorm";
import { validate as isUUID } from "uuid";
import { JobConfigEntity } from "../entities/jobconfig.entity";
import { BulkMigrateJobConfig } from "./dto/bulkMigrateJob.dto";
import { JobConfigDto } from "./dto/jobconfig.dto";
import {
  JobConfigCutoverBulk,
  JobConfigDiscoverBulk,
  JobConfigPrecheck, MigrateConfig
} from "./dto/jobdicoverybulk.dto";
import { JobListingDTO } from "./dto/joblisting.dto";
import {
  FlattenedCutoverConfig,
  JobConfigBulkCutoverRes,
  JobConfigBulkMigrateRes
} from "./jobconfig.types";
import { v4 as uuidv4 } from 'uuid';
import { run } from "node:test";

@Injectable()
export class JobConfigService {
 
  private readonly logger = new Logger(JobConfigService.name);
  constructor(
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
    @InjectRepository(InventoryEntity)
    private inventoryRepo: Repository<InventoryEntity>,
    @InjectRepository(JobRunEntity)
    private jobRunRepo: Repository<JobRunEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(VolumeEntity)
    private readonly volumeRepo: Repository<VolumeEntity>,
    private readonly workFlowService: WorkflowService,
    private readonly configService: ConfigService
  ) {}

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
              skipFile: bulkMigrate?.options?.skipFile,
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
    try {
      const allCutoverConfigs = this.flattenCutoverConfig(
        bulkCutover.cutoverConfig
      );
      const jobConfigs = await this.findJobConfigs(allCutoverConfigs);
      const jobRunStatuses = await this.jobRunRepo.find({
        where: { jobConfigId: In(jobConfigs.map((j) => j.id)), status: In([JobRunStatus.Completed, JobRunStatus.Stopped]) },
        order: { endTime: "DESC" }, 
      });

      const latestJobStatusMap = new Map<
        string,
        { status: JobRunStatus; endTime: Date }
      >();

      jobRunStatuses.forEach((jobRun) => {
        if ((!latestJobStatusMap.has(jobRun.jobConfigId))) {
          latestJobStatusMap.set(jobRun.jobConfigId, {
            status: jobRun.status,
            endTime: jobRun.endTime,
          });
        }
      });

      const completedMigrations = jobConfigs.filter(
        (config) =>
          config.jobType === JobType.MIGRATE &&
          latestJobStatusMap.has(config.id) &&
          latestJobStatusMap.get(config.id)!.status === JobRunStatus.Completed
      );

      const jobConfigMap = new Map<string, JobConfigEntity>();
      completedMigrations.forEach((config) => {
        jobConfigMap.set(config.id, config);
      });

      const newCutoverJobs: JobConfigEntity[] = [];
      const updatedCutoverJobs: JobConfigEntity[] = [];

      for (const { sourcePathId, destinationPathId } of allCutoverConfigs) {
        for (const config of jobConfigMap.values()) {
          if (
            config.sourcePathId === sourcePathId &&
            config.targetPathId === destinationPathId
          ) {
            const existingCutover = await this.jobConfigRepo.findOne({
              where: {
                jobType: JobType.CUT_OVER,
                sourcePathId,
                targetPathId: destinationPathId,
              },
            });

            if (!existingCutover) {
              newCutoverJobs.push(
                this.jobConfigRepo.create({
                  jobType: JobType.CUT_OVER,
                  sourcePathId,
                  targetPathId: destinationPathId,
                  excludeFilePatterns: config.excludeFilePatterns,
                  scheduler: ScheduleStatus.SCHEDULING,
                  futureScheduleAt: config.futureScheduleAt,
                  status: config.status,
                  preserveAccessTime: config.preserveAccessTime,
                  firstRunAt: config.firstRunAt,
                })
              );
            }else{
              if(existingCutover && existingCutover.status === JobStatus.Active){
                await this.jobConfigRepo.update(existingCutover.id,
                  {
                    jobType: JobType.CUT_OVER,
                    excludeFilePatterns: config.excludeFilePatterns,
                    scheduler: ScheduleStatus.SCHEDULING,
                    futureScheduleAt: config.futureScheduleAt,
                    status: config.status,
                    preserveAccessTime: config.preserveAccessTime,
                    firstRunAt: config.firstRunAt,
                  })
                  updatedCutoverJobs.push({ ...existingCutover, ...config });
              }
              else{
                throw new HttpException(
                  {
                    status: "failed",
                    message:
                      `Cutover is already exists for the given source path ID ${sourcePathId} and destination path ID ${destinationPathId}`,
                  },
                  HttpStatus.BAD_REQUEST
                );
              }
            }
          }
        }
      }

      const savedJobs = await this.jobConfigRepo.save(newCutoverJobs);

      return [...savedJobs, ...updatedCutoverJobs].map((job) => ({
        id: job.id,
        firstRunAt: job.firstRunAt,
        jobType: job.jobType,
        sourcePathId: job.sourcePathId,
        targetPathId: job.targetPathId,
        status: JobStatus.Active,
      }));
    } catch (error) {
      throw new HttpException(
        {
          status: "failed",
          message:
            error.message ||
            "An error occurred while creating bulk cutover job",
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  flattenCutoverConfig(config: MigrateConfig[]): FlattenedCutoverConfig[] {
    return config.flatMap(({ sourcePathId, destinationPathId }) =>
      destinationPathId.map((destId) => ({
        sourcePathId,
        destinationPathId: destId,
      }))
    );
  }

  async precheck(data: JobConfigPrecheck) {
    const traceId:string=uuidv4();
    try {
      const serverMappings = new Map();
      for (const config of data.migrateConfigs) {
        const pathIds = new Set<string>();
        const destinationPathIds = config.destinationPathId;
        pathIds.add(config.sourcePathId);
        destinationPathIds.forEach((id) => pathIds.add(id));
        const pathToWorkerMapping = await this.volumeRepo.find({
          where: { id: In([...pathIds]) },
          relations: {
            fileServer: { workers: true},
          },
        });
        const sourceVolume = pathToWorkerMapping.find(
          (p) => p.id === config.sourcePathId
        );

        const sourceFileServer = sourceVolume.fileServer;

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
          preserveAccessTime: data.preserveAccessTime,
          mountBasePath: this.configService.get<string>("app.paths.mountBasePath"),
          exportPathName: sourceVolume.volumePath,
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

          sourcePathEntry.destinations.push({
            destinationPathId,
            destinationServerCredentials: {
              id: destinationFileServer.id,
              host: destinationFileServer.host,
              userName: destinationFileServer.userName,
              password:destinationFileServer.password,
              protocol: destinationFileServer.protocol,
              serverType: destinationFileServer.serverType,
              mountBasePath: this.configService.get<string>("app.paths.mountBasePath"),
              exportPathName: destinationVolume.volumePath,
            },
          });
          sourcePathEntry.commonWorkers = [];
        }
        sourceEntry.sourcePaths.push(sourcePathEntry);
      }
      const finalResult = Array.from(serverMappings.values());

      this.logger.debug(
        `[${traceId}] Precheck payload: ${JSON.stringify(finalResult)}`
      );
      const startPrecheckWorkPayload: StartWorkFlowPayload = {
        workflowId: WorkFlows.PRECHECK + "-" + traceId,
        taskQueue: "ParentWorkflow-TaskQueue",
        args: [
          {
            traceId: traceId,
            payload: finalResult,
            options: new Options()
          },
        ],
      }
         const workflow = await this.workFlowService.startWorkflow(WorkFlows.PRECHECK, startPrecheckWorkPayload);
         return { workflowId: workflow.workflowId };
    } catch (error) {
        this.logger.error(`${traceId}] Failed to perform the precheck: ${error}`);
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
        timeElapsed: runStats.map((r) => r.timeElapsed)?.reduce((a, b) => a + b,0),
        scannedFilesCount: runStats.map((r) => BigInt(r.scannedFilesCount))?.reduce((a, b) => a + b,0n)?.toString(),
        scannedDirectoriesCount: runStats.map((r) => BigInt(r.scannedDirectoriesCount))?.reduce((a, b) => a + b,0n)?.toString(),
        totalScannedSize: runStats.map((r) => parseInt(r.totalScannedSize))?.reduce((a, b) => a + b,0),
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
  async findJobConfigs(conditions: { sourcePathId: string; destinationPathId: string }[]) {
    if (conditions.length === 0) return [];
    const queryBuilder = this.jobConfigRepo.createQueryBuilder("jobConfig");
    conditions.forEach(({ sourcePathId, destinationPathId }, index) => {
      const sourceParam = `sourcePathId_${index}`;
      const targetParam = `destinationPathId_${index}`;
      if (index === 0) {
        queryBuilder.where(
          `(jobConfig.sourcePathId = :${sourceParam} AND jobConfig.targetPathId = :${targetParam}) AND jobConfig.jobType = 'MIGRATE'`,
          { [sourceParam]: sourcePathId, [targetParam]: destinationPathId }
        );
      } else {
        queryBuilder.orWhere(
          `(jobConfig.sourcePathId = :${sourceParam} AND jobConfig.targetPathId = :${targetParam})`,
          { [sourceParam]: sourcePathId, [targetParam]: destinationPathId }
        );
      }
    });
    return await queryBuilder.getMany();
  }

  async precheckValidation(precheckData: MigrateConfig[]) {
    console.log("precheckData",JSON.stringify(precheckData));
    const results = new Map<string,any>();
    for (const config of precheckData) {
      if(!results.has(config.sourcePathId)){
        const payload = {
          sourcePathId: config.sourcePathId,
          destinations:[]
        };
        results.set(config.sourcePathId,payload);
      }
      const pathIds = new Set<string>();
      const destinationPathIds = config.destinationPathId;
      pathIds.add(config.sourcePathId);
      destinationPathIds.forEach((id) => pathIds.add(id));
      const pathToWorkerMapping = await this.volumeRepo.find({
        where: { id: In([...pathIds]) },
        relations: {
          fileServer: { workers: true},
        },
      });
      console.log("pathToWorkerMapping",JSON.stringify(pathToWorkerMapping));
      const sourceVolume = pathToWorkerMapping.find(
        (p) => p.id === config.sourcePathId
      );
      if (!sourceVolume){
        const data = results.get(config.sourcePathId);
        data.status = "failed";
        data.error = ["SOURCE_PATH_NOT_FOUND"];
        data.message = `Source path ${config.sourcePathId} not found`;
        results.set(config.sourcePathId,data);
        continue;
      }

      const sourceFileServer = sourceVolume.fileServer;
      const sourceWorkers =
        sourceFileServer?.workers?.filter((w) => w.status === "Online") || [];

      for (const destinationPathId of destinationPathIds) {
        const destinationVolume = pathToWorkerMapping.find(
          (p) => p.id === destinationPathId
        );
        if (!destinationVolume){
          const data = results.get(config.sourcePathId);
              data.status = "failed";
              const destinationPayload ={
                status: "failed",
                errors: ["DESTINATION_PATH_NOT_FOUND"],
                message: `Destination path ${destinationPathId} not found`,
                destinationPathId: destinationPathId
              };
              data.destinations.push(destinationPayload);
              results.set(config.sourcePathId,data);
              continue;
          }
        const destinationFileServer = destinationVolume.fileServer;
        const destinationWorkers =
          destinationFileServer?.workers?.filter(
            (w) => w.status === "Online"
          ) || [];

        if(sourceFileServer.protocolVersion !== destinationFileServer.protocolVersion){
          const data = results.get(config.sourcePathId);
          const destinationPayload ={
            status: "failed",
            errors: ["PROTOCOL_VERSION_MISMATCH"],
            message: `Protocol version mismatch between source path ${config.sourcePathId} and destination path ${destinationPathId}`,
            destinationPathId: destinationPathId
          };
          data.destinations.push(destinationPayload);
          results.set(config.sourcePathId,data);
          continue;
        }
        this.logger.log('protocolVersion',sourceFileServer.protocolVersion);
        this.logger.log('protocolVersion',destinationFileServer.protocolVersion);
        const commonWorkers = sourceWorkers.filter((sw) =>
          destinationWorkers.some((dw) => dw.workerId === sw.workerId)
        );
        console.log("commonWorkers",JSON.stringify(commonWorkers)); 
        if (commonWorkers.length === 0)
          {
            const data = results.get(config.sourcePathId);
            const destinationPayload ={
              status: "failed",
              errors: ["NO_COMMON_WORKERS"],
              message: `No common workers found for source path ${config.sourcePathId} and destination path ${destinationPathId}`,
              destinationPathId: destinationPathId
            };
            data.destinations.push(destinationPayload);
            results.set(config.sourcePathId,data);
          }else{
            const data = results.get(config.sourcePathId);
            data.destinations.push({
              destinationPathId: destinationPathId,
              status: "success",
              commonWorkers: commonWorkers.map((w) => ({workerId: w.workerId})),
            });
            results.set(config.sourcePathId,data);
          }
        }
        const data = results.get(config.sourcePathId);
        data.status = "success";
        results.set(config.sourcePathId,data);
      }
      this.logger.log("results",JSON.stringify(results));
      return Array.from(results.values()).flatMap((it) => it);
    }
      
}
