import { JobService } from './../job/job.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Injectable, Logger } from '@nestjs/common';
import { FindManyOptions, Repository } from 'typeorm';
import { JobRunDto } from './../dto/jobrun.dto';
import { JobRunEntity } from '../entities/jobrun.entity';

@Injectable()
export class JobRunService {
  private readonly logger = new Logger(JobRunService.name);

  constructor (
    @InjectRepository(JobRunEntity)
    private jobRunRepo: Repository<JobRunEntity>,
    
    @InjectRepository(JobService)
    private jobService: JobService
  ) {}

  async createJobRun(jobRunData: JobRunDto): Promise<JobRunEntity> {
    this.logger.log(`Data to job run - ${JSON.stringify(jobRunData)}`);
    const jobRunRecord = this.jobRunRepo.create(jobRunData);
    return this.jobRunRepo.save(jobRunRecord);
  }

  async getJobRun(condition: FindManyOptions<JobRunEntity>): Promise<JobRunEntity[]> {
    const jobRun = await this.jobRunRepo.find(condition);
    if (!jobRun.length) throw new Error(`Job run not found`);
    return jobRun;
  }
  
  async updateJobRun(id: string, data: JobRunDto): Promise<JobRunDto> {
    const jobRun = await this.jobRunRepo.findOne({ where: { id } });
    if (!jobRun) throw new Error(`Job run with id ${id} not found`);
    Object.assign(jobRun, data);
    return this.jobRunRepo.save(jobRun);
  }
  
  async deleteJobRun(id: string): Promise<{ message: string }> {
    const jobRun = await this.jobRunRepo.findOne({ where: { id } });
    if (!jobRun) throw new Error(`Job run with id ${id} not found`);
    await this.jobRunRepo.remove(jobRun);
    return { message: `Job run with id ${id} has been deleted` };
  }

  async scheduleAJobRun(jobId: string) {
    try {
      const job = await this.jobService.getJobById(jobId);
      if(!job) throw new Error(`Job with id ${jobId} not found`);
      const jobRun: Partial<JobRunDto> = {
        status: 'READY',
        start_time: new Date(),
        iteration_number: 1,
        job_id: job.id,
      }
      
    } catch (error) {
      throw new Error(error);
    }
  }
}