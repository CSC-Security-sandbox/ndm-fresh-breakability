import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Inject,
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
  SIZE_UNITS,
  TemplateType
} from "src/constants/enums";
import { ScheduleStatus } from "src/constants/status";
import { Options } from "src/constants/types";
import { InventoryEntity } from "src/entities/inventory.entity";
import { JobRunEntity } from "src/entities/jobrun.entity";
import { ProjectEntity } from "src/entities/project.entity";
import { VolumeEntity } from "src/entities/volume.entity";
import { nextDate } from "src/utils/mapper";
import { WorkflowService } from "src/workflow/workflow.service";
import { In, Raw, Repository } from "typeorm";
import { validate as isUUID, v4 as uuidv4 } from "uuid";
import { JobConfigEntity } from "../entities/jobconfig.entity";
import {
  SpeedTestConfigEntity,
  SpeedTestConfigWorkerEntity,
} from "src/entities/speed-test-job-config.entity";
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

import {
  SpeedLogEntity,
  NetworkPerformanceResultEntity,
  SpeedTestResultEntity,
  SpeedLogEntryEntity,
} from "../entities/speed-test-result.entity";

import { BulkMigrateJobConfig } from "./dto/bulkMigrateJob.dto";
import { JobConfigDto } from "./dto/jobconfig.dto";
import {
  JobConfigCutoverBulk,
  JobConfigDiscoverBulk,
  JobConfigPrecheck,
  MigrateConfig,
} from "./dto/jobdicoverybulk.dto";
import { JobConfigSpeedTest, SpeedTestResult } from "./dto/jobspeedTest.dto";

import { JobListingDTO } from "./dto/joblisting.dto";
import {
  FlattenedCutoverConfig,
  JobConfigBulkCutoverRes,
  JobConfigBulkMigrateFinalResponse,
  JobConfigBulkMigrateRes,
  PreChecks,
  PreCheckWorkflowOPayload,
  SpeedTestEntry,
  SpeedTestJobRun,
  workerWithStatus,
} from "./jobconfig.types";
import { FileServerEntity } from "src/entities/fileserver.entity";
import { WorkerEntity } from "src/entities/worker.entity";
import { IdentityMappingEntity } from "src/entities/indentity-mapping.entity";
import { IdentityConfigCrossMappingEntity } from "src/entities/indentity-mapping-cross.entity";
import { ParsedMapping } from "src/utils/indentity-mapping.type";
import { RedisService } from "src/redis/redis.service";
import { JobRunStats } from "src/jobrun/dto/jobstats";
import { OperationErrorEntity } from "src/entities/operation-error.entity";
import { SendMailService } from "src/utils/send-email";
import { formatBytes } from "@netapp-cloud-datamigrate/jobs-lib";
import { IncidentStatus, SyncEmailEntity } from "src/entities/sync-email.entity";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import { SuccessEmailType } from "src/utils/send-email.type";
import { WorkFlowFailureReason } from "src/jobrun/jobrun.types";

@Injectable()
export class JobConfigService {
  private readonly logger: LoggerService;

  constructor(
    @InjectRepository(FileServerEntity)
    private fileServerRepo: Repository<FileServerEntity>,
    @InjectRepository(SyncEmailEntity)
    private syncEmailRepo: Repository<SyncEmailEntity>,
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
    @InjectRepository(SpeedTestConfigEntity)
    private SpeedTestConfigRepo: Repository<SpeedTestConfigEntity>,
    @InjectRepository(SpeedLogEntity)
    private speedLogRepo: Repository<SpeedLogEntity>,
    @InjectRepository(NetworkPerformanceResultEntity)
    private networkPerformanceResultRepo: Repository<NetworkPerformanceResultEntity>,
    @InjectRepository(SpeedTestResultEntity)
    private speedTestResultRepo: Repository<SpeedTestResultEntity>,
    @InjectRepository(SpeedLogEntryEntity)
    private SpeedLogEntryRepo: Repository<SpeedLogEntryEntity>,
    @InjectRepository(FileServerEntity)
    private fileServerEntityRepo: Repository<FileServerEntity>,
    @InjectRepository(SpeedTestConfigWorkerEntity)
    private SpeedTestConfigWorkerRepo: Repository<SpeedTestConfigWorkerEntity>,
    @InjectRepository(WorkerEntity)
    private workeRepo: Repository<WorkerEntity>,
    @InjectRepository(InventoryEntity)
    private inventoryRepo: Repository<InventoryEntity>,
    @InjectRepository(JobRunEntity)
    private jobRunRepo: Repository<JobRunEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(VolumeEntity)
    private readonly volumeRepo: Repository<VolumeEntity>,
    private readonly workFlowService: WorkflowService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    @InjectRepository(IdentityMappingEntity)
    private identityMappingRepo: Repository<IdentityMappingEntity>,
    @InjectRepository(IdentityConfigCrossMappingEntity)
    private identityCrossMappingRepo: Repository<IdentityConfigCrossMappingEntity>,
    @InjectRepository(OperationErrorEntity)
    private operationErrorRepo: Repository<OperationErrorEntity>,
    private sendMailService: SendMailService,
    @InjectRepository(WorkerJobRunMap)
    private workerJobRunMapRepo: Repository<WorkerJobRunMap>,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(JobConfigService.name);
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
      select: { sourcePathId: true, scheduler: true, status: true, id: true },
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
        status: JobStatus.Active,
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

  // ------------ Speed Test ---------------- //
  async getAllSpeedTestJobRuns(): Promise<SpeedTestJobRun[]> {
    try {
      const jobConfigs = await this.jobConfigRepo.find({
        where: { jobType: JobType.SPEED_TEST },
        relations: [
          "jobRuns",
          "speedTestConfigs",
          "speedTestConfigs.workerEntities",
        ],
      });

      const result = jobConfigs.flatMap((jobConfig) => {
        return jobConfig.jobRuns.map((jobRun) => {
          const fileServerCount = jobConfig.speedTestConfigs.length;
          const workers = jobConfig.speedTestConfigs.flatMap(
            (config) => config.workerEntities
          );
          const workerCount = new Set(workers.map((worker) => worker.workersId))
            .size;
          const jobRunResponse: SpeedTestJobRun = {
            jobRunId: jobRun.id,
            jobConfigId: jobConfig.id,
            startTime: jobRun.startTime,
            endTime: jobRun.endTime,
            fileServerCount: fileServerCount,
            workers: workerCount,
            status: jobRun.status,
          };

          return jobRunResponse;
        });
      });

      this.logger.log("Fetched all speed test job runs successfully");
      return result;
    } catch (error) {
      this.logger.error("Failed to fetch speed test job runs", error.stack);
      throw new HttpException(
        {
          status: "failed",
          message: error.message || "Failed to fetch speed test job runs",
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async storeSpeedTestResult(speedTest: SpeedTestResult): Promise<{
    writeResultId?: number;
    readResultId?: number;
    networkResultId?: number;
  }> {
    try {
      this.logger.log("Storing speed test result", JSON.stringify(speedTest));

      // Find existing SpeedTestResultEntity by traceId, workerId, and fileServerId
      const existingResult = await this.speedTestResultRepo.findOne({
        where: {
          traceId: speedTest.traceId,
          workerId: speedTest.workerId,
          fileServerId: speedTest.fileServerID,
        },
        relations: ["writeResult", "readResult", "networkPerformanceResult"],
      });

      let writeLog, readLog, networkPerformanceResult;

      // Update or create writeResult
      writeLog = existingResult?.writeResult || new SpeedLogEntity();
      Object.assign(writeLog, {
        totalTimeTaken: speedTest.writeResult?.totalTimeTaken ?? -1,
        fileSize: speedTest.writeResult?.fileSize ?? -1,
        error: speedTest.writeResult?.error ?? "",
      });
      writeLog = await this.speedLogRepo.save(writeLog);

      // Update or create readResult
      readLog = existingResult?.readResult || new SpeedLogEntity();
      Object.assign(readLog, {
        totalTimeTaken: speedTest.readResult?.totalTimeTaken ?? -1,
        fileSize: speedTest.readResult?.fileSize ?? -1,
        error: speedTest.readResult?.error ?? "",
      });
      readLog = await this.speedLogRepo.save(readLog);

      // Update or create networkPerformanceResult
      networkPerformanceResult = {
        ...existingResult?.networkPerformanceResult, // Use existing data if available
        packetLoss: speedTest.networkPerformanceResult?.packetLoss ?? -1,
        roundTripDelayMin:
          speedTest.networkPerformanceResult?.roundTripDelay?.min ?? -1,
        roundTripDelayAvg:
          speedTest.networkPerformanceResult?.roundTripDelay?.avg ?? -1,
        roundTripDelayMax:
          speedTest.networkPerformanceResult?.roundTripDelay?.max ?? -1,
        roundTripDelayMdev:
          speedTest.networkPerformanceResult?.roundTripDelay?.mdev ?? -1,
        error: speedTest.networkPerformanceResult?.error ?? "",
      };

      // Save the updated or new networkPerformanceResult
      networkPerformanceResult = await this.networkPerformanceResultRepo.save(
        networkPerformanceResult
      );

      // Update or create SpeedTestResultEntity
      const speedTestResult = {
        ...existingResult, // Use existing data if available
        traceId: speedTest.traceId,
        workerId: speedTest.workerId,
        fileServerId: speedTest.fileServerID,
        writeResult: writeLog,
        readResult: readLog,
        networkPerformanceResult: networkPerformanceResult,
      };

      // Save the updated or new speedTestResult
      const savedResult = await this.speedTestResultRepo.save(speedTestResult);

      this.logger.log("Speed test result stored successfully");

      // Return the IDs of the saved entities
      return {
        writeResultId: writeLog?.id,
        readResultId: readLog?.id,
        networkResultId: networkPerformanceResult?.id,
      };
    } catch (error) {
      this.logger.error("Failed to store speed test result", error.stack);
      throw new HttpException(
        {
          status: "failed",
          message: error.message || "Failed to store speed test result",
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async getSpeedTestDetails(jobRunId: string): Promise<any> {
    const jobRun = await this.jobRunRepo.findOne({
      where: { id: jobRunId },
      relations: ["jobConfig"],
    });
    if (!jobRun) {
      throw new Error(`JobRun with id ${jobRunId} not found`);
    }
    const jobConfigId = jobRun.jobConfigId;

    const speedTestJobConfig = await this.SpeedTestConfigRepo.find({
      where: { jobId: jobConfigId },
      relations: ["workerEntities", "jobConfig"],
    });

    const fileServers = await this.fileServerRepo.find({
      relations: ["config", "volumes", "workingDirectory", "workers"],
    });

    const workerIds = speedTestJobConfig.flatMap((config) =>
      config.workerEntities.map((worker) => worker.workersId)
    );
    const workers = await this.workeRepo.findByIds(workerIds);

    const fileServersMap = new Map();

    speedTestJobConfig.forEach((config) => {
      const fileServer = fileServers.find(
        (server) => server.id === config.fileServer
      );

      if (fileServer) {
        if (!fileServersMap.has(fileServer.id)) {
          fileServersMap.set(fileServer.id, {
            fileServerId: fileServer.id,
            fileServerName: fileServer.config.configName,
            fileServerProtocol: fileServer.protocol,
            workers: [],
          });
        }

        config.workerEntities.forEach((workerEntity) => {
          const worker = workers.find(
            (w) => w.workerId === workerEntity.workersId
          );
          fileServersMap.get(fileServer.id).workers.push({
            workerName: worker?.workerName || "unknown",
            workerId: workerEntity.workersId,
          });
        });
      }
    });

    const fileServersArray = Array.from(fileServersMap.values());

    const response = {
      jobRunId: jobRunId,
      startTime: jobRun.startTime,
      endTime: jobRun.endTime,
      status: jobRun.status,
      totalWorkers: fileServersArray.reduce(
        (acc, server) => acc + server.workers.length,
        0
      ),
      fileServers: fileServersArray,
    };

    return response;
  }

  async getSpeedTestById(id: string): Promise<SpeedTestEntry> {
    try {
      const speedTestResults = await this.speedTestResultRepo.find({
        where: { traceId: id },
        relations: [
          "writeResult",
          "readResult",
          "networkPerformanceResult",
          "writeResult.speedLogEntries",
          "readResult.speedLogEntries",
        ],
      });

      if (speedTestResults.length === 0) {
        return this.getSpeedTestDetails(id);
      }

      const fileServersMap = new Map();

      const fileServerIds = speedTestResults.map(
        (result) => result.fileServerId
      );
      const fileServers = await this.fileServerEntityRepo.find({
        where: { id: In(fileServerIds) },
        relations: ["config"],
      });

      const workerIds = speedTestResults.map((result) => result.workerId);
      const workers = await this.workeRepo.findByIds(workerIds);

      for (const result of speedTestResults) {
        const fileServer = fileServers.find(
          (fs) => fs.id === result.fileServerId
        );

        if (!fileServersMap.has(result.fileServerId)) {
          fileServersMap.set(result.fileServerId, {
            fileServerId: fileServer.id,
            fileServerName: fileServer.config.configName,
            fileServerProtocol: fileServer.protocol,
            workers: [],
          });
        }
        const readError = result.readResult?.error;
        const writeError = result.writeResult?.error;
        const networkPerformanceError = result.networkPerformanceResult?.error;
        const writeSpeed = (result.writeResult?.speedLogEntries || []).map(
          (entry) => ({
            timeStamp: entry.timeStamp,
            speed: entry.speed,
          })
        );

        const readSpeed = (result.readResult?.speedLogEntries || []).map(
          (entry) => ({
            timeStamp: entry.timeStamp,
            speed: entry.speed,
          })
        );

        const worker = workers.find((w) => w.workerId === result.workerId);
        fileServersMap.get(result.fileServerId).workers.push({
          workerName: worker?.workerName || "unknown",
          workerId: result.workerId,
          readSpeed: readSpeed.length ? readSpeed : [],
          writeSpeed: writeSpeed.length ? writeSpeed : [],
          rtd: result.networkPerformanceResult?.roundTripDelayAvg ?? null,
          packetLoss: result.networkPerformanceResult?.packetLoss ?? null,
          readError,
          writeError,
          networkPerformanceError,
        });
      }

      const fileServersArray = Array.from(fileServersMap.values());
      const jobRunDetails = await this.jobRunRepo.findOne({ where: { id } });

      if (!jobRunDetails) {
        throw new HttpException(
          {
            status: "failed",
            message: "Job run details not found",
          },
          HttpStatus.NOT_FOUND
        );
      }

      const response: SpeedTestEntry = {
        jobRunId: id,
        startTime: jobRunDetails.startTime,
        endTime: jobRunDetails.endTime,
        status: jobRunDetails.status,
        totalWorkers: fileServersArray.reduce(
          (acc, server) => acc + server.workers.length,
          0
        ),
        fileServers: fileServersArray,
      };

      return response;
    } catch (error) {
      this.logger.error("Failed to fetch speed test results", error.stack);
      throw new HttpException(
        {
          status: "failed",
          message: error.message || "Failed to fetch speed test results",
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async createSpeedTest(
    speedTest: JobConfigSpeedTest
  ): Promise<SpeedTestConfigEntity[]> {
    try {
      const firstRunAt = speedTest?.firstRunAt ?? new Date();
      const jobConfig = this.jobConfigRepo.create({
        status: JobStatus.Active,
        jobType: JobType.SPEED_TEST,
        firstRunAt: firstRunAt,
        scheduler: ScheduleStatus.SCHEDULING,
        preserveAccessTime: false,
        sourcePathId: uuidv4(),
        createdBy: speedTest.createdBy,
      });

      await this.jobConfigRepo.save(jobConfig);
      const speedTestJobID = jobConfig.id;

      const entries: SpeedTestConfigEntity[] = [];
      const workersEntity: SpeedTestConfigWorkerEntity[] = [];
      for (const fileServerConfig of speedTest.speedTests) {
        const speedTestConfig = this.SpeedTestConfigRepo.create({
          jobId: speedTestJobID,
          fileServer: fileServerConfig.fileServer,
          protocol: fileServerConfig.protocol,
          readTest: fileServerConfig.test.readTest,
          writeTest: fileServerConfig.test.writeTest,
          packetLossTest: fileServerConfig.test.networkPerformance,
        });
        entries.push(speedTestConfig);
        const savedSpeedTestConfig =
          await this.SpeedTestConfigRepo.save(speedTestConfig);

        for (const worker of fileServerConfig.workers) {
          const workerEntity = this.SpeedTestConfigWorkerRepo.create({
            workersId: worker,
            speedTestConfigId: savedSpeedTestConfig.id,
          });
          workersEntity.push(workerEntity);
        }
      }
      await this.SpeedTestConfigWorkerRepo.save(workersEntity);
      this.logger.log("Speed Test job created successfully");
      return entries;
    } catch (error) {
      this.logger.error("Failed to create Speed Test job", error.stack);
      throw new HttpException(
        {
          status: "failed",
          message: error.message || "Failed to create Speed Test job",
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async createBulkMigrate(
    bulkMigrate: BulkMigrateJobConfig,
    projectId?: string
  ): Promise<JobConfigBulkMigrateFinalResponse> {
    const firstRunAt = bulkMigrate?.firstRunAt ?? new Date();
    const jobConfigs: Partial<JobConfigEntity>[] = [];
    let parsedMappings: ParsedMapping[] = [];
    let templateType;
    const identityMap = uuidv4();
    const jobConfigIdsToUpdate: any[] = [];
    const inactiveJobWarnings: {}[] = [];
    let savedJobConfigsmapData: JobConfigBulkMigrateRes[] = [];

    if (!bulkMigrate?.migrateConfigs) {
      return {
        jobs: [],
      };
    }
    if (typeof bulkMigrate?.sidMapping === "string") {
      templateType = TemplateType.SID;
      const sidMapping = await this.decodeBase64(bulkMigrate.sidMapping);
      parsedMappings = await this.parseBlobData(sidMapping, templateType);
    }

    if (typeof bulkMigrate?.gidMapping === "string") {
      templateType = TemplateType.GID;
      const gidMapping = await this.decodeBase64(bulkMigrate.gidMapping);
      parsedMappings = await this.parseBlobData(gidMapping, templateType);
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
          select: {
            sourcePathId: true,
            targetPathId: true,
            scheduler: true,
            id: true,
            status: true,
          },
        });

        // Check if any existing job is inactive then throw an error
        if (existingJobConfigs.some(job => job.status === JobStatus.InActive)) {
          for (const jobConfig of existingJobConfigs) {
            if (jobConfig.status == JobStatus.InActive) {
              const sourcePath = await this.volumeRepo.findOne({
                where: { id: jobConfig.sourcePathId },
                select: { volumePath: true },
              });
               console.log("sourcePath", sourcePath);
              const targetPath = await this.volumeRepo.findOne({
                where: { id: jobConfig.targetPathId },
                select: { volumePath: true },
              });
              console.log("targetPath", targetPath);
              inactiveJobWarnings.push({
                sourcePathId: jobConfig.sourcePathId,
                targetPathId: jobConfig.targetPathId,
                sourcePath: sourcePath?.volumePath,
                targetPath: targetPath?.volumePath,
                status: jobConfig.status,
                message: "Inactive job found. Please reactivate or remove the existing job.",
              })
            }
          }
          this.logger.warn(JSON.stringify(inactiveJobWarnings));
          continue; 
        }
        
        
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
              excludeOlderThan: bulkMigrate?.options?.excludeOlderThan ?? null,
              skipFile: bulkMigrate?.options?.skipFile,
              status: JobStatus.Active,
              firstRunAt: firstRunAt,
              scheduler: ScheduleStatus.SCHEDULING,
              futureScheduleAt: bulkMigrate?.futureRunSchedule,
            }
          );
          const jobConfigIds = existingJobConfigs.map(
            (jobConfig) => jobConfig.id
          );
          this.logger.log("id pushed", ...jobConfigIds);

          if (!bulkMigrate?.sidMapping && !bulkMigrate?.gidMapping) {
            for (const jobConfigId of jobConfigIds) {
              const entryExists = await this.identityCrossMappingRepo.exists({
                where: {
                  jobConfigId: jobConfigId,
                },
              });
              /* istanbul ignore next */
              if (entryExists) {
                await this.identityCrossMappingRepo.update(
                  { jobConfigId: jobConfigId },
                  { isOrphan: true }
                );
                this.logger.log(
                  `Marked is_orphan as true for job_config_id: ${jobConfigId}`
                );

                const jobRunIdsToDeleteKey = await this.jobRunRepo.find({
                  where: {
                    jobConfigId: jobConfigId,
                    status: JobRunStatus.Completed,
                  },
                  select: { id: true },
                });

                const redisClient = await this.redisService.getClient();
                for (const jobRun of jobRunIdsToDeleteKey) {
                  const redisKey = `${jobRun.id}:mapping`;

                  const redisKeyExists = await redisClient.exists(redisKey);
                  if (redisKeyExists) {
                    await redisClient.del(redisKey);
                    this.logger.log(`Deleted redis key: ${redisKey}`);
                  }
                }
              } else {
                this.logger.log(
                  `No entry found for job_config_id: ${jobConfigId}`
                );
              }
            }
          }

          if (parsedMappings.length > 0) {
            jobConfigIdsToUpdate.push(...jobConfigIds);
          }
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
              skipFile: bulkMigrate?.options?.skipFile,
            })
          );
        }
      }
    }

    if (jobConfigs.length > 0) {
      const savedJobConfigs = await this.jobConfigRepo.save(jobConfigs);
      const jobConfigIds = savedJobConfigs.map((jobConfig) => jobConfig.id);
      if (parsedMappings.length > 0 && savedJobConfigs.length > 0) {
        /* istanbul ignore next */
        await this.saveIdentityMappingsWithMap(
          jobConfigIds,
          parsedMappings,
          identityMap,
          templateType
        );
      }

      await this.sendMailService.sendMail({
        successEmailType: SuccessEmailType.JOB_CREATION,
        migrateJob: {
          savedJobConfigs: savedJobConfigs.map(jobConfig => ({
            id: jobConfig.id,
            sourcePath: jobConfig.sourcePath?.volumePath,
            targetPath: jobConfig.targetPath?.volumePath,
            jobType: jobConfig.jobType,
          })),
        }
      }, projectId);
      savedJobConfigsmapData =  savedJobConfigs.map(
        ({ id, jobType, sourcePathId, targetPathId }) => ({
          id,
          jobType,
          status: JobConfigBulkMigrateResStatus.CREATED,
          sourcePathId,
          targetPathId,
        })
      );
    } 
    if (jobConfigIdsToUpdate.length > 0) {
        await this.updateMappingsWithMap(
          jobConfigIdsToUpdate,
          parsedMappings,
          identityMap,
          templateType
        );
      }
      return {
        jobs: savedJobConfigsmapData.length > 0 ? savedJobConfigsmapData : [],
        warnings: inactiveJobWarnings.length > 0 ? inactiveJobWarnings : undefined,
      };
    
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
        where: {
          jobConfigId: In(jobConfigs.map((j) => j.id)),
          status: In([JobRunStatus.Completed, JobRunStatus.Stopped]),
        },
        order: { endTime: "DESC" },
      });

      const latestJobStatusMap = new Map<
        string,
        { status: JobRunStatus; endTime: Date }
      >();

      jobRunStatuses.forEach((jobRun) => {
        if (!latestJobStatusMap.has(jobRun.jobConfigId)) {
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
                  futureScheduleAt: null,
                  status: JobStatus.Active,
                  preserveAccessTime: config.preserveAccessTime,
                  firstRunAt: new Date(),
                  excludeOlderThan: config.excludeOlderThan,
                })
              );
            } else {
              if (
                existingCutover &&
                existingCutover.status === JobStatus.Active
              ) {
                await this.jobConfigRepo.update(existingCutover.id, {
                  jobType: JobType.CUT_OVER,
                  excludeFilePatterns: config.excludeFilePatterns,
                  scheduler: ScheduleStatus.SCHEDULING,
                  futureScheduleAt: null,
                  status:
                    config.status === JobStatus.InActive
                      ? JobStatus.Active
                      : config.status,
                  preserveAccessTime: config.preserveAccessTime,
                  firstRunAt: new Date(),
                });
                updatedCutoverJobs.push({ ...existingCutover, ...config });
              } else {
                throw new HttpException(
                  {
                    status: "failed",
                    message: `Cutover is already exists for the given source path ID ${sourcePathId} and destination path ID ${destinationPathId}`,
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
        const partialPayload = {
          jobRunId: jobRun.id,
          isReportReady: jobRun.isReportReady,
          status: jobRun.subStatus || jobRun.status,
          startTime: jobRun.startTime,
          endTime: jobRun.endTime,
          jobType: jobConfig.jobType,
          timeElapsed: jobRun.endTime
            ? jobRun.endTime.getTime() - jobRun.startTime.getTime()
            : Date.now() - jobRun.startTime.getTime(),
        };
        const jobRunStats = await this.calculateJobRunStats(jobRun.id); 
      
        if (jobRun.status === JobRunStatus.Completed) {
          this.logger.log(
            `Job Run ${jobRun.id} is completed , thus fetching the stats from the jobRunStats and job stats are  ${JSON.stringify(jobRunStats)}`
          );
          return {
            ...partialPayload,
            scannedFilesCount: BigInt(jobRunStats.fileCount || "0")?.toString(),
            scannedDirectoriesCount: BigInt(
              jobRunStats.directories || "0"
            )?.toString(),
            totalScannedSize: formatBytes(Number(jobRunStats?.totalSize || 0)),
            totalMigratedSize: formatBytes(Number(jobRunStats?.totalSize || 0)),
            errors: jobRunStats.errors || [] ,
          };
        }
        this.logger.log(
          `Job Run ${jobRun.id} is not completed , thus fetching the stats from the inventory`
        );
        const inventoryCounts = await this.calculateJobRunStats(jobRun.id);
        return {
          ...partialPayload,
          scannedFilesCount: BigInt(
            inventoryCounts.fileCount || "0"
          )?.toString(),
          scannedDirectoriesCount: BigInt(
            inventoryCounts.directories || "0"
          )?.toString(),
          totalScannedSize: formatBytes(Number(inventoryCounts?.totalSize  || 0)),
          totalMigratedSize: formatBytes(Number(jobRunStats?.totalSize || 0)),
          errors: inventoryCounts.errors,
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
        timeElapsed: runStats
          .map((r) => r.timeElapsed)
          ?.reduce((a, b) => (a ?? 0) + (b ?? 0), 0),
        scannedFilesCount: runStats
          .map((r) => BigInt(r.scannedFilesCount))
          ?.reduce((a, b) => (a ?? 0n) + (b ?? 0n), 0n)
          ?.toString(),
        scannedDirectoriesCount: runStats
          .map((r) => BigInt(r.scannedDirectoriesCount))
          ?.reduce((a, b) => (a ?? 0n) + (b ?? 0n), 0n)
          ?.toString(),
        totalScannedSize: formatBytes(
          runStats
            .map((r) => this.parseSize(r.totalScannedSize))
            .reduce((a, b) => (a ?? 0) + (b ?? 0), 0)
        ),
      },
      errors: [],
    };

    return payload;
  }

  parseSize(size: string): number {
    if (!size) return 0;
    const units = SIZE_UNITS;

    const match = size.match(/^([\d.]+)\s*(B|KiB|MiB|GiB|TiB|PiB)$/);

    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2] as keyof typeof units;

    return value * units[unit];
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
          status: true,
          fileServers: {
            id: true,
            protocol: true,
            volumes: {
              id: true,
              volumePath: true,
              reachableCount: true,
              isDisabled: true,
              isValid: true,
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

  async getNoticeBoardDetailsByProjectId(projectId: string) {
    const countErroredJobRuns = await this.jobRunRepo
      .createQueryBuilder("jr")
      .innerJoin("jr.jobConfig", "jc")
      .innerJoin("jc.sourcePath", "sp")
      .innerJoin("sp.fileServer", "fs")
      .innerJoin("fs.config", "c")
      .where("c.projectId = :projectId", { projectId })
      .andWhere("jr.status IN (:...statuses)", {
        statuses: [JobRunStatus.Failed, JobRunStatus.Errored],
      })
      .getCount();

    const countBlockedCutoverJobRuns = await this.jobRunRepo
      .createQueryBuilder("jr")
      .innerJoin("jr.jobConfig", "jc")
      .innerJoin("jc.sourcePath", "sp")
      .innerJoin("sp.fileServer", "fs")
      .innerJoin("fs.config", "c")
      .where("c.projectId = :projectId", { projectId })
      .andWhere("jr.status = :status", { status: JobRunStatus.Blocked })
      .andWhere("jc.jobType = :jobType", { jobType: JobType.CUT_OVER })
      .getCount();

    const countRecentJobConfigs = await this.jobConfigRepo
      .createQueryBuilder("jc")
      .innerJoin("jc.sourcePath", "sp")
      .innerJoin("sp.fileServer", "fs")
      .innerJoin("fs.config", "c")
      .where("c.projectId = :projectId", { projectId })
      .andWhere("jc.createdAt >= NOW() - INTERVAL '1 DAY'")
      .getCount();

    const countCompletedJobRuns = await this.jobRunRepo
      .createQueryBuilder("jr")
      .innerJoin("jr.jobConfig", "jc")
      .innerJoin("jc.sourcePath", "sp")
      .innerJoin("sp.fileServer", "fs")
      .innerJoin("fs.config", "c")
      .where("c.projectId = :projectId", { projectId })
      .andWhere("jr.status = :status", { status: JobRunStatus.Completed })
      .andWhere("jr.endTime >= NOW() - INTERVAL '1 DAY'")
      .getCount();

    const severityMessages =
      await this.syncEmailRepo
        .createQueryBuilder('syncEmail')
        .select("syncEmail.mailContent")
        .where('syncEmail.incidentStatus = :status', { status: IncidentStatus.OPEN })
        .getMany();

    const severityMessagesDescriptions = severityMessages?.flatMap(entry =>
      (entry?.mailContent?.alerts ?? []).map(alert => alert?.annotations?.description).filter(Boolean) || []
    );

    this.logger.debug(
      `countErroredJobRuns - ${JSON.stringify(countErroredJobRuns)}`
    );

    this.logger.debug(
      `countBlockedCutoverJobRuns -  ${JSON.stringify(countBlockedCutoverJobRuns)}`
    );

    this.logger.debug(
      `countRecentJobConfigs -  ${JSON.stringify(countRecentJobConfigs)}`
    );

    this.logger.debug(
      `countCompletedJobRuns -  ${JSON.stringify(countCompletedJobRuns)}`
    );

    this.logger.debug(
      `severityMessages - ${severityMessagesDescriptions?.length}`
    );

    return {
      countErroredJobRuns,
      countBlockedCutoverJobRuns,
      countRecentJobConfigs,
      countCompletedJobRuns,
      severityMessages: severityMessagesDescriptions
    };
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
        'jobconfig.updated_at AS "updated_at"',
      ])
      .addSelect("COUNT(jobRun.id)", "totalRuns")
      .addSelect("ARRAY_AGG(jobRun.id)", "jobRunIds")
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
    for(const job of allJobsDetails) {
        let nextScheduleDate: Date | null = null;

      if (job.jobconfigstatus === JobStatus.Active) {
        try {
          nextScheduleDate = nextDate(job.jobtype, job.firstrunat, job.futureschedule);
        } catch (err) {
            this.logger.error(
            `Failed to calculate nextScheduleDate for jobConfigId ${job.jobconfigid}:`,
            (err as Error).message
          );
          nextScheduleDate = null;
        }
      }

      const allErrorCounts = await Promise.all(job.jobRunIds.map(id => this.getErrorCounts(id)));
      const errorCount = allErrorCounts.flat().map(e => e.count).reduce((a, b) => Number(a) + Number(b), 0) || 0;

      payload.push({
        jobConfigId: job.jobconfigid,
        jobType: job.jobtype,
        jobStatus: job.jobconfigstatus,
        nextScheduleDate,
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
        errors: errorCount,
        totalRuns: job.totalRuns,
        configName: job.configname,
        createdAt: job.createdAt,
        updatedAt: job.updated_at,
      });
    };
    return payload;
  };

  private templates = {
    sid: "sid_template.csv",
    gid: "gid_template.csv",
    uid: "uid_template.csv",
  };

  getTemplateFilename(type: TemplateType) {
    return this.templates[type];
  }
  /* istanbul ignore next */
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

  async findJobConfigs(
    conditions: { sourcePathId: string; destinationPathId: string }[]
  ) {
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
    this.logger.log("precheckData", JSON.stringify(precheckData));
    const results = new Map<string, any>();
    for (const config of precheckData) {
      if (!results.has(config.sourcePathId)) {
        const payload = {
          sourcePathId: config.sourcePathId,
          destinations: [],
        };
        results.set(config.sourcePathId, payload);
      }
      const pathIds = new Set<string>();
      const destinationPathIds = config.destinationPathId;
      pathIds.add(config.sourcePathId);
      destinationPathIds.forEach((id) => pathIds.add(id));
      const pathToWorkerMapping = await this.volumeRepo.find({
        where: { id: In([...pathIds]) },
        relations: {
          fileServer: { workers: true },
        },
      });
      this.logger.log(
        "pathToWorkerMapping",
        JSON.stringify(pathToWorkerMapping)
      );
      const sourceVolume = pathToWorkerMapping.find(
        (p) => p.id === config.sourcePathId
      );
      if (!sourceVolume) {
        const data = results.get(config.sourcePathId);
        data.status = "failed";
        data.error = ["SOURCE_PATH_NOT_FOUND"];
        data.message = `Source path ${config.sourcePathId} not found`;
        results.set(config.sourcePathId, data);
        continue;
      }

      const sourceFileServer = sourceVolume.fileServer;
      const sourceWorkers =
        sourceFileServer?.workers?.filter((w) => w.status === "Online") || [];

      for (const destinationPathId of destinationPathIds) {
        const destinationVolume = pathToWorkerMapping.find(
          (p) => p.id === destinationPathId
        );
        if (!destinationVolume) {
          const data = results.get(config.sourcePathId);
          data.status = "failed";
          const destinationPayload = {
            status: "failed",
            errors: ["DESTINATION_PATH_NOT_FOUND"],
            message: `Destination path ${destinationPathId} not found`,
            destinationPathId: destinationPathId,
          };
          data.destinations.push(destinationPayload);
          results.set(config.sourcePathId, data);
          continue;
        }
        const destinationFileServer = destinationVolume.fileServer;
        const destinationWorkers =
          destinationFileServer?.workers?.filter(
            (w) => w.status === "Online"
          ) || [];

        if (
          sourceFileServer.protocolVersion !==
          destinationFileServer.protocolVersion
        ) {
          const data = results.get(config.sourcePathId);
          const destinationPayload = {
            status: "failed",
            errors: ["PROTOCOL_VERSION_MISMATCH"],
            message: `Protocol version mismatch between source path ${config.sourcePathId} and destination path ${destinationPathId}`,
            destinationPathId: destinationPathId,
          };
          data.destinations.push(destinationPayload);
          results.set(config.sourcePathId, data);
          continue;
        }
        this.logger.log("protocolVersion", sourceFileServer.protocolVersion);
        this.logger.log(
          "protocolVersion",
          destinationFileServer.protocolVersion
        );
        const commonWorkers = sourceWorkers.filter((sw) =>
          destinationWorkers.some((dw) => dw.workerId === sw.workerId)
        );
        this.logger.log("commonWorkers", JSON.stringify(commonWorkers));
        if (commonWorkers.length === 0) {
          const data = results.get(config.sourcePathId);
          const destinationPayload = {
            status: "failed",
            errors: ["NO_COMMON_WORKERS"],
            message: `No common workers found for source path ${config.sourcePathId} and destination path ${destinationPathId}`,
            destinationPathId: destinationPathId,
          };
          data.destinations.push(destinationPayload);
          results.set(config.sourcePathId, data);
        } else {
          const data = results.get(config.sourcePathId);
          data.destinations.push({
            destinationPathId: destinationPathId,
            status: "success",
            commonWorkers: commonWorkers.map((w) => ({ workerId: w.workerId })),
          });
          results.set(config.sourcePathId, data);
        }
      }
      const data = results.get(config.sourcePathId);
      data.status = "success";
      results.set(config.sourcePathId, data);
    }
    this.logger.log("results", JSON.stringify(results));
    return Array.from(results.values()).flatMap((it) => it);
  }

  async decodeBase64(base64String: string): Promise<string> {
    try {
      const base64Data = base64String.split(",")[1];
      if (!base64Data) {
        throw new Error("Invalid Base64 format");
      }
      return Buffer.from(base64Data, "base64").toString("utf-8");
    } catch (error) {
      this.logger.error("Error decoding Base64:", error);
      throw error;
    }
  }
  /* istanbul ignore next */
  async parseBlobData(
    blobData: string,
    templateType: TemplateType
  ): Promise<ParsedMapping[]> {
    const parsedData = blobData
      ?.trim()
      ?.split("\n")
      ?.slice(1)
      ?.map((line) => line.split(","))
      ?.map((columns) => {
        if (templateType === TemplateType.SID) {
          if (columns.length !== 2) {
            throw new Error("Invalid SID mapping data: Expected 2 columns.");
          }
          const [sourceMapping, targetMapping] = columns;
          return { sourceMapping, targetMapping };
        } else if (templateType === TemplateType.GID) {
          if (columns.length !== 4) {
            throw new Error("Invalid GID mapping data: Expected 4 columns.");
          }
          const [
            sourceMappingGid,
            targetMappingGid,
            sourceMappingUid,
            targetMappingUid,
          ] = columns;
          return {
            sourceMappingGid,
            targetMappingGid,
            sourceMappingUid,
            targetMappingUid,
          };
        }
      });
    return parsedData;
  }

  async saveIdentityMappingsWithMap(
    jobConfigIds: string[],
    parsedData: ParsedMapping[],
    identityMap: string,
    templateType: TemplateType
  ) {
    this.logger.log("reached for saving mappings");

    for (const mapping of parsedData) {
      if (templateType === TemplateType.SID) {
        const { sourceMapping, targetMapping } = mapping as {
          sourceMapping: string;
          targetMapping: string;
        };
        const identityMappingEntity = this.identityMappingRepo.create({
          identityType: templateType,
          identityMap: identityMap,
          sourceMapping: sourceMapping,
          targetMapping: targetMapping,
        });
        const savedIdentityMapping = await this.identityMappingRepo.save(
          identityMappingEntity
        );
        this.logger.log(
          `Identity mapping inserted with ID: ${savedIdentityMapping.id}`
        );
      } else if (templateType === TemplateType.GID) {
        const {
          sourceMappingGid,
          targetMappingGid,
          sourceMappingUid,
          targetMappingUid,
        } = mapping as {
          sourceMappingGid: string;
          targetMappingGid: string;
          sourceMappingUid: string;
          targetMappingUid: string;
        };

        const gidMappingEntity = this.identityMappingRepo.create({
          identityType: TemplateType.GID,
          identityMap: identityMap,
          sourceMapping: sourceMappingGid,
          targetMapping: targetMappingGid,
        });
        const savedGidMapping =
          await this.identityMappingRepo.save(gidMappingEntity);
        this.logger.log(`GID mapping inserted with ID: ${savedGidMapping.id}`);

        const uidMappingEntity = this.identityMappingRepo.create({
          identityType: TemplateType.UID,
          identityMap: identityMap,
          sourceMapping: sourceMappingUid,
          targetMapping: targetMappingUid,
        });
        const savedUidMapping =
          await this.identityMappingRepo.save(uidMappingEntity);
        this.logger.log(`UID mapping inserted with ID: ${savedUidMapping.id}`);
      }
    }

    for (const jobConfigId of jobConfigIds) {
      const identityConfigCrossMappingEntity =
        await this.identityCrossMappingRepo.create({
          identityMappingId: identityMap,
          jobConfigId: jobConfigId,
        });

      await this.identityCrossMappingRepo.save(
        identityConfigCrossMappingEntity
      );
    }
  }

  async updateMappingsWithMap(
    jobConfigIds: any[],
    parsedData: ParsedMapping[],
    identityMap: string,
    templateType: TemplateType
  ) {
    this.logger.log("reached for updating mappings");
    this.logger.log("jobCIDs", jobConfigIds);
    this.logger.log("parsedData", parsedData);

    for (const mapping of parsedData) {
      if (templateType === TemplateType.SID) {
        const { sourceMapping, targetMapping } = mapping as {
          sourceMapping: string;
          targetMapping: string;
        };
        const identityMappingEntity = this.identityMappingRepo.create({
          identityType: templateType,
          identityMap: identityMap,
          sourceMapping: sourceMapping,
          targetMapping: targetMapping,
        });
        const savedIdentityMapping = await this.identityMappingRepo.save(
          identityMappingEntity
        );
        this.logger.log(
          `Identity mapping inserted with ID: ${savedIdentityMapping.id}`
        );
      } else if (templateType === TemplateType.GID) {
        const {
          sourceMappingGid,
          targetMappingGid,
          sourceMappingUid,
          targetMappingUid,
        } = mapping as {
          sourceMappingGid: string;
          targetMappingGid: string;
          sourceMappingUid: string;
          targetMappingUid: string;
        };

        const gidMappingEntity = this.identityMappingRepo.create({
          identityType: TemplateType.GID,
          identityMap: identityMap,
          sourceMapping: sourceMappingGid,
          targetMapping: targetMappingGid,
        });
        const savedGidMapping =
          await this.identityMappingRepo.save(gidMappingEntity);
        this.logger.log(`GID mapping inserted with ID: ${savedGidMapping.id}`);

        const uidMappingEntity = this.identityMappingRepo.create({
          identityType: TemplateType.UID,
          identityMap: identityMap,
          sourceMapping: sourceMappingUid,
          targetMapping: targetMappingUid,
        });
        const savedUidMapping =
          await this.identityMappingRepo.save(uidMappingEntity);
        this.logger.log(`UID mapping inserted with ID: ${savedUidMapping.id}`);
      }
    }

    for (const jobConfigId of jobConfigIds) {
      const existingCrossMapping = await this.identityCrossMappingRepo.findOne({
        where: {
          jobConfigId: jobConfigId,
          isOrphan: false,
        },
      });

      if (existingCrossMapping) {
        existingCrossMapping.identityMappingId = identityMap;
        await this.identityCrossMappingRepo.save(existingCrossMapping);
        this.logger.log(
          `Identity config cross mapping updated for JobConfig ID: ${jobConfigId}`
        );
      } else {
        const identityConfigCrossMappingEntity =
          await this.identityCrossMappingRepo.create({
            identityMappingId: identityMap,
            jobConfigId: jobConfigId,
          });

        await this.identityCrossMappingRepo.save(
          identityConfigCrossMappingEntity
        );
      }
    }
  }


  async calculateJobRunStats(jobRunId: string): Promise<JobRunStats> {
    const jobRun = await this.jobRunRepo.findOne({
      where: { id: jobRunId },
      relations: ["jobConfig"],
    });
    if (!jobRun)
      throw new NotFoundException(`Job Run with id ${jobRunId} not found`);
    const inventorySummary = await this.inventoryRepo
      .createQueryBuilder("inventory")
      .select([
        "COUNT(CASE WHEN inventory.isDirectory = false THEN 1 END) AS fileCount",
        "COUNT(CASE WHEN inventory.isDirectory = true THEN 1 END) AS directoryCount",
        "COALESCE(SUM(CASE WHEN inventory.isDirectory = false THEN inventory.fileSize ELSE 0 END), 0) AS totalFileSize",
      ])
      .where("inventory.jobRunId = :jobRunId", { jobRunId: jobRunId })
      .getRawOne();
    const jobRunStatus = {
      fileCount: inventorySummary.filecount || "0",
      directories: inventorySummary.directorycount || "0",
      totalSize: inventorySummary.totalfilesize || "0",
    };

    this.logger.log("inventorySummary", JSON.stringify(inventorySummary));
    const response = {
      ...jobRunStatus,
      errors: await this.getErrorCounts(jobRunId),
    };
    this.logger.log("formatted response", JSON.stringify(response));
    return response;
  }

  async getErrorCounts(jobRunId: string) {
    const countQuery = this.operationErrorRepo
      .createQueryBuilder("oe")
      .innerJoin("oe.operation", "o")
      .where("o.jobRunId = :jobRunId", { jobRunId })
      .select(["oe.errorType AS errorType", "COUNT(*) AS count"])
      .groupBy("oe.errorType");
    let errorTypeCounts;
    try {
      errorTypeCounts = await countQuery.getRawMany();
    } catch (error) {
      this.logger.error(
        "Error occurred while fetching error type counts:",
        error
      );
      errorTypeCounts = [];
    }

    const setupFailedErrors = await this.workerJobRunMapRepo
      .createQueryBuilder("job")
      .where("job.jobRunId = :jobRunId", { jobRunId })
      .andWhere("job.workerResponse IS NOT NULL")
      .andWhere("job.workerResponse ->> 'code' = ANY(:errorCodes)", {
        errorCodes: Object.values(WorkFlowFailureReason),
      })
      .andWhere("job.workerResponse ->> 'status' = 'FAILED'")
      .getMany();

    if (setupFailedErrors?.length > 0) {
      const fatalError = errorTypeCounts.find((error) => error.errorType === "FATAL_ERROR");
      if (fatalError) {
        fatalError.count += setupFailedErrors.length;
      } else {
        errorTypeCounts.push({
          errorType: "FATAL_ERROR",
          count: setupFailedErrors.length,
        });
      }
    }
    return errorTypeCounts;
  }
}
