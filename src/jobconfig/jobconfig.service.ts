import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobConfigDTO } from '../dto/jobconfig.dto';

@Injectable()
export class JobConfigService {
  private readonly logger = new Logger(JobConfigService.name)
  constructor(
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
  ) {}

  async createJob(jobData: JobConfigDTO): Promise<JobConfigEntity> {
    this.logger.log(`Data to job - ${JSON.stringify(jobData)}`);
    const jobRecord = this.jobConfigRepo.create({
        schedule_time: jobData?.jobSchedule,
        createdBy: jobData?.created_by,
        updatedBy: jobData?.updated_by
    });
    return this.jobConfigRepo.save(jobRecord);
  }

  async getJobById(id: string): Promise<JobConfigEntity> {
    const job = await this.jobConfigRepo.findOne({ where: { id } });
    if (!job) {
      throw new Error(`Job with id ${id} not found`);
    }
    return job;
  }

  async getJobs(condition: FindManyOptions<JobConfigEntity>): Promise<JobConfigEntity[]> {
    return await this.jobConfigRepo.find(condition);
  }
  
  async updateJob(id: string, data: JobConfigDTO): Promise<JobConfigEntity> {
    const job = await this.jobConfigRepo.findOne({ where: { id } });
    if (!job) {
      throw new Error(`Job with id ${id} not found`);
    }
  
    Object.assign(job, data);
  
    return this.jobConfigRepo.save(job);
  }
  
  async deleteJob(id: string): Promise<{ message: string }> {
    const job = await this.jobConfigRepo.findOne({ where: { id } });
    if (!job) {
      throw new Error(`Job with id ${id} not found`);
    }
  
    await this.jobConfigRepo.remove(job);
    return { message: `Job with id ${id} has been deleted` };
  }
  
  async getAllJob(): Promise<JobConfigEntity[]> {
    return await this.jobConfigRepo.find();
  }
}
