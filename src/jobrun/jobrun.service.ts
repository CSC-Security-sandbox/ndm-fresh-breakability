import { JobConfigService } from '../jobconfig/jobconfig.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Injectable, Logger } from '@nestjs/common';
import { FindManyOptions, LessThanOrEqual, Repository } from 'typeorm';
import { JobRunDto, JobRunFilterDto } from './../dto/jobrun.dto';
import { JobRunEntity, JobRunStatus } from '../entities/jobrun.entity';
import { JobConfigEntity } from 'src/entities/jobconfig.entity';
import { JobStatus } from 'src/constants/enums';
import { EventEmitter2 } from '@nestjs/event-emitter'
import { v4 as uuid } from 'uuid';

@Injectable()
export class JobRunService {
  private readonly logger = new Logger(JobRunService.name);

  constructor(
    @InjectRepository(JobRunEntity)
    private jobRunRepo: Repository<JobRunEntity>,
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
    private readonly jobConfigService: JobConfigService,
    private readonly eventEmitter: Eve
  ) { }



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
  
    this.logger.log({ jobs, currentTime: currentTime.toISOString() }, 'Scheduled Jobs');
    jobs.forEach(async (job)=> await this.createJobRun(job, currentTime))
    return jobs;
  }

  

  async createJobRun(job: JobConfigEntity , currentTime: Date): Promise<JobRunEntity> {
    this.logger.log(`Data to job run - ${JSON.stringify(job)}`);
      const jobRunRecord = this.jobRunRepo.create({
        id: uuid(),
        status: JobRunStatus.Ready,
        startTime: currentTime,
        endTime: null,
        iterationNumber: 1,
        jobConfigId: job.id
      });
    await this.jobRunRepo.save(jobRunRecord);

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
  
  async scheduleAJobRun(jobId: string) {
    const job = await this.jobConfigService.getJobConfigById(jobId);
    if (!job) {
      throw new Error(`Job with id ${jobId} not found`);
    }
    const jobRun: Partial<JobRunDto> = {
      status: JobRunStatus.Ready,
      startTime: new Date(),
      iterationNumber: 1,
      jobConfigId: job.id,
    };
    this.logger.log(`Scheduling job run: ${JSON.stringify(jobRun)}`);
    const createdJobRun = this.jobRunRepo.create(jobRun);
    return this.jobRunRepo.save(createdJobRun);
  }
}