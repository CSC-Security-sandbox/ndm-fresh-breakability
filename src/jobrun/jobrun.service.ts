import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { JobRunStatus, JobStatus } from 'src/constants/enums';
import { EmitterEvents } from 'src/constants/events';
import { JobConfigEntity } from 'src/entities/jobconfig.entity';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import { FindManyOptions, Repository } from 'typeorm';
import { JobRunDto, JobRunFilterDto } from './dto/jobrun.dto';
import { JobRunEntity } from '../entities/jobrun.entity';


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
    private readonly eventEmitter: EventEmitter2
  ) { }


  // ------------------ Cron schedule -------------------- //
  async scheduleAJob() {
    const currentTime = new Date();
    const jobs: JobConfigEntity[] = await this.jobConfigRepo
      .createQueryBuilder('jobConfig')
      .leftJoinAndSelect('jobConfig.jobRun', 'jobRun')  
      .leftJoinAndSelect('jobConfig.sourcePath', 'sourcePath') 
      .leftJoinAndSelect('jobConfig.targetPath', 'targetPath') 
      .where('jobConfig.status = :status', { status: JobStatus.Active })
      .andWhere('jobConfig.firstRunAt <= :currentTime', { currentTime: currentTime.toISOString() }) 
      .andWhere('jobRun.id IS NULL')  
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
    const workers =await this.getSourceAndTargetWorkersByJobConfigId(job)
    
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

  async getJobRun(condition: FindManyOptions<JobRunEntity>): Promise<JobRunEntity[]> {
    const jobRun = await this.jobRunRepo.find(condition);
    if (!jobRun.length) throw new Error(`Job run not found`);
    return jobRun;
  }

  async getJobAllRuns(
    page: number,
    limit: number,
    sortField: string,
    sortOrder: 'ASC' | 'DESC',
    filter: JobRunFilterDto,
  ) {
    const queryBuilder = this.jobRunRepo.createQueryBuilder('job_run');

    // Apply filters
    Object.entries(filter).forEach(([key, value]) => {
      if (value) {
        queryBuilder.andWhere(`job_run.${key} LIKE :${key}`, { [key]: `%${value}%` });
      }
    });

    // Apply sorting
    queryBuilder.orderBy(`job_run.${sortField}`, sortOrder);

    // Apply pagination
    queryBuilder.skip((page - 1) * limit).take(limit);

    const [data, total] = await queryBuilder.getManyAndCount();

    return {
      total,
      page,
      limit,
      data,
    };
  }

  async updateJobRun(id: string, data: Partial<JobRunDto>): Promise<JobRunDto> {
    const jobRun = await this.jobRunRepo.findOne({ where: { id } });
    if (!jobRun) throw new Error(`Job run with id ${id} not found`);
    Object.assign(jobRun, data);
    return this.jobRunRepo.save(jobRun);
  }
}