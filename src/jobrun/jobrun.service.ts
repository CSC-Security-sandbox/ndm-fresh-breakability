import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import {
  JobContextFactory,
  RedisUtils
} from '@netapp-cloud-datamigrate/jobs-lib';
import { JobStatus as JobContextStatus } from "@netapp-cloud-datamigrate/jobs-lib/dist/types/enums";
import * as parser from 'cron-parser';
import { CutoverErrors, JobRunStatus, JobStatus, JobType } from "src/constants/enums";
import { ScheduleStatus } from "src/constants/status";
import { InventoryEntity } from "src/entities/inventory.entity";
import { JobConfigEntity } from "src/entities/jobconfig.entity";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import { FindManyOptions, In, Repository } from "typeorm";
import { JobRunEntity } from "../entities/jobrun.entity";
import {
  JobRunDetailsDTO,
  JobRunDto,
  JobRunsDTO
} from "./dto/jobrun.dto";
import { JobRunActions, JobRunActionsReq } from "./dto/jobrunactions.dto";
import { JobRunPageDto } from "./dto/jobrunpage.dto";
import { JobRunInitService } from "./jobrun.init.service";
import { JobRunConfig } from "./jobrun.types";
@Injectable()
export class JobRunService {
 
  private readonly logger = new Logger(JobRunService.name);
  private readonly mountBasePath: string 

  constructor(
    @InjectRepository(JobRunEntity)
    private jobRunRepo: Repository<JobRunEntity>,
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
    @InjectRepository(WorkerJobRunMap)
    private workerJobRunMapRepo: Repository<WorkerJobRunMap>,
    @InjectRepository(InventoryEntity)
    private inventoryRepo: Repository<InventoryEntity>,
    private readonly configService: ConfigService,
    private jobRunInitService: JobRunInitService
  ) {
    this.mountBasePath = this.configService.get<string>('app.paths.mountBasePath')
  }


  async cutoverApprove(jobRunId: string) {
    const jobRun = await this.jobRunRepo.findOne({
      where: {
        id: jobRunId,
        status: JobRunStatus.Blocked,
        jobConfig: { jobType: JobType.CUT_OVER }
      },
      relations: ['jobConfig'],
    });

    if (!jobRun) {
      throw new NotFoundException(CutoverErrors.VALID_JOB_RUN_NOT_FOUND);
    }

    jobRun.status = JobRunStatus.Completed;
    await this.jobRunRepo.save(jobRun);

    return { details: 'Cutover job approved successfully' };
  }

  // ------------------ Ad-hoc Run -------------------- //
  async addHocRun(jobConfigId: string) {
    const jobConfig = await this.jobConfigRepo.findOne({where: {id: jobConfigId}})
    if(!jobConfig) 
      throw new NotFoundException(`Job config id doesn't exist for id ${jobConfigId}`)
    if(jobConfig.scheduler === ScheduleStatus.SCHEDULED)
      throw new BadRequestException(`Job run is already created for ${jobConfigId}`)
    if(jobConfig.status === JobStatus.InActive)
      throw new BadRequestException(`Job run can not be created to Inactive Job Config`)
    return await this.jobRunInitService.createJobRun(jobConfig.id, new Date())
  }
   

 
  //  ------------------- JobRun actions ------------------ //
  async actions(jobRunActions: JobRunActionsReq) {
    switch (jobRunActions.action) {
      case JobRunActions.PAUSE:
        return await this.pauseJobRuns(jobRunActions.jobRuns);
      case JobRunActions.STOP:
        return await this.stopJobRuns(jobRunActions.jobRuns);
      case JobRunActions.RESUME:
        return await this.resumeJobRuns(jobRunActions.jobRuns);
      default:
        throw new BadRequestException('Invalid Action Type')
    }
  }

 

  //  ------------------- JobRun actions PAUSE ------------------ //
  async pauseJobRuns(jobRuns: string[]) { 
    await this.workerJobRunMapRepo.update({jobRunId: In(jobRuns)}, {isActive: false})
    await this.jobRunRepo.update({id: In(jobRuns)}, {status: JobRunStatus.Paused})
    const redisClient = await RedisUtils.getClient();
    if(!redisClient.isOpen)await redisClient.connect();
    const redisContextProvider = await JobContextFactory.getProvider('redis', redisClient);
    for(const jobRunId of jobRuns) {
      const jobContext = await redisContextProvider.getJobContext(jobRunId);
      jobContext.jobState.status = JobContextStatus.Paused;
      const serializedContext = jobContext.serialize();
      await redisClient.set(jobRunId, serializedContext);
    }
    return {details: 'Operation Completed Successfully'}
  }

  //  ------------------- JobRun actions STOP ------------------ //
  async stopJobRuns(jobRuns: string[]) { 
    const mappings = await this.workerJobRunMapRepo.find({
      where: {jobRunId: In(jobRuns),isActive:true}, select: {workerId: true, jobRunId: true}
    })
    const worker = new Map<string,string[]>()
    mappings.forEach(map=>{
      worker.set(map.workerId,(worker.get(map.workerId) || []).concat([map.jobRunId]))
    }) 
    await this.workerJobRunMapRepo.delete({jobRunId: In(jobRuns)})
    await this.jobRunRepo.update({id: In(jobRuns), status: In([JobRunStatus.Paused, JobRunStatus.Running])}, {status: JobRunStatus.Stopped})
    const redisClient = await RedisUtils.getClient();
    if(!redisClient.isOpen)await redisClient.connect();
    const redisContextProvider = await JobContextFactory.getProvider('redis', redisClient);
    for(const jobRunId of jobRuns) {
      const jobContext = await redisContextProvider.getJobContext(jobRunId);
      jobContext.jobState.status = JobContextStatus.Stopped;
      await redisClient.set(jobRunId, jobContext.serialize());
    }
    return {details: 'Operation Completed Successfully'}
  }

  //  ------------------- JobRun actions RESUME ------------------ //
  async resumeJobRuns(jobRuns: string[]) { 
    const mappings = await this.workerJobRunMapRepo.find({
      where: {jobRunId: In(jobRuns)}, select: {workerId: true}
    })
    await this.workerJobRunMapRepo.update({jobRunId: In(jobRuns)}, {isActive: true})
    await this.jobRunRepo.update({id: In(jobRuns), status: JobRunStatus.Paused}, {status: JobRunStatus.Running})
    this.logger.debug(mappings)
    const redisClient = await RedisUtils.getClient();
    if(!redisClient.isOpen)await redisClient.connect();
    const redisContextProvider = await JobContextFactory.getProvider('redis', redisClient);
    for(const jobRunId of jobRuns) {
      const jobContext = await redisContextProvider.getJobContext(jobRunId);
      jobContext.jobState.status = JobContextStatus.Pending;
      jobContext.jobState.tasks_total = jobContext.jobState.tasks_total - 1;
      await redisClient.set(jobRunId, jobContext.serialize());
      await this.resumeJobRun(jobRunId);
    }
    return {details: 'Operation Completed Successfully'}
  }

  async resumeJobRun(jobRunId: string) {
    const jobRun = await this.jobRunRepo.findOne({where: {id: jobRunId}})
    if(!jobRun) throw new NotFoundException(`Job run with id ${jobRunId} not found`)
    const details:JobRunConfig = await this.jobRunInitService.getJobConfig(jobRun.jobConfigId);
    if(details.workers.length === 0) {
      this.logger.warn(`Unable to create Job Run for Job Config ${jobRun.jobConfigId} does not has workers`)
      return
    }
    await this.jobRunInitService.initiateWorkflow(jobRunId, details)
  }

  //  ------------------- get JobRun Details ------------------ //
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
        startTime: true,
        endTime: true,
        jobConfigId: true,
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
    const inventoryCounts = await this.inventoryRepo
      .createQueryBuilder("inventory")
      .select([
        "SUM(CASE WHEN inventory.isDirectory = false THEN 1 ELSE 0 END) AS fileCount",
        "SUM(CASE WHEN inventory.isDirectory = true THEN 1 ELSE 0 END) AS directoryCount",
        "SUM(inventory.fileSize) AS totalSize",
      ])
      .where("inventory.jobRunId = :jobRunId", { jobRunId: jobRun.id })
      .getRawOne();

    const jobRunDetails: JobRunDetailsDTO = {
      jobRunId: jobRun.id,
      jobConfigId: jobRun.jobConfigId,
      status: jobRun.status,
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
      scannedFilesCount: BigInt(inventoryCounts?.filecount || "0")?.toString(),
      scannedDirectoriesCount: BigInt(
        inventoryCounts?.directorycount || "0"
      )?.toString(),
      totalScannedSize: jobConfigDetails.jobType === JobType.DISCOVER ?  this.covertBytes(Number(inventoryCounts?.totalsize || "0")) : '0',
      totalMigratedSize: jobConfigDetails.jobType === JobType.MIGRATE ? '' : '0',
      errors: [],
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
        "jobRun.status AS status",
        "jobRun.startTime AS startTime",
        "jobRun.endTime AS endTime",
      ])
      .getRawMany();

    const allJobsRuns = await Promise.all(
      jobRuns.map(async (jobRun) => {
        const inventoryCounts = await this.inventoryRepo
          .createQueryBuilder("inventory")
          .select([
            "SUM(CASE WHEN inventory.isDirectory = false THEN 1 ELSE 0 END) AS fileCount",
            "SUM(CASE WHEN inventory.isDirectory = true THEN 1 ELSE 0 END) AS directoryCount",
            "SUM(inventory.fileSize) AS totalSize",
          ])
          .where("inventory.jobRunId = :jobRunId", {
            jobRunId: jobRun.jobrunid,
          })
          .getRawOne();

        const response: JobRunsDTO = {
          jobRunId: jobRun.jobrunid,
          status: jobRun.status,
          startTime: jobRun.starttime,
          endTime: jobRun.endtime,
          jobType: jobRun.jobtype,
          isReportReady:jobRun.isreportready,
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
          scannedFilesCount: BigInt(
            inventoryCounts?.filecount || "0"
          )?.toString(),
          scannedDirectoriesCount: BigInt(
            inventoryCounts?.directorycount || "0"
          )?.toString(),
          totalScannedSize: jobRun.jobtype === JobType.DISCOVER ? this.covertBytes(Number(
            inventoryCounts?.totalsize || "0"
          )) : '',
          totalMigratedSize: jobRun.jobtype === JobType.MIGRATE ? '' : '0',
          errors: [],
        };
        return response;
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
    if (!jobRunDetails) throw new Error(`Job run with id ${jobRunId} not found`);
    if(status !== JobRunStatus.Running) {
      const jobConfig = await this.jobConfigRepo.findOne({
        where: { id: jobRunDetails.jobConfigId },
      });
      if (jobConfig && jobConfig.futureScheduleAt) {
        try {
          const date = parser.parseExpression(jobConfig.futureScheduleAt).next().toDate();
          await this.jobConfigRepo.update(
            { id: jobConfig.id },
            { firstRunAt: date, scheduler: ScheduleStatus.SCHEDULING }
          );
        } catch (e) {
          throw new Error(`Invalid cron expression in futureScheduleAt: ${e.message}`);
        }
      } else {
        await this.jobConfigRepo.update(
          { id: jobRunDetails.jobConfigId },
          { scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED }
        );
      }
      await this.jobRunRepo.update(
        { id: jobRunId },
        { status: status, endTime: new Date() }
      );
    } else {
      return this.jobRunRepo.update(
        { id: jobRunId },
        { status: status }
      );
    };
  }
}
