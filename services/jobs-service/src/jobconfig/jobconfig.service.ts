import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Inject,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { Response } from "express";
import { createReadStream, existsSync } from "fs";
import { join } from "path";
import {
  JobConfigBulkMigrateResStatus,
  JobRunStatus,
  JobStatus,
  JobType,
  Protocol,
  SIZE_UNITS,
  TemplateType,
  JobConfigurationEnum,
  USER_VISIBLE_ERROR_TYPES,
} from "src/constants/enums";
import { ScheduleStatus } from "src/constants/status";
import { Options } from "src/constants/types";
import { InventoryEntity } from "src/entities/inventory.entity";
import { JobRunEntity } from "src/entities/jobrun.entity";
import { ProjectEntity } from "src/entities/project.entity";
import { VolumeEntity } from "src/entities/volume.entity";
import { nextDate } from "src/utils/mapper";
import { WorkflowService } from "src/workflow/workflow.service";
import { DataSource, EntityManager, In, Raw, Repository } from "typeorm";
import { validate as isUUID, v4 as uuidv4 } from "uuid";
import { JobConfigEntity } from "../entities/jobconfig.entity";
import {
  SpeedTestConfigEntity,
  SpeedTestConfigWorkerEntity,
} from "src/entities/speed-test-job-config.entity";
import {
  LoggerFactory,
  LoggerService,
} from "@netapp-cloud-datamigrate/logger-lib";

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
import {
  IncidentStatus,
  SyncEmailEntity,
} from "src/entities/sync-email.entity";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import { SuccessEmailType } from "src/utils/send-email.type";
import { WorkFlowFailureReason } from "src/jobrun/jobrun.types";
import { JobStatsSummaryMvEntity } from "src/entities/job-stats-summary-mv.entity";
import { JobConfigInventoryStatsResponseDto } from "./dto/jobconfig-inventory-stats.dto";
import { JobConfigInventoryStatsEntity } from "src/entities/job-config-inventory-stats.entity";
import { v4 as uuid } from 'uuid';
import { GetDirsDto } from './dto/get-dirs.dto';
import { MountDetails, MountRequest, MountTrackerService } from './mount-tracker.service';

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
    private readonly mountTrackerService: MountTrackerService,
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
    @InjectRepository(JobStatsSummaryMvEntity)
    private jobStatsSummaryMvRepo: Repository<JobStatsSummaryMvEntity>,
    @InjectRepository(JobConfigInventoryStatsEntity)
    private jobConfigInventoryStatsRepo: Repository<JobConfigInventoryStatsEntity>,
    @InjectDataSource()
    private dataSource: DataSource,    
  ) {
    this.logger = loggerFactory.create(JobConfigService.name);
  }

  // ------------ Bulk Discovery ---------------- //
  async createBulkDiscovery(
    bulkDiscovery: JobConfigDiscoverBulk
  ): Promise<JobConfigEntity[]> {
    const firstRunAt = bulkDiscovery?.firstRunAt ?? new Date();

    if (bulkDiscovery.shouldScanADS === true) {
      const volumes = await this.volumeRepo.find({
        where: { id: In(bulkDiscovery.sourcePathIds) },
        relations: ['fileServer'],
      });
      
      const nonSmbPaths = volumes.filter(
        (vol) => vol.fileServer?.protocol !== Protocol.SMB
      );
      
      if (nonSmbPaths.length > 0) {
        throw new BadRequestException(
          'shouldScanADS option is only supported for SMB protocol sources'
        );
      }
    }
  

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
        shouldScanADS: bulkDiscovery.shouldScanADS ?? false,
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
            shouldScanADS: bulkDiscovery.shouldScanADS ?? false,
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
        if (
          existingJobConfigs.some((job) => job.status === JobStatus.InActive)
        ) {
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
                message:
                  "Inactive job found. Please reactivate or remove the existing job.",
              });
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
        projectId,
        migrateJob: {
          savedJobConfigs: savedJobConfigs.map((jobConfig) => ({
            id: jobConfig.id,
            sourcePath: jobConfig.sourcePath?.volumePath,
            targetPath: jobConfig.targetPath?.volumePath,
            jobType: jobConfig.jobType,
          })),
        },
      });
      savedJobConfigsmapData = savedJobConfigs.map(
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
      warnings:
        inactiveJobWarnings.length > 0 ? inactiveJobWarnings : undefined,
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
    data: Partial<JobConfigDto>,
    manager?: EntityManager
  ): Promise<JobConfigEntity> {
    const jobRepo = manager ? manager.getRepository(JobConfigEntity) : this.jobConfigRepo;
    const job = await jobRepo.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException(`Job with id ${id} not found`);
    }
    
    // Handle field mapping between DTO and entity
    const { futureSchedule, ...otherData } = data;
    Object.assign(job, otherData);
    
    // Map futureSchedule from DTO to futureScheduleAt in entity
    if (futureSchedule !== undefined) {
      job.futureScheduleAt = futureSchedule;
    }
    
    return jobRepo.save(job);
  }

  async updateJobConfigWithMappings(
    jobConfigId: string,
    jobConfigData: Partial<JobConfigDto>,
    mappingData?: { sidMapping?: string; gidMapping?: string }
  ): Promise<{ jobConfig: JobConfigEntity; identityMappings?: any }> {
    try {
      return await this.jobConfigRepo.manager.transaction(async (manager) => {
        let identityMappings;
        if (mappingData?.sidMapping || mappingData?.gidMapping) {
          identityMappings = await this.updateJobIdentityMappings(
            jobConfigId,
            mappingData,
            manager
          );
        }

        const jobConfig = await this.updateJobConfig(
          jobConfigId,
          jobConfigData,
          manager
        );

        return { jobConfig, identityMappings };
      });
    } catch (error) {
      this.logger.error(
        `Failed to update job config ${jobConfigId} with identity mappings`,
        error
      );
      throw new HttpException(
        {
          status: "failed",
          message: error.message || "Failed to update job configuration",
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async getJobEntity(id: string): Promise<JobConfigEntity> {
    const job = await this.jobConfigRepo.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException(`Job with id ${id} not found`);
    }
    return job;
  }

  // ------------ Bulk delete ---------------- //
  async deleteJobConfig(id: string): Promise<{ message: string }> {
    try {
      const job = await this.jobConfigRepo.findOne({ 
        where: { id }
      });
      if (!job) {
        throw new NotFoundException(`Job with id ${id} not found`);
      }

      // Check for active job runs
      const activeJobRuns = await this.jobRunRepo.find({
        where: {
          jobConfigId: id,
          status: In([
            JobRunStatus.Ready,
            JobRunStatus.Pending,
            JobRunStatus.Running,
            JobRunStatus.Paused,
            JobRunStatus.Pausing,
            JobRunStatus.Stopping,
          ]),
        },
      });

      if (activeJobRuns.length > 0) {
        throw new BadRequestException(
          'Cannot delete job configuration. There are active job runs associated with this configuration.',
        );
      }

      await this.jobConfigRepo.remove(job);
      this.logger.log(`Job with id ${id} has been deleted successfully`);
      return { message: `Job with id ${id} has been deleted` };
    } catch (error) {
      this.logger.error(`Failed to delete job with id ${id}`, error.stack);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          status: "failed",
          message: error.message || "Failed to delete job configuration",
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
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
        const inventoryCounts = await this.calculateJobRunStats(jobRun.id);
        // Fetch lastRefreshed from materialized view
        const mv = await this.jobStatsSummaryMvRepo.findOne({
          where: { jobRunId: jobRun.id },
        });
        return {
          ...partialPayload,
          scannedFilesCount: BigInt(
            inventoryCounts.fileCount || "0"
          )?.toString(),
          scannedDirectoriesCount: BigInt(
            inventoryCounts.directories || "0"
          )?.toString(),
          totalScannedSize: formatBytes(
            Number(inventoryCounts?.totalSize || 0)
          ),
          totalMigratedSize: formatBytes(
            Number(inventoryCounts?.totalSize || 0)
          ),
          errors: inventoryCounts.errors,
          lastRefreshed: mv?.lastRefreshed,
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
      configurationsSetToJob: this.getConfigurationsSetToJob(jobConfig),
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

  getConfigurationsSetToJob(jobConfig: JobConfigEntity) {
    const excludeFilePatternsArray = jobConfig.excludeFilePatterns ?
                                      ( jobConfig.excludeFilePatterns
                                      .split(",")
                                      .map(pattern => pattern.trim())
                                      .filter(pattern => pattern !== "") ) : [];

    if (jobConfig.jobType === JobType.MIGRATE) {
      return {
        [JobConfigurationEnum.skipFile]: jobConfig.skipFile
          ? jobConfig.skipFile
              .split("-")
              .map((part) => {
                if (part.endsWith("M")) return `${part.replace("M", "")}-Mins`;
                if (part.endsWith("H")) return `${part.replace("H", "")}-Hrs`;
                if (part.endsWith("D")) return `${part.replace("D", "")}-Days`;
                return part;
              })
              .join("")
          : "-",
        [JobConfigurationEnum.preserveAccessTime]: jobConfig.preserveAccessTime ? "Enabled" : "Disabled",
        [JobConfigurationEnum.excludeFilePatterns]: excludeFilePatternsArray,
        [JobConfigurationEnum.excludeOlderThan]: jobConfig.excludeOlderThan,
        [JobConfigurationEnum.futureScheduleAt]: jobConfig.futureScheduleAt,
        [JobConfigurationEnum.firstRunAt]: jobConfig.firstRunAt,
      }
    } else if (jobConfig.jobType === JobType.CUT_OVER) {
      return {
        [JobConfigurationEnum.preserveAccessTime]: jobConfig.preserveAccessTime ? "Enabled" : "Disabled",
        [JobConfigurationEnum.excludeFilePatterns]: excludeFilePatternsArray,
        [JobConfigurationEnum.excludeOlderThan]: jobConfig.excludeOlderThan,
      }
    } else {
      // DISCOVERY job type
      return {
        [JobConfigurationEnum.excludeFilePatterns]: excludeFilePatternsArray,
        [JobConfigurationEnum.shouldScanADS]: jobConfig.shouldScanADS ? "Enabled" : "Disabled",
        [JobConfigurationEnum.firstRunAt]: jobConfig.firstRunAt,
      }
    }
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

    // Use GROUP BY to get unique alerts with latest timestamp, sorted by timestamp
    const severityMessages = await this.syncEmailRepo
      .createQueryBuilder("syncEmail")
      .select("syncEmail.description", "description")
      .addSelect("MAX(syncEmail.createdAt)", "created_at")
      .where("syncEmail.incidentStatus = :status", {
        status: IncidentStatus.OPEN,
      })
      .andWhere("syncEmail.description IS NOT NULL")
      .groupBy("syncEmail.description")
      .orderBy("created_at", "DESC")
      .getRawMany();

    // Map to desired format (already sorted by database)
    const severityMessagesWithTimestamps = severityMessages.map((row) => ({
      message: row.description,
      timestamp: new Date(row.created_at),
    }));

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
      `severityMessages - Unique alerts: ${severityMessagesWithTimestamps?.length}`
    );

    return {
      countErroredJobRuns,
      countBlockedCutoverJobRuns,
      countRecentJobConfigs,
      countCompletedJobRuns,
      severityMessages: severityMessagesWithTimestamps,
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
    for (const job of allJobsDetails) {
      let nextScheduleDate: Date | null = null;

      if (job.jobconfigstatus === JobStatus.Active) {
        try {
          nextScheduleDate = nextDate(
            job.jobtype,
            job.firstrunat,
            job.futureschedule
          );
        } catch (err) {
          this.logger.error(
            `Failed to calculate nextScheduleDate for jobConfigId ${job.jobconfigid}:`,
            (err as Error).message
          );
          nextScheduleDate = null;
        }
      }

      const allErrorCounts = await Promise.all(
        job.jobRunIds.map((id) => this.getErrorCounts(id))
      );
      const errorCount =
        allErrorCounts
          .flat()
          .map((e) => e.count)
          .reduce((a, b) => Number(a) + Number(b), 0) || 0;

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
    }
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
    templateType: TemplateType,
    manager?: EntityManager
  ) {
    this.logger.log("reached for saving mappings");
    const identityMappingRepo = manager ? manager.getRepository(IdentityMappingEntity) : this.identityMappingRepo;
    const identityCrossMappingRepo = manager ? manager.getRepository(IdentityConfigCrossMappingEntity) : this.identityCrossMappingRepo;

    for (const mapping of parsedData) {
      if (templateType === TemplateType.SID) {
        const { sourceMapping, targetMapping } = mapping as {
          sourceMapping: string;
          targetMapping: string;
        };
        const identityMappingEntity = identityMappingRepo.create({
          identityType: templateType,
          identityMap: identityMap,
          sourceMapping: sourceMapping,
          targetMapping: targetMapping,
        });
        const savedIdentityMapping = await identityMappingRepo.save(
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

        const gidMappingEntity = identityMappingRepo.create({
          identityType: TemplateType.GID,
          identityMap: identityMap,
          sourceMapping: sourceMappingGid,
          targetMapping: targetMappingGid,
        });
        const savedGidMapping = await identityMappingRepo.save(gidMappingEntity);
        this.logger.log(`GID mapping inserted with ID: ${savedGidMapping.id}`);

        const uidMappingEntity = identityMappingRepo.create({
          identityType: TemplateType.UID,
          identityMap: identityMap,
          sourceMapping: sourceMappingUid,
          targetMapping: targetMappingUid,
        });
        const savedUidMapping = await identityMappingRepo.save(uidMappingEntity);
        this.logger.log(`UID mapping inserted with ID: ${savedUidMapping.id}`);
      }
    }

    for (const jobConfigId of jobConfigIds) {
      const identityConfigCrossMappingEntity = identityCrossMappingRepo.create({
          identityMappingId: identityMap,
          jobConfigId: jobConfigId,
        });

      await identityCrossMappingRepo.save(identityConfigCrossMappingEntity);
    }
  }

  async updateMappingsWithMap(
    jobConfigIds: any[],
    parsedData: ParsedMapping[],
    identityMap: string,
    templateType: TemplateType,
    manager?: EntityManager
  ) {
    this.logger.log("reached for updating mappings");
    this.logger.log("parsedData", parsedData);
    const identityMappingRepo = manager ? manager.getRepository(IdentityMappingEntity) : this.identityMappingRepo;
    const identityCrossMappingRepo = manager ? manager.getRepository(IdentityConfigCrossMappingEntity) : this.identityCrossMappingRepo;
    for (const mapping of parsedData) {
      if (templateType === TemplateType.SID) {
        const { sourceMapping, targetMapping } = mapping as {
          sourceMapping: string;
          targetMapping: string;
        };
        const identityMappingEntity = identityMappingRepo.create({
          identityType: templateType,
          identityMap: identityMap,
          sourceMapping: sourceMapping,
          targetMapping: targetMapping,
        });
        const savedIdentityMapping = await identityMappingRepo.save(
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

        const gidMappingEntity = identityMappingRepo.create({
          identityType: TemplateType.GID,
          identityMap: identityMap,
          sourceMapping: sourceMappingGid,
          targetMapping: targetMappingGid,
        });
        const savedGidMapping = await identityMappingRepo.save(
          gidMappingEntity
        );
        this.logger.log(`GID mapping inserted with ID: ${savedGidMapping.id}`);

        const uidMappingEntity = identityMappingRepo.create({
          identityType: TemplateType.UID,
          identityMap: identityMap,
          sourceMapping: sourceMappingUid,
          targetMapping: targetMappingUid,
        });
        const savedUidMapping = await identityMappingRepo.save(
          uidMappingEntity
        );
        this.logger.log(`UID mapping inserted with ID: ${savedUidMapping.id}`);
      }
    }

    for (const jobConfigId of jobConfigIds) {
      const existingCrossMapping = await identityCrossMappingRepo.findOne({
        where: {
          jobConfigId: jobConfigId,
          isOrphan: false,
        },
      });

      if (existingCrossMapping) {
        existingCrossMapping.identityMappingId = identityMap;
        await identityCrossMappingRepo.save(existingCrossMapping);
        this.logger.log(
          `Identity config cross mapping updated for JobConfig ID: ${jobConfigId}`
        );
      } else {
        const identityConfigCrossMappingEntity =
          await identityCrossMappingRepo.create({
            identityMappingId: identityMap,
            jobConfigId: jobConfigId,
          });

        await identityCrossMappingRepo.save(identityConfigCrossMappingEntity);
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
    const inventorySummary = await this.jobStatsSummaryMvRepo.findOne({
      where: { jobRunId },
    });
    if (!inventorySummary) {
      this.logger.warn(
        `No inventory summary found for job run ID ${jobRunId}. Returning default values.`
      );
      return {
        fileCount: "0",
        directories: "0",
        totalSize: "0",
        errors: await this.getErrorCounts(jobRunId),
      };
    }
    const jobRunStatus = {
      fileCount: inventorySummary.fileCount || "0",
      directories: inventorySummary.directoryCount || "0",
      totalSize: inventorySummary.totalSize || "0",
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
      .andWhere("oe.errorType IN (:...errorTypes)", { errorTypes: USER_VISIBLE_ERROR_TYPES })
      .select([
        "oe.errorType AS errorType", 
        "COUNT(*) AS count"
      ])
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
      const fatalError = errorTypeCounts.find(
        (error) => error.errorType === "FATAL_ERROR"
      );
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

  async getIdentityMappingsForJob(
    jobConfigId: string,
    manager?: EntityManager
  ): Promise<any> {
    this.logger.log(`Fetching identity mappings for job config: ${jobConfigId}`);
    try {
      const crossMappingRepo = manager ? manager.getRepository(IdentityConfigCrossMappingEntity) : this.identityCrossMappingRepo;
      const identityMappingRepo = manager ? manager.getRepository(IdentityMappingEntity) : this.identityMappingRepo;
      const crossMappings = await crossMappingRepo.find({
        where: { jobConfigId, isOrphan: false },
        relations: ['identityMapping'],
      });
      if (!crossMappings.length) {
        return {
          data: [],
          message: 'No identity mappings found for this job configuration',
        };
      }
      const identityMappingIds = crossMappings.map(
        (crossMapping) => crossMapping.identityMappingId
      );
      const identityMappings = await identityMappingRepo.findBy({
        identityMap: In(identityMappingIds),
      });
      return {
        data: identityMappings,
        crossMappings: crossMappings,
      };
    } catch (error) {
      this.logger.error(`Error fetching identity mappings for job ${jobConfigId}:`, error);
      throw new HttpException(
        {
          status: "failed",
          message: error.message || "Failed to fetch identity mappings",
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async updateJobIdentityMappings(
    jobConfigId: string,
    mappingData: { sidMapping?: string; gidMapping?: string },
    manager?: EntityManager
  ): Promise<any> {
    this.logger.log(`Updating identity mappings for job config: ${jobConfigId}`);
    try {
      let parsedMappings = [];
      let templateType;
      const identityMap = uuidv4();
      const identityCrossMappingRepo = manager ? manager.getRepository(IdentityConfigCrossMappingEntity) : this.identityCrossMappingRepo;
      const existingCrossMapping = await identityCrossMappingRepo.find({
        where: {
          jobConfigId: jobConfigId,
          isOrphan: false,
        },
      });
      if (existingCrossMapping.length > 0) {
        await identityCrossMappingRepo.update(
          { jobConfigId: jobConfigId, isOrphan: false },
          { isOrphan: true }
        );
        this.logger.log(`Marked existing mappings as orphan for job config: ${jobConfigId}`);
      }
      if (mappingData.sidMapping) {
        templateType = TemplateType.SID;
        const sidMapping = await this.decodeBase64(mappingData.sidMapping);
        parsedMappings = await this.parseBlobData(sidMapping, templateType);
      }
      if (mappingData.gidMapping) {
        templateType = TemplateType.GID;
        const gidMapping = await this.decodeBase64(mappingData.gidMapping);
        parsedMappings = await this.parseBlobData(gidMapping, templateType);
      }
      if (parsedMappings.length > 0) {
        await this.saveIdentityMappingsWithMap(
          [jobConfigId],
          parsedMappings,
          identityMap,
          templateType,
          manager
        );
        this.logger.log(`Successfully updated identity mappings for job config: ${jobConfigId}`);
      }
      return await this.getIdentityMappingsForJob(jobConfigId, manager);
    } catch (error) {
      this.logger.error(`Error updating identity mappings for job ${jobConfigId}:`, error);
      throw new HttpException(
        {
          status: "failed",
          message: error.message || "Failed to update identity mappings",
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async deleteIdentityMappingsForJob(jobConfigId: string): Promise<any> {
    this.logger.log(`Deleting identity mappings for job config: ${jobConfigId}`);
    try {
      const crossMappings = await this.identityCrossMappingRepo.find({
        where: { jobConfigId, isOrphan: false },
      });
      if (!crossMappings.length) {
        return {
          message: 'No identity mappings found for this job configuration',
        };
      }

      await this.identityCrossMappingRepo.update(
        { jobConfigId: jobConfigId, isOrphan: false },
        { isOrphan: true }
      );
      this.logger.log(`Marked ${crossMappings.length} mappings as orphan for job config: ${jobConfigId}`);

      return {
        message: 'Identity mappings deleted successfully',
        deletedCount: crossMappings.length,
      };
    } catch (error) {
      this.logger.error(`Error deleting identity mappings for job ${jobConfigId}:`, error);
      throw new HttpException(
        {
          status: "failed",
          message: error.message || "Failed to delete identity mappings",
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async getJobConfigInventoryStats(jobConfigID: string, fetchLatest: boolean = false): Promise<JobConfigInventoryStatsResponseDto> {
    if (!isUUID(jobConfigID)) {
      throw new BadRequestException('Invalid jobConfigID format');
    }

    const jobConfig = await this.jobConfigRepo.findOne({
      where: { id: jobConfigID },
    });

    if (!jobConfig) {
      throw new NotFoundException(`Job config with ID ${jobConfigID} not found`);
    }

    if (jobConfig.jobType !== JobType.MIGRATE) {
      throw new BadRequestException(`Inventory stats are only available for Migration job configs. Current job type: ${jobConfig.jobType}`);
    }    
    let statsEntity = await this.jobConfigInventoryStatsRepo.findOne({
      where: { jobConfigId: jobConfigID },
    });
    // If fetchLatest is false, just return cached data from repository
    if (!fetchLatest) {
      if (!statsEntity) {
        throw new HttpException(
          {
            status: 'pending',
            message: 'Calculation in progress or no results to display',
          },
          HttpStatus.ACCEPTED // 202
        );
      }

      return {
        totalUniqueFiles: Number(statsEntity.fileCount),
        totalUniqueDirectories: Number(statsEntity.dirCount),
        totalSize: formatBytes(Number(statsEntity.totalSize)),
        lastUpdatedAt: statsEntity.lastUpdatedAt,
      };
    }
    // Get the latest completed/errored/failed jobRun for this jobConfig
    const latestJobRun = await this.jobRunRepo.findOne({
      where: { 
        jobConfigId: jobConfigID,
        status: In([JobRunStatus.Completed, JobRunStatus.Failed, JobRunStatus.Errored, JobRunStatus.Stopped]),
      },
      order: { endTime: 'DESC' },
    });
    let needsRecalculation = false;
    if (!statsEntity) {
      needsRecalculation = true;
    } else if (latestJobRun && latestJobRun.endTime) {
      if (latestJobRun.endTime > statsEntity.lastUpdatedAt) {
        needsRecalculation = true;
      }
    }

    // If no recalculation needed, return already calculated results
    if (!needsRecalculation && statsEntity) {
      return {
        totalUniqueFiles: Number(statsEntity.fileCount),
        totalUniqueDirectories: Number(statsEntity.dirCount),
        totalSize: formatBytes(Number(statsEntity.totalSize)),
        lastUpdatedAt: statsEntity.lastUpdatedAt,
      };
    }

    // Recalculate stats
    const dbSchema = process.env.SCHEMA;
    const query = `
      WITH all_related_jobs AS (
        SELECT jr.id, jr.start_time
        FROM ${dbSchema}.jobrun jr
        JOIN ${dbSchema}.jobconfig jc ON jr.job_config_id = jc.id
        WHERE (jc.source_path_id, jc.target_path_id) = (
          SELECT jc2.source_path_id, jc2.target_path_id
          FROM ${dbSchema}.jobconfig jc2
          WHERE jc2.id = $1
        )
        ORDER BY jr.start_time DESC
      ),
      inventory_with_latest_status AS (
        SELECT 
          i.path,
          i.is_directory,
          i.file_size,
          FIRST_VALUE(i.is_deleted) OVER (
            PARTITION BY i.path, i.is_directory
            ORDER BY arj.start_time DESC
          ) as latest_deletion_status
        FROM ${dbSchema}.inventory i
        JOIN all_related_jobs arj ON i.job_run_id = arj.id
      ),
      unique_paths_with_max_size AS (
        SELECT 
          path,
          is_directory,
          MAX(file_size) as max_file_size,
          latest_deletion_status
        FROM inventory_with_latest_status
        WHERE (latest_deletion_status = false OR latest_deletion_status IS NULL)
        GROUP BY path, is_directory, latest_deletion_status
      )
      SELECT 
        COUNT(DISTINCT CASE WHEN is_directory = false THEN path END) as total_unique_files,
        COUNT(DISTINCT CASE WHEN is_directory = true THEN path END) as total_unique_directories,
        COALESCE(SUM(CASE WHEN is_directory = false THEN max_file_size ELSE 0 END), 0)::bigint as total_size
      FROM unique_paths_with_max_size;
    `;

    try {
      const result = await this.dataSource.query(query, [jobConfigID]);
      
      const totalUniqueFiles = parseInt(result[0]?.total_unique_files || '0', 10);
      const totalUniqueDirectories = parseInt(result[0]?.total_unique_directories || '0', 10);
      const totalSize = Number(result[0]?.total_size || '0');
      const lastUpdatedAt = new Date();

      // Upsert stats record
      if (statsEntity) {
        statsEntity.fileCount = totalUniqueFiles;
        statsEntity.dirCount = totalUniqueDirectories;
        statsEntity.totalSize = totalSize;
        statsEntity.lastUpdatedAt = lastUpdatedAt;
      } else {
        statsEntity = this.jobConfigInventoryStatsRepo.create({
          jobConfigId: jobConfigID,
          fileCount: totalUniqueFiles,
          dirCount: totalUniqueDirectories,
          totalSize: totalSize,
          lastUpdatedAt: lastUpdatedAt,
        });
      }

      await this.jobConfigInventoryStatsRepo.save(statsEntity);

      return {
        totalUniqueFiles,
        totalUniqueDirectories,
        totalSize: formatBytes(totalSize),
        lastUpdatedAt,
      };
    } catch (error) {
      this.logger.error(`Error getting inventory stats for jobConfigID ${jobConfigID}:`, error);
      throw new HttpException(
        {
          status: 'failed',
          message: error.message || 'Failed to get inventory stats',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async getDirs(payload: GetDirsDto): Promise<{ name: string }[]> {
    const workflowId = `ListDirs-${payload.fileServerId}-${payload.exportPath.replace(/\//g, '_')}`;
    const requestId = uuid();
    const redisKey = `${workflowId}-${requestId}`;
  
    this.logger.log(`getDirs: workflowId=${workflowId}, requestId=${requestId}`);
  
    // 1. Ensure workflow is running
    await this.ensureWorkflowRunning(workflowId, payload);
  
    // 2. Send signal using existing workflowService.sendSignal
    await this.workFlowService.sendSignal({
      workflowId,
      signalName: 'listDir',
      payload: { requestId, path: payload.path || '' },
    });
  
    this.logger.log(`Signal sent to workflow ${workflowId}`);
  
    // 3. Poll Redis for result
    const result = await this.pollRedisForResult(redisKey);
  
    if (result.status === 'ERROR') {
      throw new HttpException(result.errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  
    return result.directories;
  }

  async getDirsFromService(payload: GetDirsDto): Promise<{ name: string }[]> {
  
    const key = `/mnt/${payload.fileServerId}/${payload.exportPath}/${payload.path}`;

    const mountRequest: MountRequest = {
      fileServerId: payload.fileServerId,
      exportPath: payload.exportPath,
      hostname: '',
      dir: payload.path || '',
      username: 'ndmuser',
      password: 'test@123',
      protocol: payload.protocol || Protocol.NFS,
    };
  
    const result:MountDetails = await this.mountTrackerService.ensureMounted(mountRequest);
    
    const { stdout } = await execAsync(`find "${key}" -maxdepth 2 -type d 2>/dev/null`, { maxBuffer: 1024 * 1024 * 10 });
    const normalizedFullPath = key.replace(/\/$/, ''); 
    
    const directories = stdout.trim().split('\n')
    .filter(entry => {
        const normalizedEntry = entry.replace(/\/$/, '');
        return entry.length > 0 && normalizedEntry !== normalizedFullPath;
    })
    .map(entry => {
        let name = entry.replace(key, '').replace(/^\//, '');
        if (name === entry) {
        name = entry.replace(normalizedFullPath, '').replace(/^\//, '');
        }
        return { name };
    });
    
    this.logger.log(`Found ${directories.length} directories`);
    return directories;    
  }
  
  private async ensureWorkflowRunning(workflowId: string, payload: GetDirsDto): Promise<void> {
    try {
      const status = await this.workFlowService.getWorkflowStatus(workflowId);
      if (status === 'RUNNING') {
        this.logger.log(`Workflow ${workflowId} already running`);
        return;
      }
    } catch (error) {
      this.logger.log(`Starting new workflow ${workflowId}`);
    }
  
    const fileServer = await this.fileServerRepo.findOne({
      where: { id: payload.fileServerId },
    });
  
    if (!fileServer) {
      throw new NotFoundException(`File server ${payload.fileServerId} not found`);
    }
  
    await this.workFlowService.startWorkflow('ListDirsWorkflow' as any, {
      workflowId,
      taskQueue: 'JobsService-ListDirs-TaskQueue',
      args: [{
        fileServerId: payload.fileServerId,
        hostname: fileServer.host,
        exportPath: payload.exportPath,
        protocol: fileServer.protocol,
        username: fileServer.userName,
        password: fileServer.password,
        protocolVersion: fileServer.protocolVersion,
      }],
    });
  
    await this.sleep(2000);
  }
  
  private async pollRedisForResult(key: string): Promise<any> {
    const maxWaitMs = 60000;
    const pollIntervalMs = 100;
    const startTime = Date.now();
  
    while (Date.now() - startTime < maxWaitMs) {
      const result = await this.redisService.getDirListing(key);
      if (result) {
        await this.redisService.delDirListing(key);
        return JSON.parse(result);
      }
      await this.sleep(pollIntervalMs);
    }
  
    throw new HttpException('Directory listing timed out', HttpStatus.INTERNAL_SERVER_ERROR);
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getFileServerById(id: string): Promise<FileServerEntity> {
  return this.fileServerRepo.findOne({
    where: { id },
  });
}
}
function execAsync(arg0: string, arg1: { maxBuffer: number; }): { stdout: any; } | PromiseLike<{ stdout: any; }> {
  throw new Error("Function not implemented.");
}



