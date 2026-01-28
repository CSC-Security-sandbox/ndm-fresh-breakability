import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import {
  FileServerDetails,
  JobConfig,
  JobContextFactory,
  NFS,
  SMB,
  SpeedTestJobConfig
} from "@netapp-cloud-datamigrate/jobs-lib";
import {
  IdentityTypes,
  JobStatus as JobContextStatus
} from "@netapp-cloud-datamigrate/jobs-lib/dist/types/enums";
import { JobState } from "@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state";
import axios from "axios";
import {
  JobRunStatus,
  JobRunType,
  JobStatus,
  JobType,
  Protocol,
  WorkFlows
} from "src/constants/enums";
import { ScheduleStatus } from "src/constants/status";
import { Options } from "src/constants/types";
import { JobConfigEntity } from "src/entities/jobconfig.entity";
import {
  SpeedTestConfigEntity
} from "src/entities/speed-test-job-config.entity";
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

import { FileServerEntity } from "src/entities/fileserver.entity";
import { IdentityConfigCrossMappingEntity } from "src/entities/indentity-mapping-cross.entity";
import { IdentityMappingEntity } from "src/entities/indentity-mapping.entity";
import { JobOptionsEntity } from "src/entities/joboptions.entity";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import { MigrationConflictService } from "src/migration-conflict/migration-conflict.service";
import { RedisService } from "src/redis/redis.service";
import { filterUnhealthyWorkers } from "src/utils/worker-filter";
import { WorkflowService } from "src/workflow/workflow.service";
import { StartWorkFlowPayload } from "src/workflow/workflow.types";
import { Readable } from "stream";
import { In, LessThan, Repository } from "typeorm";
import { v4 as uuid4 } from "uuid";
import { JobRunEntity } from "../entities/jobrun.entity";
import { JobRunConfig } from "./jobrun.types";
import { getWorkflowId } from "./jobrun.util";

@Injectable()
export class JobRunInitService {
  private readonly logger: LoggerService;
  private readonly mountBasePath: string;

  constructor(
    @InjectRepository(JobRunEntity)
    private jobRunRepo: Repository<JobRunEntity>,
    @InjectRepository(SpeedTestConfigEntity)
    private SpeedTestConfigRepo: Repository<SpeedTestConfigEntity>,
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
    @InjectRepository(FileServerEntity)
    private fileServerRepo: Repository<FileServerEntity>,
    @InjectRepository(WorkerJobRunMap)
    private workerJobRunMapRepo: Repository<WorkerJobRunMap>,
    @InjectRepository(JobOptionsEntity)
    private optionRepo: Repository<JobOptionsEntity>,
    @Inject()
    private workFlowService: WorkflowService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    @InjectRepository(IdentityMappingEntity)
    private identityMappingRepo: Repository<IdentityMappingEntity>,
    @InjectRepository(IdentityConfigCrossMappingEntity)
    private identityConfigCrossMappingRepo: Repository<IdentityConfigCrossMappingEntity>,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly migrationConflictService: MigrationConflictService,
  ) {
    this.logger = loggerFactory.create(JobRunInitService.name);
    this.mountBasePath = this.configService.get<string>(
      "app.paths.mountBasePath",
    );
  }

  // ------------------ Cron schedule -------------------- //
  async scheduleAJob() {
    const currentTime = new Date();
    const jobs: JobConfigEntity[] = await this.jobConfigRepo.find({
      select: { 
        id: true, 
        sourcePathId: true, 
        targetPathId: true,
        sourcePath: {
          fileServer: {
            config: {
              projectId: true
            }
          }
        }
      },
      relations: {
        sourcePath: {
          fileServer: {
            config: true
          }
        }
      },
      where: {
        status: JobStatus.Active,
        scheduler: ScheduleStatus.SCHEDULING,
        firstRunAt: LessThan(currentTime),
      },
    });
    const scheduledJobs = [];
    for (const job of jobs) {
      const alreadyExists = await this.migrationConflictService.checkMigrationConflicts({
        migrateConfigs: [
          {
            sourcePathId: job.sourcePathId,
            destinationPathId: job.targetPathId ? [job.targetPathId] : [],
          },
        ],
      });
      if (alreadyExists.length === 0) {
        const projectId = job.sourcePath?.fileServer?.config?.projectId;
        await this.createJobRun(job.id, currentTime, projectId);
        scheduledJobs.push(job);
      } else {
        this.logger.warn(
          `Job Config ${job.id} has migration conflicts. Skipping job run creation.`,
        );
      }
    }
    return scheduledJobs;
  }

  // ------------------ Create job run  -------------------- //
  async createJobRun(jobConfigId: string, currentTime: Date, projectId?: string, jobRunId?: string) {
    // TODO: job config is fetched from here
    const details: JobRunConfig = await this.getJobConfig(jobConfigId);
    
    // If this is a retry run, set the jobRunId
    if (jobRunId) {
      details.jobRunId = jobRunId;
    }

    // check if source and target paths are flagged as valid
    const source = details.connection?.sourceCredential;
    const target = details.connection?.targetCredential;

    const isSourceValid = (source?.isValidPath) && (!source?.isDisabled);
    const isTargetValid = !target || (target.isValidPath && !target.isDisabled);
    if (!isSourceValid || !isTargetValid) {
      await this.jobConfigRepo.update({ id: jobConfigId }, { scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED });
      throw new NotFoundException(`Job Config ${jobConfigId} has invalid source or target path, skipping job run creation.`);
    }

    if (details.workers.length === 0) {
      this.logger.warn(
        `Unable to create Job Run for Job Config ${jobConfigId} does not has workers`,
      );
      return;
    }

    await this.jobConfigRepo.update(
      { id: jobConfigId },
      { scheduler: ScheduleStatus.SCHEDULED },
    );
    try {
      const workerMap = details.workers.map((worker) =>
        this.workerJobRunMapRepo.create({
          workerId: worker,
          isActive: true,
          isPathMounted: false,
        }),
      );
      let identityMappingId: string | null = null;
      if (details.jobType === JobType.MIGRATE) {
        const activeMapping = await this.identityConfigCrossMappingRepo.findOne({
          where: { jobConfigId: details.id, isOrphan: false },
          order: { createdAt: "DESC" },
        });
        identityMappingId = activeMapping?.identityMappingId || null;
      }
      const options = this.optionRepo.create({
        excludeFilePatterns: details.excludeFilePatterns,
        sourceWorkingDir: this.mountBasePath,
        targetWorkingDir: this.mountBasePath,
        preserveAccessTime: details.preserveAccessTime,
        excludeOlderThan: details.excludeOlderThan,
        shouldScanADS: details.shouldScanADS,
        skipFile: details.skipFile,
        identityMappingId: identityMappingId,
      });
      const jobRun = this.jobRunRepo.create({
        id: uuid4(),
        status: JobRunStatus.Ready,
        startTime: currentTime,
        endTime: null,
        iterationNumber: 1,
        jobConfigId: jobConfigId,
        workerMap: workerMap,
        options: options,
        //if jobRunId is provided, it is a retry run
        jobRunType: jobRunId ? JobRunType.RETRY : JobRunType.REGULAR,
      });
      await this.buildJobContext(jobRun.id, details);
      await this.initiateWorkflow(jobRun.id, details, projectId);
      jobRun.workFlowId = getWorkflowId(jobRun.id, details.jobType, !!details.jobRunId);
      return await this.jobRunRepo.save(jobRun);
    } catch (error) {
      this.logger.error(`Failed to create job run for ${jobConfigId}: ${error.message}`);
      await this.jobConfigRepo.update(
        { id: jobConfigId },
        { scheduler: ScheduleStatus.SCHEDULING },
      );
    }
  }

  async getJobConfigSpeedTest(jobConfigId): Promise<JobRunConfig> {
    const jobConfig = await this.jobConfigRepo.findOne({
      where: { id: jobConfigId },
      relations: {
        speedTestConfigs: {
          workerEntities: true,
        },
      },
    });
    const workers =
      jobConfig?.speedTestConfigs?.flatMap((config) =>
        config.workerEntities.map((worker) => worker.workersId),
      ) || [];

    const details: JobRunConfig = {
      id: jobConfig.id,
      preserveAccessTime: jobConfig?.preserveAccessTime,
      excludeFilePatterns: jobConfig?.excludeFilePatterns,
      excludeOlderThan: jobConfig?.excludeOlderThan,
      connection: {
        sourceCredential: {
          path: jobConfig?.sourcePath?.volumePath,
          pathId: jobConfig?.sourcePath?.id,
          isValidPath: jobConfig?.sourcePath?.isValid,
          isDisabled: jobConfig?.sourcePath?.isDisabled,
          protocol: jobConfig?.sourcePath?.fileServer?.protocol,
          username: jobConfig?.sourcePath?.fileServer?.userName,
          password: jobConfig?.sourcePath?.fileServer?.password,
          host: jobConfig?.sourcePath?.fileServer?.host,
          workingDirectory: this.mountBasePath,
          protocolVersion: "",
        },
      },
      workers: workers,
      jobType: jobConfig?.jobType,
    };
    return details;
  }

  // ------------------ Get list of workers -------------------- //
  async getJobConfig(jobConfigId): Promise<JobRunConfig> {
    const healthStatsTimeout = parseInt(
      this.configService.get("app.worker.healthCheckStatusTimout"),
    );
    const jobConfig = await this.jobConfigRepo.findOne({
      where: { id: jobConfigId },
      relations: {
        sourcePath: { fileServer: { config: true, workers: { stats: true } } },
        targetPath: { fileServer: { config: true, workers: { stats: true } } },
      },
    });
    if (jobConfig.jobType === JobType.SPEED_TEST) {
      return this.getJobConfigSpeedTest(jobConfigId);
    }
    const sourceWorkers = jobConfig?.sourcePath?.fileServer?.workers || [];
    const targetWorkers = jobConfig?.targetPath?.fileServer?.workers || [];
    // We always set 'skip delete' to false, as we want the baseline and incremental migrations to mirror the source exactly.
    const skipDelete : boolean = false
    const details: JobRunConfig = {
      id: jobConfig.id,
      preserveAccessTime: jobConfig.preserveAccessTime,
      shouldScanADS: jobConfig.shouldScanADS ?? false,
      excludeFilePatterns: jobConfig.excludeFilePatterns,
      excludeOlderThan: jobConfig.excludeOlderThan,
      connection: {
        sourceCredential: {
          path: jobConfig?.sourcePath?.volumePath,
          isValidPath: jobConfig?.sourcePath?.isValid,
          isDisabled: jobConfig?.sourcePath?.isDisabled,
          pathId: jobConfig?.sourcePath?.id,
          protocol: jobConfig?.sourcePath?.fileServer?.protocol,
          username: jobConfig?.sourcePath?.fileServer?.userName,
          password: jobConfig?.sourcePath?.fileServer?.password,
          host: jobConfig?.sourcePath?.fileServer?.host,
          workingDirectory: this.mountBasePath,
          protocolVersion:
            jobConfig?.sourcePath?.fileServer?.protocolVersion?.replace(
              /^v/,
              "",
            ),
        },
      },
      workers: sourceWorkers
        .filter((worker) => {
          return filterUnhealthyWorkers(worker, healthStatsTimeout);
        })
        .map((worker) => worker.workerId),
      jobType: jobConfig.jobType,
      skipFile: jobConfig.skipFile,
      skipDelete: skipDelete,
    };

    if (jobConfig.targetPathId) {
      const workers: string[] = [];
      const workerSet = new Set<string>();
      sourceWorkers
        .filter((worker) => {
          return filterUnhealthyWorkers(worker, healthStatsTimeout);
        })
        .forEach((worker) => workerSet.add(worker.workerId));
      targetWorkers
        ?.filter((worker) => {
          return filterUnhealthyWorkers(worker, healthStatsTimeout);
        })
        .forEach((worker) => {
          if (workerSet.has(worker.workerId)) workers.push(worker.workerId);
        });

      details.connection["targetCredential"] = {
        path: jobConfig?.targetPath?.volumePath,
        pathId: jobConfig?.targetPath?.id,
        isValidPath: jobConfig?.targetPath?.isValid,
        isDisabled: jobConfig?.targetPath?.isDisabled,
        protocol: jobConfig?.targetPath?.fileServer?.protocol,
        username: jobConfig?.targetPath?.fileServer?.userName,
        password: jobConfig?.targetPath?.fileServer?.password,
        host: jobConfig?.targetPath?.fileServer?.host,
        workingDirectory: this.mountBasePath,
        protocolVersion:
          jobConfig?.targetPath?.fileServer?.protocolVersion?.replace(/^v/, ""),
      };
      details["workers"] = workers;
      return details;
    }
    return details;
  }

  async getFileServerDetails(jobRunId): Promise<any> {
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

    const mergedResults = speedTestJobConfig.map((config) => {
      const fileServer = fileServers.find(
        (server) => server.id === config.fileServer,
      );

      return {
        ...config,
        fileServerDetails: fileServer
          ? {
              fileServerId: fileServer.id,
              host: fileServer.host,
              userName: fileServer.userName,
              password: fileServer.password,
              fileServerProtocol: fileServer.protocol,
              fileServerName: fileServer.config.configName,
              volumes: fileServer.volumes[0],
              workingDirectory: fileServer.workingDirectory,
              workers: fileServer.workers,
            }
          : null,
      };
    });

    return mergedResults;
  }
  // ------------------ InitiateWorkflow -------------------- //
  async initiateWorkflow(jobRunId: string, jobRunConfig: JobRunConfig, projectId?: string) {

    const options = new Options();
    options.workflowExecutionTimeout = "120s";
    options.workflowTaskTimeout = "120s";
    options.workflowRunTimeout = "120s";

    // If jobRunId is set in config, this is a retry run - use RetryMigrationWorkflow
    if (jobRunConfig.jobRunId) {
      const startWorkFlowPayload: StartWorkFlowPayload = {
        workflowId: `${WorkFlows.RETRY}-${jobRunId}`,
        taskQueue: "ParentWorkflow-TaskQueue",
        args: [{ traceId: jobRunId, payload: jobRunConfig, options }],
        options,
      };
      await this.workFlowService.startWorkflow(WorkFlows.RETRY, startWorkFlowPayload);
      await this.startStreamConsumer(jobRunId, projectId);
      return;
    }

    switch (jobRunConfig.jobType) {
      case JobType.DISCOVER: {
        const startWorkFlowPayload: StartWorkFlowPayload = {
          workflowId: WorkFlows.DISCOVERY + "-" + jobRunId,
          taskQueue: "ParentWorkflow-TaskQueue",
          args: [
            { traceId: jobRunId, payload: jobRunConfig, options: options },
          ],
          options: options,
        };

        await this.workFlowService.startWorkflow(
          WorkFlows.DISCOVERY,
          startWorkFlowPayload,
        );
        break;
      }
      case JobType.SPEED_TEST: {
        const speedTestJobConfig = await this.getFileServerDetails(jobRunId);
        const startWorkFlowPayload: StartWorkFlowPayload = {
          workflowId: WorkFlows.SPEED_TEST + "-" + jobRunId,
          taskQueue: "ParentWorkflow-TaskQueue",
          args: [
            {
              traceId: jobRunId,
              payload: speedTestJobConfig,
              options: options,
            },
          ],
          options: options,
        };

        await this.workFlowService.startWorkflow(
          WorkFlows.SPEED_TEST,
          startWorkFlowPayload,
        );
        break;
      }

      case JobType.CUT_OVER: {
        const startWorkFlowPayload: StartWorkFlowPayload = {
          workflowId: WorkFlows.CUT_OVER + "-" + jobRunId,
          taskQueue: "ParentWorkflow-TaskQueue",
          args: [
            { traceId: jobRunId, payload: jobRunConfig, options: options },
          ],
          options: options,
        };
        await this.workFlowService.startWorkflow(
          WorkFlows.CUT_OVER,
          startWorkFlowPayload,
        );
        await this.jobConfigRepo.update(
          {
            sourcePathId: jobRunConfig.connection.sourceCredential.pathId,
            targetPathId: jobRunConfig.connection.targetCredential.pathId,
            jobType: JobType.MIGRATE,
          },
          { status: JobStatus.InActive },
        );
        break;
      }

      default: {
        const startWorkFlowPayload: StartWorkFlowPayload = {
          workflowId: `${WorkFlows.MIGRATE}-${jobRunId}`,
          taskQueue: "ParentWorkflow-TaskQueue",
          args: [
            { traceId: jobRunId, payload: jobRunConfig, options: options },
          ],
          options: options,
        };
        await this.workFlowService.startWorkflow(
          WorkFlows.MIGRATE,
          startWorkFlowPayload,
        );
        break;
      }
    }
    await this.startStreamConsumer(jobRunId, projectId);
  }
  // TODO deprecated, remove later
  // ------------------ BuildJobContext for SpeedTest -------------------- //
  async buildSpeedTestJobContext(jobRunId: string, jobRunConfig: JobRunConfig) {
    const jobRun = await this.jobRunRepo.findOne({
      where: { id: jobRunId },
      relations: ["jobConfig"],
    });
    if (!jobRun) {
      throw new Error(`JobRun with id ${jobRunId} not found`);
    }
    const jobConfig = new SpeedTestJobConfig(jobRunId, jobRunConfig.jobType);
    const jobState: JobState = new JobState(
      [],
      0,
      1,
      [],
      JobContextStatus.Pending,
      [],
    );
    const redisProvider = JobContextFactory.getSpeedTestProvider(
      "redis",
      await this.redisService.getClient(),
    );
    const jobContext = await redisProvider.buildContext(
      jobRunId,
      jobConfig,
      JobRunStatus.Ready,
      jobState,
    );
    this.redisService.setJobContext(jobRunId, jobContext);
  }

  // ------------------ BuildJobContext -------------------- //
  async buildJobContext(jobRunId: string, jobRunConfig: JobRunConfig) {
    let sourcefileServerDetails: FileServerDetails;
    let targetfileServerDetails: FileServerDetails;
    const redisClient = await this.redisService.getClient();
    let isIdentityMapping = false;

    const sourceCredential = jobRunConfig.connection.sourceCredential;
    const targetCredential = jobRunConfig.connection.targetCredential;

    const createFileServerDetails = (credential: any) => {
      return credential.protocol === Protocol.NFS
        ? new FileServerDetails(
            credential.host,
            [new NFS(credential.username)],
            credential.pathId,
            credential.path,
            credential?.username,
            credential?.password,
            credential?.workingDirectory,
            credential.protocolVersion,
          )
        : new FileServerDetails(
            credential.host,
            [new SMB(credential.username, credential.password)],
            credential.pathId,
            credential.path,
            credential?.username,
            credential?.password,
            credential?.workingDirectory,
            credential.protocolVersion,
          );
    };
    sourcefileServerDetails = createFileServerDetails(sourceCredential);

    if (jobRunConfig.jobType !== JobType.DISCOVER)
      targetfileServerDetails = createFileServerDetails(targetCredential);
    if (
      jobRunConfig.jobType === JobType.MIGRATE ||
      jobRunConfig.jobType === JobType.CUT_OVER
    ) {
      if (jobRunConfig.id) {
        const identityCrossMappings =
          await this.identityConfigCrossMappingRepo.find({
            where: { jobConfigId: jobRunConfig.id, isOrphan: false },
          });
        if (identityCrossMappings.length > 0) {
          isIdentityMapping = true;
        }
        const identityMappingIds = identityCrossMappings.map(
          (crossMapping) => crossMapping.identityMappingId,
        );
        const identityMappings = await this.identityMappingRepo.findBy({
          identityMap: In(identityMappingIds),
        });
        const readable = new Readable({
          read() {
            identityMappings.forEach((row) => this.push(JSON.stringify(row)));
            this.push(null);
          },
        });
        readable.on("data", async (mapping) => {
          mapping = JSON.parse(mapping);
          const mapType =
            mapping.identityType.toLowerCase() === "sid"
              ? IdentityTypes.SID
              : mapping.identityType.toLowerCase() === "gid"
                ? IdentityTypes.GID
                : IdentityTypes.UID;

          const redisKey = `${jobRunId}:mapping`;
          const hashField = `${mapType}:${mapping.sourceMapping}`;
          const hashValue = mapping.targetMapping;

          if (!redisClient.isOpen) await redisClient.connect();

          await redisClient.hSet(redisKey, hashField, hashValue);
          this.logger.log(
            `Stored in Redis: ${redisKey} -> ${hashField}: ${hashValue}`,
          );
        });
        readable.on("end", () => {
          this.logger.log("Stream processing completed.");
        });
      }
    }
    const jobConfig = new JobConfig(
      jobRunId,
      jobRunConfig.jobType,
      sourcefileServerDetails,
      jobRunConfig.connection.sourceCredential.path,
      jobRunConfig.jobType !== JobType.DISCOVER
        ? targetfileServerDetails
        : undefined,
      jobRunConfig.jobType !== JobType.DISCOVER
        ? jobRunConfig.connection.targetCredential.path
        : undefined,
      jobRunConfig.workers,
      {
        excludeFilePattern: jobRunConfig.excludeFilePatterns,
        preserveAccessTime: jobRunConfig.preserveAccessTime,
        shouldScanADS: jobRunConfig.shouldScanADS ?? false,
        skipsFilesModifiedInLast: jobRunConfig?.skipFile,
        excludeOlderThan: !!jobRunConfig.excludeOlderThan
          ? jobRunConfig.excludeOlderThan.toString()
          : "",
        isIdentityMappingAvailable: isIdentityMapping,
      },
      jobRunConfig.skipDelete,
      jobRunConfig.jobRunId,  // Pass retry job run ID if this is a retry
    );
    const redisProvider = JobContextFactory.getJobManagerProvider("redis", redisClient);
    const jobContext = await redisProvider.buildContext(
      jobRunId,
      jobConfig,
      JobRunStatus.Ready,
    );
    await this.redisService.setJobContext(jobRunId, jobContext);
    this.logger.debug("JobContext Saved to Redis");
  }


  // ------------------ StartStreamConsumer -------------------- //
  async startStreamConsumer(jobRunId: string, projectId?: string) {
    this.logger.log("Starting Stream Consumer for jobRunId:", jobRunId);
    try {
      const START_CONSUMER_URL = this.configService.get<string>(
        "app.paths.startConsumer",
      );
      let response = await axios.post(
        `${START_CONSUMER_URL}/api/v1/redis-consumer/start`,
        { jobRunId },
        { 
          headers: { 
            'projectId': projectId,
            'trackId': jobRunId,
          } 
        }
      );

      let count = 0;
      while (response.status !== 200 && count < 3) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        response = await axios.post(
          `${START_CONSUMER_URL}/api/v1/redis-consumer/start`,
          { jobRunId },
          { 
            headers: { 
              'projectId': projectId,
              'trackId': jobRunId,
            } 
          }
        );

        this.logger.log(`Retry attempt ${count + 1} for ${jobRunId}:`, {
          status: response.status,
          statusText: response.statusText,
          data: response.data,
        });

        count++;
      }
      this.logger.log(
          `Redis consumer response for ${jobRunId}:`,
          {
            status: response.status,
            statusText: response.statusText,
            data: response.data,
          },
      );
      if (response.status !== 200) {
        this.logger.error(
          `Failed to start consumer after retries for ${jobRunId}:`,
          {
            status: response.status,
            statusText: response.statusText,
            data: response.data,
          },
        );
        throw new Error(
          `Failed to start consumer after retries. Status: ${response.status}, Response: ${JSON.stringify(response.data, null, 2)}`,
        );
      }

      const responseData = response.data;
      
      const success = responseData.data?.items?.success || false;
      
      return {
        success: success,
        message: responseData.message || "Consumer started successfully."
      };
    } catch (error) {
      this.logger.error(
        `Failed to start consumer for ${jobRunId}:`,
        error.message,
      );
      throw new Error(
        `Failed to start consumer for ${jobRunId}: ${error.message}`,
      );
    }
  }

}
