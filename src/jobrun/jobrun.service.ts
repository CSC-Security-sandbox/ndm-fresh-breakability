import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { JobRunStatus, JobStatus } from 'src/constants/enums';
import { EmitterEvents } from 'src/constants/events';
import { JobConfigEntity } from 'src/entities/jobconfig.entity';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import { FindManyOptions, In, Repository } from 'typeorm';
import { JobRunDto, JobRunFilterDto } from './dto/jobrun.dto';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobRunPageDto } from './dto/jobrunpage.dto';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { UpdateJobRunMappingPayload } from './jobrun.types';
import { JobRunActions, JobRunActionsReq } from './dto/jobrunactions.dto';
import { SocketEvents } from 'src/constants/status';



@Injectable()
export class JobRunService {

  private readonly logger = new Logger(JobRunService.name);

  constructor(
    @InjectRepository(JobRunEntity)
    private jobRunRepo: Repository<JobRunEntity>,
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
    @InjectRepository(WorkerJobRunMap)
    private workerJobRunMapRepo: Repository<WorkerJobRunMap>,
    @InjectRepository(InventoryEntity)
    private inventoryRepo: Repository<InventoryEntity>,
    private readonly eventEmitter: EventEmitter2
  ) { }

   // ------------------ Events  -------------------- //

  @OnEvent(EmitterEvents.JobRunStatusUpdate, { async: true })
  async jobRunStatusUpdate(payload: {jobRunId: string, status: JobRunStatus}){
    await this.jobRunRepo.update({id: payload.jobRunId},{status: payload.status})
    if(payload.status === JobRunStatus.Completed) 
      await this.updateJobRunMapping({jobRunId: payload.jobRunId, isActive: false})
  }

  @OnEvent(EmitterEvents.UpdateJobRunMapping, { async: true })
  async updateJobRunMapping(payload: UpdateJobRunMappingPayload){
    await this.workerJobRunMapRepo.update({jobRunId: payload.jobRunId}, {isActive: payload.isActive})
  }

  // ------------------ Cron schedule -------------------- //
  async scheduleAJob() {
    const currentTime = new Date();
    const jobs: JobConfigEntity[] = await this.jobConfigRepo
      .createQueryBuilder('jobConfig')
      .leftJoinAndSelect('jobConfig.jobRuns', 'jobRuns')  
      .leftJoinAndSelect('jobConfig.sourcePath', 'sourcePath') 
      .leftJoinAndSelect('jobConfig.targetPath', 'targetPath') 
      .where('jobConfig.status = :status', { status: JobStatus.Active })
      .andWhere('jobConfig.firstRunAt <= :currentTime', { currentTime: currentTime.toISOString() }) 
      .andWhere('jobRuns.id IS NULL')  
      .getMany();
    jobs.forEach(async (job)=> await this.createJobRun(job, currentTime))
    return jobs;
  }
  
  // ------------------ Get list of workers -------------------- //
  async getSourceAndTargetWorkersByJobConfigId(
    job: JobConfigEntity 
  ): Promise<string[]> {
    const jobConfig = await this.jobConfigRepo
      .createQueryBuilder('jobConfig')
      .leftJoinAndSelect('jobConfig.sourcePath', 'sourcePath')
      .leftJoinAndSelect('jobConfig.targetPath', 'targetPath')
      .leftJoinAndSelect('sourcePath.fileServer', 'sourceFileServer')
      .leftJoinAndSelect('sourceFileServer.workers', 'sourceWorkers')
      .leftJoinAndSelect('targetPath.fileServer', 'targetFileServer')
      .leftJoinAndSelect('targetFileServer.workers', 'targetWorkers')
      .where('jobConfig.id = :jobConfigId', { jobConfigId: job.id })
      .getOne();

    const sourceWorkers = jobConfig?.sourcePath?.fileServer?.workers || [];
    const targetWorkers = jobConfig?.targetPath?.fileServer?.workers || [];
   
    if(job.targetPathId) {
      const workers:string[] = []
      const workerSet = new Set<string>()
      sourceWorkers.forEach(worker=> workerSet.add(worker.workerId))
      targetWorkers?.forEach(worker=> {
        if(workerSet.has(worker.workerId))
          workers.push(worker.workerId)
      })
      return  workers 
    }
    return sourceWorkers.map(worker=> worker.workerId)
  
  }
  
  // ------------------ Create job run  -------------------- //
  async createJobRun(job: JobConfigEntity , currentTime: Date) {
    const workers = await this.getSourceAndTargetWorkersByJobConfigId(job)
    
    if(workers.length === 0) {
      this.logger.warn(`Unable to create Job Run for Job Config ${job.id} does not has workers`)
      return
    }

    const workerMap = workers.map(worker => 
      this.workerJobRunMapRepo.create({
        workerId: worker,
        isActive: true
      })
    )

    const jobRunRecord = this.jobRunRepo.create({
      status: JobRunStatus.Ready,
      startTime: currentTime,
      endTime: null,
      iterationNumber: 1,
      jobConfigId: job.id,
      workerMap: workerMap
    });
    const update = await this.jobRunRepo.save(jobRunRecord);
  
    this.eventEmitter.emit(EmitterEvents.TaskCreate, 
      {
        jobRunId: update.id,
        status: update.status,
        sPath: job.sourcePath.volumePath,
        tPath: job.targetPath?.volumePath,
        taskType: job.jobType,
        workers : workers
    })
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
    await this.jobRunRepo.update({id: In(jobRuns), status: In([JobRunStatus.Paused, JobRunStatus.Running])}, {status: JobRunStatus.Stopped})
    worker.forEach((jobRuns, workerId)=>
      this.eventEmitter.emit(EmitterEvents.NotifyWorker,{
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
      this.eventEmitter.emit(EmitterEvents.NotifyWorker,{
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
  async getJobRun(condition: FindManyOptions<JobRunEntity>): Promise<JobRunEntity[]> {
    const jobRun = await this.jobRunRepo.find(condition);
    if (!jobRun.length) throw new Error(`Job run not found`);
    return jobRun;
  }

  async findAllJobRuns(jobRunPageDto: JobRunPageDto) {
    const { page, limit, sort = 'createdAt', order = 'ASC', ...filter } = jobRunPageDto;
    
    const findOptions: FindManyOptions<JobRunEntity> = {
      where: filter, order: { [sort]: order }, 
    };

    let data = [], total = 0;
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

  async getJobAllRuns(
    filter: JobRunPageDto,
  ) {
    const jobRuns = await this.jobRunRepo.createQueryBuilder('jobRun')
    .leftJoinAndSelect('jobRun.jobConfig', 'jobConfig')
    .leftJoinAndSelect('jobConfig.sourcePath', 'sourceVolume')
    .leftJoinAndSelect('jobConfig.targetPath', 'targetVolume') 
    .leftJoinAndSelect('sourceVolume.fileServer', 'sourceFileServer')
    .leftJoinAndSelect('targetVolume.fileServer', 'targetFileServer')
    .leftJoinAndSelect('sourceFileServer.config', 'sourceConfig')
    .leftJoinAndSelect('targetFileServer.config', 'targetConfig')
    .where('sourceConfig.projectId = :projectId', { projectId:filter?.projectId })
    .orWhere('targetConfig.projectId = :projectId', { projectId:filter.projectId })
    .select([
      'jobRun.id AS jobRunId',
      'jobConfig.jobType AS jobType', 
      'jobConfig.id AS jobConfigId',
      'sourceVolume.volumePath AS volumePath',
      'sourceFileServer.protocol AS sourceFileServerProtocol',
      'sourceConfig.configName AS sourceConfigName',
      'targetVolume.volumePath AS targetVolumePath',
      'targetFileServer.protocol AS targetFileServerProtocol',
      'targetConfig.configName AS targetConfigName',
      'jobRun.status AS status',
      'jobRun.startTime AS startTime',
      'jobRun.endTime AS endTime',
    ])
    .getRawMany();

    const runStats = await Promise.all(jobRuns.map(async (jobRun) => {

      const inventoryCounts = await this.inventoryRepo
        .createQueryBuilder('inventory')
        .select([
          "SUM(CASE WHEN inventory.isDirectory = false THEN 1 ELSE 0 END) AS fileCount",
          "SUM(CASE WHEN inventory.isDirectory = true THEN 1 ELSE 0 END) AS directoryCount",
          "SUM(inventory.fileSize) AS totalSize",
        ])
        .where('inventory.jobRunId = :jobRunId', { jobRunId: jobRun.jobrunid })
        .getRawOne();

      return {
        jobRunId: jobRun.id,
        status: jobRun.status,
        startTime: jobRun.starttime,
        endTime: jobRun.endtime,
        jobType: jobRun.jobtype,
        sourceServer: {
          serverName: jobRun.sourceconfigname,
          path: jobRun.volumepath,
          protocol: jobRun.sourcefileserverprotocol,
        },
        destinationServer: jobRun.targetvolumepath ? {
          serverName: jobRun.targetconfigname,
          path: jobRun.targetvolumepath,
          protocol: jobRun.targetfileserverprotocol,
        }:{},
        timeElapsed: jobRun.endtime ? jobRun.endtime.getTime() - jobRun.starttime.getTime() : Date.now() - jobRun.starttime.getTime(),
        scannedFilesCount: BigInt(inventoryCounts?.filecount || '0')?.toString(),
        scannedDirectoriesCount: BigInt(inventoryCounts?.directorycount || '0')?.toString(),
        totalScannedSize: BigInt(inventoryCounts?.totalsize || '0')?.toString(),
        errors: []
      };
    }));
    return runStats;

  }

}