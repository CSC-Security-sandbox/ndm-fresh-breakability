import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { JobRunStatus, JobStatus } from "src/constants/enums";
import { EmitterEvents } from "src/constants/events";
import { ScheduleStatus, SocketEvents } from "src/constants/status";
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
import { JobRunConfig, UnMountNotificationPayload, UpdateJobRunMappingPayload } from "./jobrun.types";
import { JobOptionsEntity } from "src/entities/joboptions.entity";
import { ConfigService } from "@nestjs/config";

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
    @InjectRepository(JobOptionsEntity)
    private optionRepo: Repository<JobOptionsEntity>,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService
  ) {
    this.mountBasePath = this.configService.get<string>('app.paths.mountBasePath')
  }

  @OnEvent(EmitterEvents.JOB_RUN_STATUS_UPDATE, { async: true })
  async jobRunStatusUpdate(payload: {jobRunId: string, status: JobRunStatus}){
    switch(payload.status) {
      case JobRunStatus.Completed: 
        await this.jobRunRepo.update({id: payload.jobRunId}, {endTime: new Date(), status: JobRunStatus.Completed})
        await this.updateJobRunMapping({jobRunId: payload.jobRunId, isActive: false})
        await this.reScheduleJobConfigById(payload.jobRunId)
        break;
      default:
        await this.jobRunRepo.update({id: payload.jobRunId}, { status: payload.status})
        break
    }
  }

  @OnEvent(EmitterEvents.UPDATE_JOB_RUN_MAPPING, { async: true })
  async updateJobRunMapping(payload: UpdateJobRunMappingPayload){
    await this.workerJobRunMapRepo.update({jobRunId: payload.jobRunId}, {isActive: payload.isActive})
  }


  @OnEvent(EmitterEvents.UNMOUNT_NOTIFICATION,  {async: true}) 
  async unmountNotification(payload: UnMountNotificationPayload){
    const workers = await this.workerJobRunMapRepo.find({where:{jobRunId: payload.jobRunId, isPathMounted: true}})
    for(const worker of workers) 
      this.eventEmitter.emit(EmitterEvents.NOTIFY_WORKER, {
        workerId: worker.workerId,
        socketEvents: SocketEvents.UNMOUNT_PATH,
        payload: {
          mountBaseDir: this.mountBasePath,
          ...payload
        }
    });
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
    return await this.createJobRun(jobConfig.id, new Date())
  }
   
  // ------------------ Cron schedule -------------------- //
  async scheduleAJob() {
    const currentTime = new Date();
    const jobs: JobConfigEntity[] = await this.jobConfigRepo
      .createQueryBuilder("jobConfig")
      .select('jobConfig.id')
      .where("jobConfig.status = :status", { status: JobStatus.Active })
      .andWhere("jobConfig.scheduler = :scheduler", { scheduler: ScheduleStatus.SCHEDULING })
      .andWhere("jobConfig.firstRunAt <= :currentTime", {
        currentTime: currentTime.toISOString(),
      })
      .getMany();
    jobs.forEach(async (job) => await this.createJobRun(job.id, currentTime));
    return jobs;
  }

  // ------------------ Update Job Config by Job Run Id ---------------//
  async reScheduleJobConfigById(jobRunId: string) {
    const jobConfig = await this.jobRunRepo.findOne({where: {id: jobRunId}, select: {jobConfigId: true}})
    if(jobConfig.startTime > new Date())
      await this.jobConfigRepo.update({id: jobConfig.jobConfigId}, {scheduler: ScheduleStatus.SCHEDULING})
    else
      await this.jobConfigRepo.update({id: jobConfig.jobConfigId}, {scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED})
  }


  // ------------------ Get list of workers -------------------- //
  async getJobConfig(
    jobConfigId
  ): Promise<JobRunConfig> {
    const jobConfig = await this.jobConfigRepo.findOne({
      where : {id: jobConfigId},
      relations: {
        sourcePath: { fileServer: { config: true, workers:true } },
        targetPath: { fileServer: { config: true, workers:true } }
      },
    })

    const sourceWorkers = jobConfig?.sourcePath?.fileServer?.workers || [];
    const targetWorkers = jobConfig?.targetPath?.fileServer?.workers || [];

    const details : JobRunConfig = {
      preserveAccessTime: jobConfig.preserveAccessTime,
      excludeFilePatterns: jobConfig.excludeFilePatterns,
      excludeOlderThan: jobConfig.excludeOlderThan,
      connection: {
        sourceCredential: {
          path: jobConfig?.sourcePath?.volumePath ,
          pathId : jobConfig?.sourcePath?.id ,
          protocol: jobConfig?.sourcePath?.fileServer?.protocol,
          username: jobConfig?.sourcePath?.fileServer?.userName,
          password: jobConfig?.sourcePath?.fileServer?.password,
          host: jobConfig?.sourcePath?.fileServer?.host,
          workingDirectory: this.mountBasePath
        }
      },
      workers: sourceWorkers.map((worker) => worker.workerId),
      jobType: jobConfig.jobType
    }

    if (jobConfig.targetPathId) {
      const workers: string[] = [];
      const workerSet = new Set<string>();
      sourceWorkers.forEach((worker) => workerSet.add(worker.workerId));
      targetWorkers?.forEach((worker) => {
        if (workerSet.has(worker.workerId)) workers.push(worker.workerId);
      });

      details.connection['targetCredential'] = {
        path: jobConfig?.targetPath?.volumePath ,
        pathId : jobConfig?.targetPath?.id ,
        protocol: jobConfig?.targetPath?.fileServer?.protocol ,
        username: jobConfig?.targetPath?.fileServer?.userName,
        password: jobConfig?.targetPath?.fileServer?.password,
        host: jobConfig?.targetPath?.fileServer?.host,
        workingDirectory: this.mountBasePath
      }
      details['workers'] = workers
      return details;
    }
    return details
  }

  // ------------------ Create job run  -------------------- //
  async createJobRun(jobConfigId: string , currentTime: Date) {
    const details:JobRunConfig = await this.getJobConfig(jobConfigId)
    
    if(details.workers.length === 0) {
      this.logger.warn(`Unable to create Job Run for Job Config ${jobConfigId} does not has workers`)
      return
    }
    const workerMap = details.workers.map((worker) =>
      this.workerJobRunMapRepo.create({ workerId: worker, isActive: true, isPathMounted: false })
    )

    const options = this.optionRepo.create({
      excludeFilePatterns: details.excludeFilePatterns,
      sourceWorkingDir: this.mountBasePath,
      targetWorkingDir: this.mountBasePath,
      preserveAccessTime: details.preserveAccessTime,
      excludeOlderThan: details.excludeOlderThan
    })
    const jobRunRecord = this.jobRunRepo.create({
      status: JobRunStatus.Ready,
      startTime: currentTime,
      endTime: null,
      iterationNumber: 1,
      jobConfigId: jobConfigId,
      workerMap: workerMap,
      options: options
    });
    const update = await this.jobRunRepo.save(jobRunRecord);
    // make JobConfig Active
    await this.jobConfigRepo.update({id: jobConfigId}, {scheduler: ScheduleStatus.SCHEDULED})
    await this.sendMountMessage(details, update.id)

    this.eventEmitter.emit(EmitterEvents.CREATE_TASK, {
      jobRunId: update.id,
      status: update.status,
      details: details
    });

    return update
  }
  //  ------------------- sendMountMessage ------------------ //
  async sendMountMessage(details: JobRunConfig, jobRunId: string) {
      details.workers.forEach(worker => 
        this.eventEmitter.emit(EmitterEvents.NOTIFY_WORKER, {
          workerId: worker,
          socketEvents: SocketEvents.MOUNT_PATH,
          payload: { jobRunId: jobRunId, ...details.connection}
      })
    )
  }
 
  //  ------------------- JobRun actions ------------------ //
  async actions( jobRunActions: JobRunActionsReq) {
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
    await this.jobRunRepo.update(
      {id: In(jobRuns), status: In([JobRunStatus.Paused, JobRunStatus.Running])}, {status: JobRunStatus.Stopped}
      )
    worker.forEach((jobRuns, workerId)=>
      this.eventEmitter.emit(EmitterEvents.NOTIFY_WORKER,{
        workerId: workerId,
        socketEvents: SocketEvents.STOP_TASK,
        payload: { jobRuns }
      })
    )
    return {details: 'Operation Completed Successfully'}
  }

  //  ------------------- JobRun actions RESUME ------------------ //
  async resumeJobRuns(jobRuns: string[]) { 
    const mappings = await this.workerJobRunMapRepo.find({
      where: {jobRunId: In(jobRuns)}, select: {workerId: true}
    })
    await this.workerJobRunMapRepo.update({jobRunId: In(jobRuns)}, {isActive: true})
    const workerSet = new Set<string>(mappings.map(it=>it.workerId))
    await this.jobRunRepo.update({id: In(jobRuns), status: JobRunStatus.Paused}, {status: JobRunStatus.Running})
    this.logger.debug(mappings)
    workerSet.forEach((workerId)=>
      this.eventEmitter.emit(EmitterEvents.NOTIFY_WORKER,{
        workerId: workerId,
        socketEvents: SocketEvents.WAKE_UP,
        payload: { jobRuns }
      })
    )
    return {details: 'Operation Completed Successfully'}
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
      totalScannedSize:  this.covertBytes(Number(inventoryCounts?.totalsize || "0")),
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
        "jobConfig.jobType AS jobType",
        "jobConfig.id AS jobConfigId",
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
          jobConfigId: jobRun?.jobconfigid,
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
          totalScannedSize: this.covertBytes(Number(
            inventoryCounts?.totalsize || "0"
          )),
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

}
