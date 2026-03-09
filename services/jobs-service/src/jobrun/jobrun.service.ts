import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
  InternalServerErrorException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { formatBytes } from "@netapp-cloud-datamigrate/jobs-lib";
import * as parser from "cron-parser";
import {
  CutOverStatus,
  JobRunStatus,
  JobRunType,
  JobStatus,
  JobType,
  PausedReason,
  WorkFlows,
  WorkerStatus,
  USER_VISIBLE_ERROR_TYPES,
  TERMINAL_JOB_RUN_STATUSES,
} from "src/constants/enums";
import { ScheduleStatus } from "src/constants/status";
import { InventoryEntity } from "src/entities/inventory.entity";
import { JobConfigEntity } from "src/entities/jobconfig.entity";
import { OperationErrorEntity } from "src/entities/operation-error.entity";
import { IdentityMappingEntity } from "src/entities/indentity-mapping.entity";
import { OperationsEntity } from "src/entities/operation.entity";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import { ErrorRemedyService } from "src/errorremedies/errorremedies.service";
import { RedisService } from "src/redis/redis.service";
import { SendMailService } from "src/utils/send-email";
import { WorkersService } from "src/workers/workers.service";
import { WorkflowService } from "src/workflow/workflow.service";
import { SignalWorkFlowPayload } from "src/workflow/workflow.types";
import { DataSource, EntityManager, FindManyOptions, Raw, Repository, UpdateResult } from "typeorm";
import { JobRunEntity } from "../entities/jobrun.entity";
import { JobRunDetailsDTO, JobRunDto, JobRunsDTO } from "./dto/jobrun.dto";
import { ApprovalRequestDTO } from "./dto/jobrunactions.dto";
import { JobErrorQueryDto } from "./dto/jobRunErrors.dto";
import { JobRunPageDto } from "./dto/jobrunpage.dto";
import { JobRunStats } from "./dto/jobstats";
import { JobRunInitService } from "./jobrun.init.service";
import { SuccessEmailType } from "src/utils/send-email.type";
import { getErrorDisplayMessage } from "./jobrun.util";
import { WorkFlowFailureReason } from "./jobrun.types";
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { MigrationConflictService } from "src/migration-conflict/migration-conflict.service";
import { JobStatsSummaryMvEntity } from "src/entities/job-stats-summary-mv.entity";
import { ProjectEntity } from "src/entities/project.entity";

@Injectable()
export class JobRunService {
  private readonly logger: LoggerService;
  private readonly mountBasePath: string;
  private readonly emailEnabled: boolean;

  constructor(
    @InjectRepository(JobRunEntity)
    private jobRunRepo: Repository<JobRunEntity>,
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
    @InjectRepository(WorkerJobRunMap)
    private workerJobRunMapRepo: Repository<WorkerJobRunMap>,
    @InjectRepository(InventoryEntity)
    private inventoryRepo: Repository<InventoryEntity>,
    @InjectRepository(IdentityMappingEntity)
    private identityMappingRepo: Repository<IdentityMappingEntity>,
    @InjectRepository(OperationsEntity)
    private operationRepo: Repository<OperationsEntity>,
    @InjectRepository(OperationErrorEntity)
    private operationErrorRepo: Repository<OperationErrorEntity>,
    private readonly configService: ConfigService,
    private readonly jobRunInitService: JobRunInitService,
    private readonly redisService: RedisService,
    private workFlowService: WorkflowService,
    private sendMailService: SendMailService,
    private errorRemedyService: ErrorRemedyService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly workerService: WorkersService,
    private readonly migrationConflictService: MigrationConflictService,
    @InjectRepository(JobStatsSummaryMvEntity)
    private jobStatsSummaryMvRepo: Repository<JobStatsSummaryMvEntity>,
    @InjectRepository(ProjectEntity)
    private projectRepo: Repository<ProjectEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {
    this.logger = loggerFactory.create(JobRunService.name);
    this.mountBasePath = this.configService.get<string>(
      "app.paths.mountBasePath"
    );
    this.emailEnabled = this.configService.get<boolean>('app.email.enabled', true);
  }

  async cutOverApproval(jobRunId: string, status: CutOverStatus) {
    const jobRun = await this.jobRunRepo.findOne({
      where: { id: jobRunId },
      relations: { jobConfig: true },
    });
    if (!jobRun) throw new NotFoundException(`Job Run ${jobRunId} not found`);
    if (status === CutOverStatus.REJECTED) {
      await this.jobConfigRepo.update(
        {
          sourcePathId: jobRun.jobConfig.sourcePathId,
          targetPathId: jobRun.jobConfig.targetPathId,
          jobType: JobType.MIGRATE,
        },
        { status: JobStatus.Active }
      );

      await this.jobConfigRepo.update(
        {
          sourcePathId: jobRun.jobConfig.sourcePathId,
          targetPathId: jobRun.jobConfig.targetPathId,
          jobType: JobType.CUT_OVER,
        },
        {
          scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED,
          futureScheduleAt: null,
        }
      );
    } else {
      await this.jobConfigRepo.update(
        {
          sourcePathId: jobRun.jobConfig.sourcePathId,
          targetPathId: jobRun.jobConfig.targetPathId,
          jobType: JobType.CUT_OVER,
        },
        {
          status: JobStatus.InActive,
          scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED,
          futureScheduleAt: null,
        }
      );
    }
    await this.jobRunRepo.update(
      { id: jobRunId },
      { status: JobRunStatus.Completed, subStatus: status }
    );
    // TO-DO: keeping for future use
    // const jobContext = await this.redisService.getJobContext(jobRunId);
    // if (jobContext) {
    //   jobContext.cleanup();
    //   this.logger.log(`Job Context for ${jobRunId} cleaned up`);
    // }
  }

  async approveCutoverRequest(approvalRequest: ApprovalRequestDTO) {
    const signal: SignalWorkFlowPayload = {
      payload: approvalRequest.action,
      signalName: "approve",
      workflowId: `${WorkFlows.CUT_OVER}-${approvalRequest.jobRunId}`,
    };
    return await this.workFlowService.sendSignal(signal);
  }

  // ------------------ Ad-hoc Run Orchestrator -------------------- //
  /**
   * Orchestrator method for creating ad-hoc or retry job runs.
   * Routes to appropriate handler based on whether jobRunId is provided.
   */
  async addHocRun(jobConfigId: string, projectId?: string, jobRunId?: string) {
    // Common validation for job config
    const jobConfig = await this.validateJobConfig(jobConfigId);

    // Route to retry run if jobRunId is provided, otherwise create fresh ad-hoc run
    if (jobRunId) {
      console.log("Retrying ad-hoc run for jobRunId:", jobRunId);
      return this.retryRun(jobConfig, projectId, jobRunId);
    }

    // Create fresh ad-hoc job run
    this.logger.log(`Creating ad-hoc job run for job config ${jobConfigId}`);
    return await this.jobRunInitService.createJobRun(jobConfig.id, new Date(), projectId);
  }

  // ------------------ Common Job Config Validation -------------------- //
  /**
   * Validates job config for both ad-hoc and retry runs.
   * Checks: exists, not inactive, no circular dependencies.
   */
  private async validateJobConfig(jobConfigId: string): Promise<JobConfigEntity> {
    const jobConfig = await this.jobConfigRepo.findOne({
      where: { id: jobConfigId },
    });
    if (!jobConfig)
      throw new NotFoundException(
        `Job config id doesn't exist for id ${jobConfigId}`
      );
    if (jobConfig.scheduler === ScheduleStatus.SCHEDULED)
      throw new BadRequestException(
        `Job run is already created for ${jobConfigId}`
      );
    if (jobConfig.status === JobStatus.InActive)
      throw new BadRequestException(
        `Job run can not be created to Inactive Job Config`
      );

    // Check for circular dependencies in MIGRATE/CUT_OVER jobs
    if (
      jobConfig.jobType === JobType.CUT_OVER ||
      jobConfig.jobType === JobType.MIGRATE
    ) {
      const circularDependencies =
        await this.migrationConflictService.checkMigrationConflicts({
          migrateConfigs: [
            {
              sourcePathId: jobConfig.sourcePathId,
              sourceDirectoryPath: jobConfig.sourceDirectoryPath,
              destinationDirectoryPath: jobConfig.targetDirectoryPath,
              destinationPathId: [jobConfig.targetPathId],
            },
          ],
        });
      if (circularDependencies && circularDependencies.length > 0) {
        const conflictTypes = [...new Set(circularDependencies.map(c => c.conflictType))];
        const conflictMessage = conflictTypes.length === 1 
          ? `${conflictTypes[0].charAt(0).toUpperCase() + conflictTypes[0].slice(1)} conflict detected`
          : `Migration conflicts detected (${conflictTypes.join(', ')})`;
        
        throw new BadRequestException(
          `${conflictMessage} for job config ${jobConfigId}`,
          {
            cause: circularDependencies,
          }
        );
      }
    }

    return jobConfig;
  }

  // ------------------ Retry Run -------------------- //
  /**
   * Creates a retry job run for failed operations from a previous job run.
   * Validates: job run exists, belongs to job config, is the latest run, is in terminal state, is MIGRATE or CUT_OVER type.
   */
  private async retryRun(
    jobConfig: JobConfigEntity,
    projectId: string | undefined,
    jobRunId: string
  ) {
    // First, validate the provided jobRunId exists and belongs to this job config
    const requestedJobRun = await this.jobRunRepo.findOne({
      where: { id: jobRunId, jobConfigId: jobConfig.id },
    });

    if (!requestedJobRun) {
      throw new NotFoundException(
        `Job run ${jobRunId} not found or does not belong to job config ${jobConfig.id}`
      );
    }

    // Get the latest non-retry job run for this job config
    const latestJobRun = await this.jobRunRepo
      .createQueryBuilder("jr")
      .leftJoinAndSelect("jr.jobConfig", "jc")
      .where("jr.jobConfigId = :jobConfigId", { jobConfigId: jobConfig.id })
      .andWhere("jr.jobRunType != :retryRunType", { retryRunType: JobRunType.RETRY })
      .orderBy("jr.startTime", "DESC")
      .getOne();

    // Validate the provided jobRunId matches the latest non-retry job run
    if (latestJobRun.id !== jobRunId) {
      throw new BadRequestException(
        `Job run ${jobRunId} is not the latest run for this job config. Latest job run is ${latestJobRun.id}`
      );
    }

    // Only allow retry for MIGRATE and CUT_OVER jobs
    const retryableJobTypes = [JobType.MIGRATE, JobType.CUT_OVER];
    if (!retryableJobTypes.includes(latestJobRun.jobConfig.jobType)) {
      throw new BadRequestException(
        `Retry is only supported for MIGRATE and CUT_OVER jobs. Current job type: ${latestJobRun.jobConfig.jobType}`
      );
    }

    const operationErrorCount = await this.operationErrorRepo
      .createQueryBuilder("oe")
      .innerJoin("oe.operation", "o")
      .where("o.jobRunId = :jobRunId", { jobRunId })
      .andWhere("oe.errorStatus = :status", { status: 'UNRESOLVED' })
      .andWhere("oe.errorType IN (:...errorTypes)", {
        errorTypes: ["TRANSIENT_ERROR", "FATAL_ERROR"],
      })
      .getCount();

    if (operationErrorCount === 0) {
      throw new BadRequestException(
        `No failed operations found for job run ${jobRunId}. Nothing to retry.`
      );
    }

    this.logger.log(
      `Creating retry job run for original job run ${jobRunId} under job config ${jobConfig.id}`
    );

    return await this.jobRunInitService.createJobRun(
      jobConfig.id,
      new Date(),
      projectId,
      jobRunId
    );
  }

  // ------------------ Get Failed Operations -------------------- //
  async getFailedOperations(
    jobRunId: string,
    cursor: string | null,
    limit: number = 4000
  ): Promise<{ data: Record<string, any>[]; nextCursor: string | null }> {
    const qb = this.operationErrorRepo
      .createQueryBuilder("oe")
      .innerJoin("oe.operation", "o")
      .select("oe.id", "operationErrorId")
      .addSelect("o.fPath", "filePath")
      .addSelect("oe.operationId", "operationId")
      .where("o.jobRunId = :jobRunId", { jobRunId })
      .andWhere("oe.errorStatus = :status", { status: "UNRESOLVED" })
      .andWhere("oe.errorType IN (:...errorTypes)", {
        errorTypes: ["TRANSIENT_ERROR", "FATAL_ERROR"],
      })
      .orderBy("o.fPath", "ASC")
      .addOrderBy("oe.id", "ASC")
      .take(limit + 1);

    if (cursor) {
      const [cursorFilePath, cursorId] = cursor.split("|");
      qb.andWhere(
        "(o.fPath > :cursorPath OR (o.fPath = :cursorPath AND oe.id > :cursorId))",
        { cursorPath: cursorFilePath, cursorId }
      );
    }

    const results = await qb.getRawMany();

    const hasMore = results.length > limit;
    const data = hasMore ? results.slice(0, limit) : results;
    const last = data.at(-1);
    const nextCursor = hasMore ? `${last!.filePath}|${last!.operationErrorId}` : null;

    const operations = data.map(
      (row: { operationId: string; filePath: string }) => ({
        id: row.operationId,
        fPath: row.filePath,
      })
    );

    return { data: operations, nextCursor };
  }

  //  ------------------- get JobRun Details ------------------ //
  /**
   *
   * @param id @todo: Deprecate this, not being used
   * @param data
   * @returns
   */
  async updateJobRun(id: string, data: Partial<JobRunDto>): Promise<JobRunDto> {
    const jobRun = await this.jobRunRepo.findOne({ where: { id } });
    if (!jobRun) throw new Error(`Job run with id ${id} not found`);
    Object.assign(jobRun, data);
    return this.jobRunRepo.save(jobRun);
  }

  //  ------------------- get JobRun Details ------------------ //
  async getJobRun(id: string): Promise<JobRunDetailsDTO> {
    const jobRun = await this.jobRunRepo.findOne({
      select: {
        id: true,
        status: true,
        subStatus: true,
        startTime: true,
        endTime: true,
        jobConfigId: true,
        jobRunType: true,
        jobStats: {
          fileCount: true,
          directories: true,
          totalSize: true,
        },
        tasks: {
          id: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          taskType: true,
          workerId: true,
          worker: {
            workerName: true,
          },
        },
      },
      where: { id },
      relations: ["tasks", "tasks.worker"],
    });
    if (!jobRun) throw new Error(`Job run with id ${id} not found`);
    const jobConfigDetails = await this.jobConfigRepo.findOne({
      where: { id: jobRun.jobConfigId },
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

    const partialPayload = {
      jobRunId: jobRun.id,
      jobConfigId: jobRun.jobConfigId,
      status: jobRun.subStatus || jobRun.status,
      startTime: jobRun.startTime,
      endTime: jobRun.endTime,
      jobType: jobConfigDetails.jobType,
      jobRunType: jobRun.jobRunType || JobRunType.REGULAR,
      sourceServer: {
        serverName: jobConfigDetails.sourcePath.fileServer.config.configName,
        path: jobConfigDetails.sourcePath.volumePath,
        protocol: jobConfigDetails.sourcePath.fileServer.protocol,
      },
      destinationServer: jobConfigDetails.targetPath
        ? {
            serverName:
              jobConfigDetails.targetPath.fileServer.config.configName,
            path: jobConfigDetails.targetPath.volumePath,
            protocol: jobConfigDetails.targetPath.fileServer.protocol,
          }
        : undefined,
      timeElapsed: jobRun.endTime
        ? jobRun.endTime.getTime() - jobRun.startTime.getTime()
        : Date.now() - jobRun.startTime.getTime(),
    };
    if (jobRun.status === JobRunStatus.Completed) {
      this.logger.log(`Reading job stats for ${jobRun.id} from stats column`);
      const inventoryStats: JobRunStats = jobRun.jobStats;
      this.logger.log(
        `Job Run ${jobRun.id} inventory stats ${JSON.stringify(inventoryStats)}`
      );
      const payload = {
        scannedFilesCount: BigInt(inventoryStats?.fileCount || "0")?.toString(),
        scannedDirectoriesCount: BigInt(
          inventoryStats?.directories || "0"
        )?.toString(),
        totalScannedSize:
          jobConfigDetails.jobType === JobType.DISCOVER
            ? formatBytes(Number(inventoryStats?.totalSize || "0"))
            : "0 B",
        totalMigratedSize:
          jobConfigDetails.jobType === JobType.MIGRATE
            ? formatBytes(Number(inventoryStats?.totalSize || "0"))
            : "0 B",
        errors: await this.getErrorCounts(jobRun.id),
        tasks: jobRun.tasks.map((task) => ({
          taskId: task.id,
          taskType: task.taskType,
          status: task.status,
          startTime: task.createdAt,
          endTime: task.updatedAt,
          worker: task.worker.workerName,
          errors: [],
        })),
      };
      const response: JobRunDetailsDTO = {
        ...partialPayload,
        ...payload,
      };
      return response;
    }
    this.logger.log(`Calculating job stats for ${jobRun.id}`);
    const inventoryCounts: JobRunStats = await this.calculateJobRunStats(
      jobRun.id
    );

    const jobRunDetails: JobRunDetailsDTO = {
      ...partialPayload,
      scannedFilesCount: BigInt(inventoryCounts?.fileCount || "0")?.toString(),
      scannedDirectoriesCount: BigInt(
        inventoryCounts?.directories || "0"
      )?.toString(),
      totalScannedSize:
        jobConfigDetails.jobType === JobType.DISCOVER
          ? formatBytes(Number(inventoryCounts?.totalSize || "0"))
          : "0 B",
      totalMigratedSize:
        jobConfigDetails.jobType === JobType.MIGRATE
          ? formatBytes(Number(inventoryCounts?.totalSize || "0"))
          : "0 B",
      errors: await this.getErrorCounts(id),
      tasks: jobRun.tasks.map((task) => ({
        taskId: task.id,
        taskType: task.taskType,
        status: task.status,
        startTime: task.createdAt,
        endTime: task.updatedAt,
        worker: task.worker.workerName,
        errors: [],
      })),
    };
    return jobRunDetails;
  }

  async findAllJobRuns(jobRunPageDto: JobRunPageDto) {
    const {
      page,
      limit,
      sort = "createdAt",
      order = "ASC",
      ...filter
    } = jobRunPageDto;

    const findOptions: FindManyOptions<JobRunEntity> = {
      where: filter,
      order: { [sort]: order },
    };

    let data = [],
      total = 0;
    if (page && limit) {
      findOptions.skip = (parseInt(page) - 1) * parseInt(limit);
      findOptions.take = parseInt(limit);
      data = await this.jobRunRepo.find(findOptions);
      total = await this.jobRunRepo.count({ where: filter });
    } else {
      data = await this.jobRunRepo.find(findOptions);
      total = await this.jobRunRepo.count({ where: filter });
    }
    return { data, total };
  }

  async getJobAllRuns(filter: JobRunPageDto) {
    const jobRuns = await this.jobRunRepo
      .createQueryBuilder("jobRun")
      .leftJoinAndSelect("jobRun.jobConfig", "jobConfig")
      .leftJoinAndSelect("jobConfig.sourcePath", "sourceVolume")
      .leftJoinAndSelect("jobConfig.targetPath", "targetVolume")
      .leftJoinAndSelect("sourceVolume.fileServer", "sourceFileServer")
      .leftJoinAndSelect("targetVolume.fileServer", "targetFileServer")
      .leftJoinAndSelect("sourceFileServer.config", "sourceConfig")
      .leftJoinAndSelect("targetFileServer.config", "targetConfig")
      .where("sourceConfig.projectId = :projectId", {
        projectId: filter.projectId,
      })
      .orWhere("targetConfig.projectId = :projectId", {
        projectId: filter.projectId,
      })
      .select([
        "jobRun.id AS jobRunId",
        "jobRun.isReportReady AS isReportReady",
        "jobRun.jobRunType AS jobRunType",
        "jobConfig.jobType AS jobType",
        "jobConfig.id AS jobConfigId",
        "jobConfig.futureScheduleAt AS nextSchedule",
        "sourceVolume.volumePath AS volumePath",
        "sourceFileServer.protocol AS sourceFileServerProtocol",
        "sourceFileServer.fileServerName AS sourceFileServerName",
        "jobConfig.sourceDirectoryPath AS sourceDirectoryPath",
        "jobConfig.targetDirectoryPath AS targetDirectoryPath",
        "sourceConfig.configName AS sourceConfigName",
        "sourceConfig.serverType AS sourceServerType",
        "targetVolume.volumePath AS targetVolumePath",
        "targetFileServer.protocol AS targetFileServerProtocol",
        "targetFileServer.fileServerName AS targetFileServerName",
        "targetConfig.serverType AS targetServerType",
        "targetConfig.configName AS targetConfigName",
        "jobRun.subStatus AS subStatus",
        "jobRun.status AS status",
        "jobRun.startTime AS startTime",
        "jobRun.endTime AS endTime",
        "jobRun.jobStats AS jobStats",
      ])
      .getRawMany();

    const allJobsRuns = await Promise.all(
      jobRuns.map(async (jobRun) => {
        this.logger.debug(
          `jobRun for id ${jobRun.jobrunid} - with jobstats ${JSON.stringify(jobRun.jobstats)}`
        );
        const partialJobRunStats = {
          jobRunId: jobRun.jobrunid,
          status: jobRun.substatus || jobRun.status,
          startTime: jobRun.starttime,
          endTime: jobRun.endtime,
          jobType: jobRun.jobtype,
          jobRunType: jobRun.jobruntype || JobRunType.REGULAR,
          isReportReady: jobRun.isreportready,
          jobConfigId: jobRun?.jobconfigid,
          nextSchedule: jobRun?.nextschedule,
          sourceServer: {
            serverName: jobRun.sourceconfigname,
            fileServerName: jobRun.sourcefileservername,
            path: jobRun.volumepath,
            protocol: jobRun.sourcefileserverprotocol,
            serverType: jobRun.sourceservertype,
            directoryPath: jobRun.sourcedirectorypath,
          },
          destinationServer: jobRun.targetvolumepath
            ? {
                serverName: jobRun.targetconfigname,
                fileServerName: jobRun.targetfileservername,
                path: jobRun.targetvolumepath,
                protocol: jobRun.targetfileserverprotocol,
                serverType: jobRun.targetservertype,
                directoryPath: jobRun.targetdirectorypath,
              }
            : undefined,
          timeElapsed: jobRun.endtime
            ? jobRun.endtime.getTime() - jobRun.starttime.getTime()
            : Date.now() - jobRun.starttime.getTime(),
        };
       
          const isTerminal = TERMINAL_JOB_RUN_STATUSES.includes(jobRun.status);

          let jobStats: JobRunStats;
          if (isTerminal && jobRun.jobstats) {
            this.logger.log(`Job Run ${jobRun.jobrunid} using persisted jobStats`);
            jobStats = jobRun.jobstats;
          } else {
            jobStats = await this.calculateJobRunStats(jobRun.jobrunid);
          }
          this.logger.log(`Job Run ${jobRun.jobrunid} status ${jobRun.status}`);
          this.logger.log(
            `Job Run ${jobRun.jobrunid} inventory stats ${JSON.stringify(
              jobStats
            )}`
          );
          const response: JobRunsDTO = {
            ...partialJobRunStats,
            scannedFilesCount: BigInt(
              jobStats?.fileCount || "0"
            )?.toString(),
            scannedDirectoriesCount: BigInt(
              jobStats?.directories || "0"
            )?.toString(),
            totalScannedSize:
              jobRun.jobtype === JobType.DISCOVER
                ? formatBytes(Number(jobStats?.totalSize || "0"))
                : "0 B",
            totalMigratedSize:
              (jobRun.jobtype === JobType.MIGRATE || jobRun.jobtype === JobType.CUT_OVER)
                ? formatBytes(Number(jobStats?.totalSize || 0))
                : "0 B",
            errors: jobStats?.errors || [],
            lastRefreshed: jobStats?.lastRefreshed || null,
          };
          return response;
        
      })
    );
    return allJobsRuns;
  }

  async updateJobRunStatus(
    jobRunId: string, 
    status: JobRunStatus, 
    projectId?: string,
    passedStats?: { fileCount?: number; dirCount?: number; totalSize?: string }
  ) {
    const jobRunDetails: JobRunEntity = await this.jobRunRepo.findOne({
      where: { id: jobRunId },
    });
    if (!jobRunDetails)
      throw new Error(`Job run with id ${jobRunId} not found`);
    const jobConfig = await this.jobConfigRepo.findOne({
      where: { id: jobRunDetails.jobConfigId },
      relations: {
        sourcePath: { fileServer: true },
        targetPath: { fileServer: true },
      },
    });
    if (status !== JobRunStatus.Running) {
      if (
        jobConfig &&
        jobConfig.futureScheduleAt &&
        jobConfig.jobType === JobType.MIGRATE
      ) {
        try {
          const date = parser
            .parseExpression(jobConfig.futureScheduleAt)
            .next()
            .toDate();
          await this.jobConfigRepo.update(
            { id: jobConfig.id },
            { firstRunAt: date, scheduler: ScheduleStatus.SCHEDULING }
          );
        } catch (e) {
          throw new Error(
            `Invalid cron expression in futureScheduleAt: ${e.message}`
          );
        }
      } else {
        await this.jobConfigRepo.update(
          { id: jobRunDetails.jobConfigId },
          { scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED }
        );
      }
      
      let jobRunStats: JobRunStats;
      if (passedStats && passedStats.fileCount !== undefined && passedStats.dirCount !== undefined && passedStats.totalSize !== undefined) {
        this.logger.log(`Using stats passed from workflow for job run ${jobRunId}: ${JSON.stringify(passedStats)}`);
        jobRunStats = {
          fileCount: passedStats.fileCount.toString(),
          directories: passedStats.dirCount.toString(),
          totalSize: passedStats.totalSize,
          errors: await this.getErrorCounts(jobRunId),
          lastRefreshed: new Date(),
        };
      } else {
        this.logger.log(`No complete stats passed for job run ${jobRunId}, computing from materialized view`);
        jobRunStats = await this.calculateJobRunStats(jobRunId);
      }
      if (
        jobConfig &&
        (jobConfig.jobType === JobType.MIGRATE ||
          jobConfig.jobType === JobType.CUT_OVER)
      ) {
        const errorCodes =
          await this.errorRemedyService.getDistinctErrorCodes(jobRunId);
        if (!!errorCodes.length) {
          // Send error remedy email with error handling
          if (this.emailEnabled) {
            try {
              await this.sendErrorRemedyEmail({
                jobRunId,
                sourcePath: jobConfig.sourcePath?.volumePath,
                targetPath: jobConfig.targetPath?.volumePath,
                sourceHost: jobConfig.sourcePath?.fileServer?.host,
                targetHost: jobConfig.targetPath?.fileServer?.host,
                jobType: jobConfig.jobType,
                errorCodes,
                projectId
              });
              this.logger.log(`Error remedy email sent successfully for job run ${jobRunId}`);
            } catch (emailError) {
              this.logger.error(
                `Failed to send error remedy email for job run ${jobRunId}: ${emailError.message}`,
                emailError
              );
            }
          } else {
            this.logger.log(`Email disabled - skipping error remedy email for job run ${jobRunId}`);
          }
        } else {
          this.logger.log(
            `Job Run ${jobRunId} completed with stats ${JSON.stringify(jobRunStats)}`
          );

          if (this.emailEnabled) {
            try {
              await this.sendMailService.sendMail({
                successEmailType: SuccessEmailType.JOB_UPDATE,
                projectId,
                jobStatusUpdate: {
                  jobType: jobConfig.jobType,
                  jobAction: "completed",
                  sourcePath: {
                    volumePath: jobConfig.sourcePath?.volumePath,
                    fileServer: { host: jobConfig.sourcePath?.fileServer?.host },
                  },
                  targetPath: {
                    volumePath: jobConfig.targetPath?.volumePath,
                    fileServer: { host: jobConfig.targetPath?.fileServer?.host },
                  },
                },
              });
              this.logger.log(`Job completion email sent successfully for job run ${jobRunId}`);
            } catch (emailError) {
              this.logger.error(
                `Failed to send job completion email for job run ${jobRunId}: ${emailError.message}`,
                emailError
              );
            }
          } else {
            this.logger.log(`Email disabled - skipping job completion email for job run ${jobRunId}`);
          }
        }
      }
      this.logger.log("job Run Stats", JSON.stringify(jobRunStats));
      const updateData: Partial<JobRunEntity> = {
        status: status,
        jobStats: jobRunStats,
      };
      if (TERMINAL_JOB_RUN_STATUSES.includes(status)) {
        updateData.endTime = new Date();
      }
      // Update job run status and record ASUP stats in a single transaction
      await this.dataSource.transaction(async (manager) => {
        await manager.update(JobRunEntity, { id: jobRunId }, updateData);
        await this.recordAsupStatsForJobRun(manager, jobRunId, status, projectId, jobRunDetails.jobConfigId, jobRunStats);
      });
    } else {
      if (
        jobConfig &&
        (jobConfig.jobType === JobType.MIGRATE ||
          jobConfig.jobType === JobType.CUT_OVER)
      ) {
        if (this.emailEnabled) {
          try {
            await this.sendMailService.sendMail({
              successEmailType: SuccessEmailType.JOB_UPDATE,
              projectId,
              jobStatusUpdate: {
                jobType: jobConfig.jobType,
                jobAction: "started",
                sourcePath: {
                  volumePath: jobConfig.sourcePath?.volumePath,
                  fileServer: { host: jobConfig.sourcePath?.fileServer?.host },
                },
                targetPath: {
                  volumePath: jobConfig.targetPath?.volumePath,
                  fileServer: { host: jobConfig.targetPath?.fileServer?.host },
                },
              },
            });
            this.logger.log(`Job started email sent successfully for job run ${jobRunId}`);
          } catch (emailError) {
            this.logger.error(
              `Failed to send job started email for job run ${jobRunId}: ${emailError.message}`,
              emailError
            );
          }
        } else {
          this.logger.log(`Email disabled - skipping job started email for job run ${jobRunId}`);
        }
      }
      this.logger.log(`Job Run ${jobRunId} status updated to ${status}`);
      return this.jobRunRepo.update({ id: jobRunId }, { status: status });
    }
  }

  async getJobRunErrors(taskQuery: JobErrorQueryDto) {
    const {
      page = "1",
      limit = "10",
      sort = "createdAt",
      order = "DESC",
      jobRunId,
      errorType,
    } = taskQuery;
    
    // Define allowed sort columns (camelCase from API)
    const SORTABLE_COLUMNS = ['createdAt', 'errorMessage', 'errorType', 'fileName', 'filePath', 'origin', 'operationType', 'errorCode'];

    // Validate and map to SQL column with table prefix
    const sortColumn =
      SORTABLE_COLUMNS.includes(sort)
        ? {
            createdAt: 'oe.created_at',
            errorMessage: 'oe.error_message',
            errorType: 'oe.error_type',
            fileName: 'oe.file_name',
            filePath: 'oe.file_path',
            origin: 'oe.origin',
            operationType: 'oe.operation_type',
            errorCode: 'oe.error_code',
          }[sort]
        : 'oe.created_at';

    const orderClause = order?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    // Uses first 10 chars of file_path as a unique prefix to match and replace
    // the full path with just the relative_file_path.

    const query = `
      SELECT
        oe.id::text AS id,
        CASE
          WHEN oe.file_path IS NOT NULL AND LENGTH(oe.file_path) > 10 THEN
            REGEXP_REPLACE(
              oe.error_message,
              '[''"]?' || REPLACE(SUBSTRING(oe.file_path FROM 1 FOR 10), E'\\\\', E'\\\\\\\\') || '[^''"\\s]*([''".\\s]|$)',
              oe.file_name,
              'g'
            )
          ELSE oe.error_message
        END AS "errorMessage",
        oe.error_type AS "errorType",
        oe.created_at AS "createdAt",
        oe.file_name AS "fileName",
        oe.file_path AS "filePath",
        oe.origin AS "origin",
        oe.operation_type AS "operationType",
        oe.error_code AS "errorCode"
      FROM datamigrator.operation_errors oe
      LEFT JOIN datamigrator.operations o ON o.id = oe.operation_id
      WHERE o.job_run_id = $1 AND oe.error_type = $2 AND oe.error_status = 'UNRESOLVED'
      ORDER BY ${sortColumn} ${orderClause}
      LIMIT $3 OFFSET $4
    `;

    const params = [
      jobRunId,
      errorType,
      parseInt(limit, 10),
      (parseInt(page, 10) - 1) * parseInt(limit, 10),
    ];

    const data = await this.operationErrorRepo.query(query, params);

    // Map errors to include error remedy descriptions
    const mappedData = await Promise.all(
      data.map(async (error) => {
        try {
          const errorRemedies = await this.errorRemedyService.findByErrorCodes([
            error.errorCode,
          ]);
          const errorRemedy = errorRemedies?.[0];

          this.logger.debug(
            `[getJobRunErrors] Mapped errorCode: ${error.errorCode} to remedy: ${errorRemedy ? errorRemedy.description : "none"}`
          );

          return {
            ...error,
            displayMessage: getErrorDisplayMessage(
              error.errorCode,
              error.errorMessage,
              errorRemedy?.description
            ),
            resolutionSteps: errorRemedy ? errorRemedy.resolutionSteps : null,
            referenceCommands: errorRemedy
              ? errorRemedy.referenceCommands
              : null,
          };
        } catch (remedyError) {
          this.logger.error(
            `[getJobRunErrors] Error fetching remedy for code ${error.errorCode}:`,
            remedyError
          );
          return {
            ...error,
            displayMessage: error.errorMessage, // Fallback to original message
            resolutionSteps: null,
            referenceCommands: null,
          };
        }
      })
    );

    const totalResult = await this.operationErrorRepo
      .createQueryBuilder("oe")
      .leftJoin("oe.operation", "o")
      .where("o.jobRunId = :jobRunId", { jobRunId })
      .andWhere("oe.errorType = :errorType", { errorType })
      .andWhere("oe.errorStatus = :status", { status: 'UNRESOLVED' })
      .select("COUNT(*)", "total")
      .getRawOne();

    const total = parseInt(totalResult.total ?? "0", 10);

    if (errorType && errorType === "FATAL_ERROR") {
      const setupFailedErrors = await this.getWorkerSetupErrors(jobRunId);
      if (setupFailedErrors.length > 0) {
        const setupFailedError = await Promise.all(
          setupFailedErrors.map(async (error): Promise<any> => {
            // Also map worker setup errors
            const errorRemedies =
              await this.errorRemedyService.findByErrorCodes([
                error.workerResponse.code,
              ]);
            const errorRemedy = errorRemedies?.[0];
            return {
              errorMessage: error.workerResponse.message,
              displayMessage: getErrorDisplayMessage(
                error?.workerResponse?.code,
                error?.workerResponse?.message,
                errorRemedy?.description
              ),
              resolutionSteps: errorRemedy ? errorRemedy.resolutionSteps : null,
              referenceCommands: errorRemedy
                ? errorRemedy.referenceCommands
                : null,
              errorType: "FATAL_ERROR",
              createdAt: error.workerResponse.createdAt,
              operationType: error.workerResponse.operation,
              errorCode: error.workerResponse.code,
              origin: error.workerResponse.origin,
              occurrence: error.workerResponse.occurrence || 1,
            };
          })
        );
        mappedData.push(...setupFailedError);
      }
      mappedData.sort((a, b) => {
        if (a.errorType === "FATAL_ERROR" && b.errorType !== "FATAL_ERROR") {
          return -1;
        } else if (
          a.errorType !== "FATAL_ERROR" &&
          b.errorType === "FATAL_ERROR"
        ) {
          return 1;
        }
        return 0;
      });
      return { data: mappedData, total: total + setupFailedErrors.length };
    }
    return { data: mappedData, total: total };
  }

  async getErrorOverview(jobRunId: string) {
    return this.getErrorCounts(jobRunId);
  }

  async getErrorCounts(jobRunId: string) {
    const countQuery = this.operationErrorRepo
      .createQueryBuilder("oe")
      .innerJoin("oe.operation", "o")
      .where("o.jobRunId = :jobRunId", { jobRunId })
      .andWhere("oe.errorType IN (:...errorTypes)", { errorTypes: USER_VISIBLE_ERROR_TYPES })
      .andWhere("oe.errorStatus = :status", { status: 'UNRESOLVED' })
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
    const setupFailedErrors = await this.getWorkerSetupErrors(jobRunId);
    if (setupFailedErrors.length > 0) {
      const fatalError = errorTypeCounts.find(
        (error) => error.errortype === "FATAL_ERROR"
      );
      if (fatalError) {
        fatalError.count = Number(fatalError.count) + setupFailedErrors.length;
      } else {
        errorTypeCounts.push({
          errortype: "FATAL_ERROR",
          count: setupFailedErrors.length,
        });
      }
    }
    return errorTypeCounts;
  }

  async calculateJobRunStats(jobRunId: string): Promise<JobRunStats> {
    const jobRun = await this.jobRunRepo.findOne({
      where: { id: jobRunId },
      relations: ["jobConfig"],
    });
    if (!jobRun)
      throw new NotFoundException(`Job Run with id ${jobRunId} not found`);

    const jobStatsSummary: JobStatsSummaryMvEntity = await this.jobStatsSummaryMvRepo.findOne({
      where: { jobRunId: jobRunId }});

    this.logger.debug(
      `[calculateJobRunStats] Calculating job stats for ${jobRunId}  and query result ${JSON.stringify(jobStatsSummary)}`
    );

    const jobRunStatus = {
      fileCount: jobStatsSummary?.fileCount || "0",
      directories: jobStatsSummary?.directoryCount || "0",
      totalSize: jobStatsSummary?.totalSize || "0",
    lastRefreshed: jobStatsSummary?.lastRefreshed || null,
    };

    const response = {
      ...jobRunStatus,
      errors: await this.getErrorCounts(jobRunId),
    };
    return response;
  }

  async sendErrorRemedyEmail({
    jobRunId,
    sourcePath,
    targetPath,
    sourceHost,
    targetHost,
    jobType,
    errorCodes,
    projectId,
  }): Promise<void> {
    if (!errorCodes || errorCodes.length === 0) {
      this.logger.log(`No error codes found for job run ${jobRunId}`);
      return;
    }
    
    try {
      const errorRemedies = await this.errorRemedyService.findByErrorCodes(
        errorCodes.map((error) => error.errorCode)
      );

      await this.sendMailService.sendMail({
        successEmailType: SuccessEmailType.ERROR_REMEDY,
        projectId,
        errorRemedy: {
          jobRunId,
          jobType,
          sourceHost,
          sourcePath,
          targetHost,
          targetPath,
          errorRemedies: errorCodes.map((error) => ({
            code: error.errorCode,
            description: error.description,
            resolutionSteps: error.resolutionSteps,
            referenceCommands: error.referenceCommands,
          })),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send error remedy email for job run ${jobRunId}: ${error.message}`,
        error
      );
      // Re-throw to be handled by the caller
      throw error;
    }
  }

  async checkWorkerHealth() {
    this.logger.log(`Checking the health of workers`);
    try {
      const runningJobRuns = await this.jobRunRepo.find({
        where: [
          { status: JobRunStatus.Running },
          {
            status: JobRunStatus.Paused,
            pausedReason: PausedReason.SYSTEM_PAUSED,
          },
        ],
        relations: {
          workerMap: {
            worker: { stats: true },
          },
        },
      });
      if (!runningJobRuns.length) return;
      for (const jobRun of runningJobRuns) {
        const jobRunId = jobRun.id;
        const workerMap = jobRun.workerMap;
        const workers = workerMap.map((worker) => worker.worker);
        if (workers.length === 0) {
          this.logger.warn(`No workers found for jobRunId: ${jobRunId}`);
          continue;
        }
        const mappedWorkersCount = workers.length;
        const currentWorkerStatus =
          this.workerService.updateWorkerStatus(workers);
        const inactiveCount = currentWorkerStatus.filter(
          (worker) => worker.status === WorkerStatus.Offline
        ).length;
        if (inactiveCount === mappedWorkersCount) {
          this.logger.warn(
            `All workers are offline for jobRunId: ${jobRunId}, thus pausing the job run`
          );
          await this.jobRunRepo.update(
            { id: jobRunId },
            {
              status: JobRunStatus.Paused,
              pausedReason: PausedReason.SYSTEM_PAUSED,
            }
          );
        } else {
          if (jobRun.status === JobRunStatus.Paused) {
            this.logger.log(
              `Resuming job run ${jobRunId} as some workers are online`
            );
            await this.jobRunRepo.update(
              { id: jobRunId },
              {
                status: JobRunStatus.Running,
                pausedReason: null,
              }
            );
          } else {
            this.logger.log(
              `Job run ${jobRunId} is running and some workers are online`
            );
          }
        }
      }
      this.logger.log(`Worker health check completed`);
    } catch (error) {
      this.logger.error(
        `Error occurred while checking worker health: ${error}`
      );
    }
  }

  async updateWorkerResponse(
    jobRunId: string,
    workerId: string,
    workerResponse: Record<string, any>
  ): Promise<UpdateResult> {
    try {
      const updateCondition =
        workerId === "all" ? { jobRunId } : { jobRunId, workerId };
      return await this.workerJobRunMapRepo.update(updateCondition, {
        workerResponse,
      });
    } catch (error) {
      this.logger.error(
        `Error occurred while updating worker response for jobRunId ${jobRunId} and workerId ${workerId}: ${error}`
      );
      throw new Error(`Failed to update worker response: ${error}`);
    }
  }

  async getWorkerSetupErrors(jobRunId: string): Promise<WorkerJobRunMap[]> {
    try {
      const result = await this.workerJobRunMapRepo
        .createQueryBuilder("job")
        .where("job.jobRunId = :jobRunId", { jobRunId })
        .andWhere("job.workerResponse IS NOT NULL")
        .andWhere("job.workerResponse ->> 'code' = ANY(:errorCodes)", {
          errorCodes: Object.values(WorkFlowFailureReason),
        })
        .andWhere("job.workerResponse ->> 'status' = 'FAILED'")
        .getMany();
      return result;
    } catch (error) {
      this.logger.error(
        `Error fetching worker setup errors for jobRunId ${jobRunId}:`,
        error
      );
      throw error;
    }
  }

  async getJobRunIdentityMappings(jobRunId: string): Promise<any> {
    try {
      const jobRun = await this.jobRunRepo.findOne({
        where: { id: jobRunId },
        relations: ["options"],
      });
      if (!jobRun) {
        throw new NotFoundException(`Job Run with id ${jobRunId} not found`);
      }
      const identityMappingId = jobRun.options?.identityMappingId;
      if (!identityMappingId) {
        return {
          data: [],
          message: "No identity mappings found for this job run",
        };
      }
      const identityMappings = await this.identityMappingRepo.findBy({
        identityMap: identityMappingId,
      });
      return {
        data: identityMappings,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Error fetching identity mappings for job run ${jobRunId}:`, error
      );
      throw new InternalServerErrorException(
        `Failed to fetch identity mappings for job run ${jobRunId}`
      );
    }
  }

  /**
   * Record ASUP stats for completed/stopped job runs.
   * Inserts a row into asup_stats using the provided transactional EntityManager.
   * Errors are logged but never thrown (ASUP failure should not roll back job run update).
   */
  private async recordAsupStatsForJobRun(
    manager: EntityManager,
    jobRunId: string,
    status: JobRunStatus,
    projectId: string | undefined,
    jobConfigId: string,
    jobRunStats: JobRunStats,
  ): Promise<void> {
    if (status !== JobRunStatus.Completed && status !== JobRunStatus.Stopped) return;

    const jobConfig = await manager.findOne(JobConfigEntity, {
      where: { id: jobConfigId },
      relations: {
        sourcePath: { fileServer: { config: true } },
        targetPath: { fileServer: { config: true } },
      },
    });
    if (!jobConfig) {
      this.logger.warn(`Cannot record ASUP stats for job run ${jobRunId}: jobConfig not found`);
      return;
    }

    const JOB_TYPE_MAP: Partial<Record<JobType, 'discovery' | 'migration' | 'cutover'>> = {
      [JobType.DISCOVER]: 'discovery',
      [JobType.MIGRATE]: 'migration',
      [JobType.CUT_OVER]: 'cutover',
    };
    const jobType = JOB_TYPE_MAP[jobConfig.jobType];
    if (!jobType) return; 

    this.logger.log(`Recording ASUP stats for job run ${jobRunId} (${status})`);
    try {

      const project = await manager.findOne(ProjectEntity, { where: { id: projectId } });
      const protocol = jobConfig.sourcePath?.fileServer?.protocol;
      const sourceServerType = jobConfig.sourcePath?.fileServer?.config?.serverType || 'N/A';
      const destinationServerType = jobConfig.targetPath?.fileServer?.config?.serverType || 'N/A';

      const dbSchema = process.env.SCHEMA || 'datamigrator';

      await manager.query(
        `INSERT INTO ${dbSchema}.asup_stats (
          job_run_id, job_config_id,
          project_id, project_name,
          job_type, protocol, source_server_type, destination_server_type,
          file_count, size_bytes, transmitted
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE)
        ON CONFLICT (job_run_id) DO UPDATE SET
          file_count = EXCLUDED.file_count,
          size_bytes = EXCLUDED.size_bytes`,
        [
          jobRunId,
          jobConfigId,
          projectId,
          project?.projectName,
          jobType,
          protocol,
          sourceServerType,
          destinationServerType,
          parseInt(jobRunStats.fileCount || '0', 10),
          parseInt(jobRunStats.totalSize || '0', 10),
        ],
      );

      this.logger.log(`Recorded ASUP stats for job run: ${jobRunId}`);
    } catch (asupError) {
      this.logger.error(
        `Failed to record ASUP stats for job run ${jobRunId}: ${(asupError as Error).message}`,
        asupError as Error,
      );
    }
  }
}