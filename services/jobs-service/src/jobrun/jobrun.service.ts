import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { JobStatus as JobContextStatus } from "@netapp-cloud-datamigrate/jobs-lib/dist/types/enums";
import * as parser from "cron-parser";
import {
  CutOverStatus,
  JobRunStatus,
  JobStatus,
  JobType,
  PausedReason,
  WorkFlows,
  WorkerStatus,
} from "src/constants/enums";
import { ScheduleStatus } from "src/constants/status";
import { InventoryEntity } from "src/entities/inventory.entity";
import { JobConfigEntity } from "src/entities/jobconfig.entity";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import { RedisService } from "src/redis/redis.service";
import { WorkflowService } from "src/workflow/workflow.service";
import { SignalWorkFlowPayload } from "src/workflow/workflow.types";
import { FindManyOptions, In, IsNull, Not, Raw, Repository, UpdateResult } from "typeorm";
import { JobRunEntity } from "../entities/jobrun.entity";
import { JobRunDetailsDTO, JobRunDto, JobRunsDTO } from "./dto/jobrun.dto";
import {
  ApprovalRequestDTO,
  JobRunActions,
  JobRunActionsReq,
} from "./dto/jobrunactions.dto";
import { JobRunPageDto } from "./dto/jobrunpage.dto";
import { JobRunInitService } from "./jobrun.init.service";
import { JobRunConfig } from "./jobrun.types";
import { FileInfo } from "@netapp-cloud-datamigrate/jobs-lib";
import { OperationsEntity } from "src/entities/operation.entity";
import { JobErrorQueryDto } from "./dto/jobRunErrors.dto";
import { OperationErrorEntity } from "src/entities/operation-error.entity";
import { JobRunStats } from "./dto/jobstats";
import { SendMailService } from "src/utils/send-email";
import { ErrorRemedyService } from "src/errorremedies/errorremedies.service";
import { WorkersService } from "src/workers/workers.service";
import { formatBytes } from "@netapp-cloud-datamigrate/jobs-lib";
@Injectable()
export class JobRunService {
  private readonly logger = new Logger(JobRunService.name);
  private readonly mountBasePath: string;

  constructor(
    @InjectRepository(JobRunEntity)
    private jobRunRepo: Repository<JobRunEntity>,
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
    @InjectRepository(WorkerJobRunMap)
    private workerJobRunMapRepo: Repository<WorkerJobRunMap>,
    @InjectRepository(InventoryEntity)
    private inventoryRepo: Repository<InventoryEntity>,
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
    private readonly workerService: WorkersService
  ) {
    this.mountBasePath = this.configService.get<string>(
      "app.paths.mountBasePath"
    );
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

  // ------------------ Ad-hoc Run -------------------- //
  async addHocRun(jobConfigId: string) {
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
    return await this.jobRunInitService.createJobRun(jobConfig.id, new Date());
  }

  //  ------------------- JobRun actions ------------------ //
  async actions(jobRunActions: JobRunActionsReq) {
    switch (jobRunActions.action) {
      case JobRunActions.PAUSE:
        return await this.pauseJobRuns(
          jobRunActions.jobRuns,
          PausedReason.USER_PAUSED
        );
      case JobRunActions.STOP:
        return await this.stopJobRuns(jobRunActions.jobRuns);
      case JobRunActions.RESUME:
        return await this.resumeJobRuns(jobRunActions.jobRuns);
      default:
        throw new BadRequestException("Invalid Action Type");
    }
  }

  //  ------------------- JobRun actions PAUSE ------------------ //
  async pauseJobRuns(jobRuns: string[], reason?: PausedReason) {
    await this.workerJobRunMapRepo.update(
      { jobRunId: In(jobRuns) },
      { isActive: false }
    );
    await this.jobRunRepo.update(
      { id: In(jobRuns) },
      { status: JobRunStatus.Paused, pausedReason: reason }
    );
    for (const jobRunId of jobRuns) {
      const jobContext = await this.redisService.getJobContext(jobRunId);
      jobContext.jobState.status = JobContextStatus.Paused;
      await this.redisService.setJobContext(jobRunId, jobContext);
    }
    return { details: "Operation Completed Successfully" };
  }

  //  ------------------- JobRun actions STOP ------------------ //
  async stopJobRuns(jobRuns: string[]) {
    const mappings = await this.workerJobRunMapRepo.find({
      where: { jobRunId: In(jobRuns), isActive: true },
      select: { workerId: true, jobRunId: true },
    });
    const worker = new Map<string, string[]>();
    mappings.forEach((map) => {
      worker.set(
        map.workerId,
        (worker.get(map.workerId) || []).concat([map.jobRunId])
      );
    });
    await this.workerJobRunMapRepo.delete({ jobRunId: In(jobRuns) });
    const jobRunConfigs = await this.jobRunRepo.find({
      where: {
        id: In(jobRuns),
        status: In([JobRunStatus.Paused, JobRunStatus.Running, JobRunStatus.Ready]),
      },
      select: { jobConfigId: true },
    });
    await this.jobRunRepo.update(
      {
        id: In(jobRuns),
        status: In([
          JobRunStatus.Paused,
          JobRunStatus.Running,
          JobRunStatus.Ready,
        ]),
      },
      { status: JobRunStatus.Stopped, endTime: new Date() }
    );
    await this.jobConfigRepo.update(
      { id: In(jobRunConfigs.map((jobRun) => jobRun.jobConfigId)) },
      { scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED }
    );
    for (const jobRunId of jobRuns) {
      const jobContext = await this.redisService.getJobContext(jobRunId);
      let workflowId: string;
      try {
        workflowId = this.jobRunInitService.getWorkFlowId(
          jobRunId,
          jobContext.jobConfig.jobType as JobType
        );

        await this.workFlowService.terminateWorkflow(workflowId);
        this.logger.debug(`Workflow Terminated ${workflowId}`);
      } catch (error) {
        this.logger.error(
          `Failed to terminate workflow for jobRunId ${jobRunId}: ${error.message}`,
          error.stack
        );
        continue; 
      }

      try {
        jobContext.jobState.status = JobContextStatus.Stopped;

        await jobContext.appendToFileList(this.dummyFileEntry());

        this.logger.debug(
          `Job Run ${jobRunId} Stopped and appended Last file entry to file list`
        );

        await this.redisService.setJobContext(jobRunId, jobContext);

        await new Promise((resolve) => setTimeout(resolve, 10000));

        await jobContext.cleanup();

        this.logger.debug(`Cleanup completed for jobRunId ${jobRunId}`);
      } catch (error) {
        this.logger.error(
          `Error during cleanup for jobRunId ${jobRunId}: ${error.message}`,
          error.stack
        );
      }
    }
    return { details: "Operation Completed Successfully" };
  }

  dummyFileEntry() {
    return new FileInfo(
      "LAST_FILE",
      "",
      "",
      false,
      2048,
      true,
      new Date(),
      new Date(),
      new Date(),
      "",
      "",
      "",
      0,
      1001,
      1001
    );
  }

  //  ------------------- JobRun actions RESUME ------------------ //
  async resumeJobRuns(jobRuns: string[]) {
    const mappings = await this.workerJobRunMapRepo.find({
      where: { jobRunId: In(jobRuns) },
      select: { workerId: true },
    });
    await this.workerJobRunMapRepo.update(
      { jobRunId: In(jobRuns) },
      { isActive: true }
    );
    await this.jobRunRepo.update(
      { id: In(jobRuns), status: JobRunStatus.Paused },
      { status: JobRunStatus.Running, pausedReason: null }
    );
    this.logger.debug(mappings);

    for (const jobRunId of jobRuns) {
      const jobContext = await this.redisService.getJobContext(jobRunId);
      jobContext.jobState.status = JobContextStatus.Running;
      jobContext.jobState.tasks_total = jobContext.jobState.tasks_total - 1;
      this.logger.debug( `Resuming Job Run ${jobRunId}`);
      await this.redisService.setJobContext(jobRunId, jobContext);
      await this.resumeJobRun(jobRunId);
    }
    return { details: "Operation Completed Successfully" };
  }


  async resumeJobRun(jobRunId: string) {
    try {
      const jobRun = await this.jobRunRepo.findOne({ where: { id: jobRunId } });
      if (!jobRun)
        throw new NotFoundException(`Job run with id ${jobRunId} not found`);
      const details: JobRunConfig = await this.jobRunInitService.getJobConfig(
        jobRun.jobConfigId
      );
      if (details.workers?.length === 0) {
        this.logger.warn(
          `Unable to create Job Run for Job Config ${jobRun.jobConfigId} does not has workers`
        );
        return;
      }
      // check if workflow already exists
      const workflowId = this.jobRunInitService.getWorkFlowId(
        jobRunId,
        details.jobType
      );
      const workflowStatus =
        await this.workFlowService.getWorkflowStatus(workflowId);
      this.logger.debug(`Workflow Status ${workflowStatus}`);
      if (workflowStatus === JobContextStatus.Running) {
        this.logger.debug(`Terminating Workflow ${workflowId}`);
        await this.workFlowService.terminateWorkflow(workflowId);
        this.logger.debug(`Workflow Terminated ${workflowId}`);
      }
      this.logger.debug(`Resuming Workflow ${workflowId}`);
      await this.jobRunInitService.initiateWorkflow(jobRunId, details);
      this.logger.debug(`Workflow Resumed ${workflowId}`);
      return;
    } catch (error) {
      this.logger.error(`Failed to resume Job Run ${jobRunId} ${error}`);
      throw new Error(`Failed to resume Job Run ${jobRunId} ${error}`);
    }
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
        "jobConfig.jobType AS jobType",
        "jobConfig.id AS jobConfigId",
        "jobConfig.futureScheduleAt AS nextSchedule",
        "sourceVolume.volumePath AS volumePath",
        "sourceFileServer.protocol AS sourceFileServerProtocol",
        "sourceConfig.configName AS sourceConfigName",
        "targetVolume.volumePath AS targetVolumePath",
        "targetFileServer.protocol AS targetFileServerProtocol",
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
          `jobRun for id ${jobRun.jobrunid} - with jobjobstats ${JSON.stringify(jobRun.jobjobstats)}`
        );
        const partialJobRunStats = {
          jobRunId: jobRun.jobrunid,
          status: jobRun.substatus || jobRun.status,
          startTime: jobRun.starttime,
          endTime: jobRun.endtime,
          jobType: jobRun.jobtype,
          isReportReady: jobRun.isreportready,
          jobConfigId: jobRun?.jobconfigid,
          nextSchedule: jobRun?.nextschedule,
          sourceServer: {
            serverName: jobRun.sourceconfigname,
            path: jobRun.volumepath,
            protocol: jobRun.sourcefileserverprotocol,
          },
          destinationServer: jobRun.targetvolumepath
            ? {
                serverName: jobRun.targetconfigname,
                path: jobRun.targetvolumepath,
                protocol: jobRun.targetfileserverprotocol,
              }
            : undefined,
          timeElapsed: jobRun.endtime
            ? jobRun.endtime.getTime() - jobRun.starttime.getTime()
            : Date.now() - jobRun.starttime.getTime(),
        };
        this.logger.log(`Job Run ${jobRun.jobrunid} status ${jobRun.status}`);
        if (String(jobRun.status).trim() == JobRunStatus.Completed) {
          const inventoryStats: JobRunStats = jobRun.jobstats;
          this.logger.log(
            `Job Run ${jobRun.jobrunid} inventory stats ${JSON.stringify(inventoryStats)}`
          );
          const payload = {
            scannedFilesCount: BigInt(
              inventoryStats?.fileCount || "0"
            )?.toString(),
            scannedDirectoriesCount: BigInt(
              inventoryStats?.directories || "0"
            )?.toString(),
            totalScannedSize:
              jobRun.jobtype === JobType.DISCOVER
                ? formatBytes(Number(inventoryStats?.totalSize || 0))
                : "0 B",
            totalMigratedSize:
              jobRun.jobtype === JobType.MIGRATE
                ? formatBytes(Number(inventoryStats?.totalSize || 0))
                : "0 B",
            errors: await this.getErrorCounts(jobRun.jobrunid),
          };
          const response: JobRunsDTO = {
            ...partialJobRunStats,
            ...payload,
          };
          return response;
        } else {
          const inventoryCounts: JobRunStats = await this.calculateJobRunStats(
            jobRun.jobrunid
          );
          const response: JobRunsDTO = {
            ...partialJobRunStats,
            scannedFilesCount: BigInt(
              inventoryCounts?.fileCount || "0"
            )?.toString(),
            scannedDirectoriesCount: BigInt(
              inventoryCounts?.directories || "0"
            )?.toString(),
            totalScannedSize:
              jobRun.jobtype === JobType.DISCOVER
                ? formatBytes(Number(inventoryCounts?.totalSize || "0"))
                : "0 B",
            totalMigratedSize:
              jobRun.jobtype === JobType.MIGRATE
                ? formatBytes(Number(inventoryCounts?.totalSize || 0))
                : "0 B",
            errors: await this.getErrorCounts(jobRun.jobrunid),
          };
          return response;
        }
      })
    );
    return allJobsRuns;
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

  async updateJobRunStatus(jobRunId: string, status: JobRunStatus) {
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
    if (status !== JobRunStatus.Running && status !== JobRunStatus.Pending) {
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
      const jobRunStats: JobRunStats =
        await this.calculateJobRunStats(jobRunId);
      if (
        jobConfig &&
        (jobConfig.jobType === JobType.MIGRATE ||
          jobConfig.jobType === JobType.CUT_OVER)
      ) {
        const errorCodes =
          await this.errorRemedyService.getDistinctErrorCodes(jobRunId);
        if (!!errorCodes.length) {
          await this.sendErrorRemedyEmail({
            jobRunId,
            sourcePath: jobConfig.sourcePath?.volumePath,
            targetPath: jobConfig.targetPath?.volumePath,
            sourceHost: jobConfig.sourcePath?.fileServer?.host,
            targetHost: jobConfig.targetPath?.fileServer?.host,
            jobType: jobConfig.jobType,
            errorCodes,
          });
        } else {
          this.logger.log(
            `Job Run ${jobRunId} completed with stats ${JSON.stringify(jobRunStats)}`
          );
          const mailBody = `Hello, <br/>
          The following ${jobConfig.jobType} job has been completed for below Paths:
          <p>Source Path:${jobConfig.sourcePath?.volumePath}</p>
          <p>Target Path:${jobConfig.targetPath?.volumePath}</p>
          <p>Source:${jobConfig.sourcePath?.fileServer?.host}</p>
          <p>Target:${jobConfig.targetPath?.fileServer?.host}</p>
          `;
          const payload = { body: mailBody };
          this.logger.log(
            "Sending Mail for job completion with payload",
            JSON.stringify(payload)
          );
          await this.sendMailService.sendMail(payload);
        }
      }
      this.logger.log("job Run Stats", JSON.stringify(jobRunStats));
      await this.jobRunRepo.update(
        { id: jobRunId },
        { status: status, endTime: new Date(), jobStats: jobRunStats }
      );
    } else {
      if (
        jobConfig &&
        (jobConfig.jobType === JobType.MIGRATE ||
          jobConfig.jobType === JobType.CUT_OVER)
      ) {
        const mailBody = `Hello,
          The following ${jobConfig.jobType} job has been started for below Paths:
          <p>Source Path:${jobConfig.sourcePath?.volumePath}</p>
          <p>Target Path:${jobConfig.targetPath?.volumePath}</p>
          <p>Source:${jobConfig.sourcePath?.fileServer?.host}</p>
          <p>Target:${jobConfig.targetPath?.fileServer?.host}</p>
        `;
        const payload = { body: mailBody };
        this.logger.log(
          "Sending Mail for job start with payload",
          JSON.stringify(payload)
        );
        await this.sendMailService.sendMail(payload);
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
    const data = await this.operationErrorRepo.query(`
      SELECT 
        MIN(oe.id::text) AS id,
        MIN(oe.error_message) AS "errorMessage",
        MIN(oe.error_type) AS "errorType",
        MIN(oe.created_at) AS "createdAt",
        MIN(oe.file_name) AS "fileName",
        MIN(oe.file_path) AS "filePath",
        MIN(oe.origin) AS "origin",
        MIN(oe.operation_type) AS "operationType",
        MIN(oe.error_code) AS "errorCode",
        COUNT(*) AS occurrence
      FROM datamigrator.operation_errors oe
      LEFT JOIN datamigrator.operations o ON o.id = oe.operation_id
      WHERE o.job_run_id = $1 AND oe.error_type = $2
      GROUP BY oe.file_path
      ORDER BY MIN($3) ${order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}
      LIMIT $4 OFFSET $5
      `, [jobRunId, errorType, `oe.${sort}`, parseInt(limit, 10), (parseInt(page, 10) - 1) * parseInt(limit, 10)]
    );
    
    const totalResult = await this.operationErrorRepo
      .createQueryBuilder("oe")
      .leftJoin("oe.operation", "o")
      .where("o.jobRunId = :jobRunId", { jobRunId })
      .andWhere("oe.errorType = :errorType", { errorType })
      .select("COUNT(DISTINCT oe.filePath)", "total")
      .getRawOne();

    const total = parseInt(totalResult.total ?? '0', 10);

    if(errorType && errorType === "FATAL_ERROR") {
      const setupFailedErrors = await this.getWorkerSetupErrors(jobRunId);
      if (setupFailedErrors.length > 0) {
        const setupFailedError = setupFailedErrors.map((error): any => {
          return {
            errorMessage: error.workerResponse.message,
            errorType: "FATAL_ERROR",
            createdAt: error.workerResponse.createdAt,
            operationType: error.workerResponse.operation,
            errorCode: error.workerResponse.code,
            origin: error.workerResponse.origin,
            occurrence: error.workerResponse.occurrence || 1,
          }
        });
        data.push(...setupFailedError);
      }
      data.sort((a, b) => { if (a.errorType === "FATAL_ERROR" && b.errorType !== "FATAL_ERROR") return -1 });
      return { data, total: total + setupFailedErrors.length };
    }
    return { data, total: total };
  }

  async getErrorOverview(jobRunId: string) {
    return this.getErrorCounts(jobRunId);
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
    const setupFailedErrors = await this.getWorkerSetupErrors(jobRunId);
    if (setupFailedErrors.length > 0) {
      const fatalError = errorTypeCounts.find(
        (error) => error.errortype === "FATAL_ERROR"
      );
      if (fatalError) {
        fatalError.count += setupFailedErrors.length;
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

    const inventorySummary = await this.inventoryRepo
      .createQueryBuilder("inventory")
      .select([
        "COUNT(CASE WHEN inventory.isDirectory = false THEN 1 END) AS fileCount",
        "COUNT(CASE WHEN inventory.isDirectory = true THEN 1 END) AS directoryCount",
        "COALESCE(SUM(CASE WHEN inventory.isDirectory = false THEN inventory.fileSize ELSE 0 END), 0) AS totalFileSize",
      ])
      .where("inventory.jobRunId = :jobRunId", { jobRunId: jobRunId })
      .getRawOne();

    this.logger.debug(
      `[calculateJobRunStats] Calculating job stats for ${jobRunId}  and query result ${JSON.stringify(inventorySummary)}`
    );

    const jobRunStatus = {
      fileCount: inventorySummary.filecount || "0",
      directories: inventorySummary.directorycount || "0",
      totalSize: inventorySummary.totalfilesize || "0",
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
  }): Promise<void> {
    if (!errorCodes || errorCodes.length === 0) {
      this.logger.log(`No error codes found for job run ${jobRunId}`);
      return;
    }
    const errorRemedies = await this.errorRemedyService.findByErrorCodes(
      errorCodes.map((error) => error.errorCode)
    );
    this.logger.log("Error Remedies ", JSON.stringify(errorRemedies));
    const errorRemediesMailBody = `Hello, <br/>
      The following ${jobType} job (${jobRunId}) has errored for below Paths: <br/>
      <p>Source: ${sourceHost}</p>
      <p>Source Path: ${sourcePath}</p>
      <p>Target: ${targetHost}</p>
      <p>Target Path: ${targetPath}</p>
      <br/>
      <p> Error Details: </p>
      ${errorRemedies
        .map(
          (error) => `
      <p>Error Code: ${error.errorCode}</p>
      <p>Description: ${error.description}</p>
      <p>Resolution Steps: ${error.resolutionSteps}</p>
      <p>Reference Commands: <code>${!!error.referenceCommands ? error.referenceCommands : ""}</code> </p>
      <br/>`
        )
        .join("")}`;
    const errorRemediesPayload = { body: errorRemediesMailBody };
    this.logger.log(
      "Sending Mail for job completion with errorRemediesPayload",
      JSON.stringify(errorRemediesPayload)
    );
    await this.sendMailService.sendMail(errorRemediesPayload);
  }

  async checkWorkerHealth() {
    this.logger.log(`Checking the health of workers`);
    try {
      const runningJobRuns = await this.jobRunRepo.find({
        where: [{ status: JobRunStatus.Running }, { status: JobRunStatus.Paused, pausedReason: PausedReason.SYSTEM_PAUSED}],
        relations: {
          workerMap: {
            worker: { stats: true },
          },
        },
      });
      if(!runningJobRuns.length) return;
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
          await this.pauseJobRuns([jobRunId], PausedReason.SYSTEM_PAUSED);
        } else {
          if (jobRun.status === JobRunStatus.Paused) {
            this.logger.log(
              `Resuming job run ${jobRunId} as some workers are online`
            );
            await this.resumeJobRuns([jobRunId]);
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

  async updateWorkerResponse(jobRunId: string, workerId: string, workerResponse: Record<string, any>): Promise<UpdateResult> {
    try {
      return await this.workerJobRunMapRepo.update({ jobRunId, workerId }, { workerResponse });
    } catch (error) {
      this.logger.error(`Error occurred while updating worker response for jobRunId ${jobRunId} and workerId ${workerId}: ${error}`);
      throw new Error(`Failed to update worker response: ${error}`);
    }
  }

  async getWorkerSetupErrors(jobRunId: string): Promise<any[]> {
    return await this.workerJobRunMapRepo.find({
      where: {
        jobRunId,
        workerResponse: Raw(alias => `${alias} IS NOT NULL AND ${alias} ->> 'code' = 'SETUP_WORKER_FAILURE' AND ${alias} ->> 'status' = 'FAILED'`),
      },
    });
  }
}
