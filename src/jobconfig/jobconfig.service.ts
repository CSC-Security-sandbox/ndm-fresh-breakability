import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobConfigDto } from './dto/jobconfig.dto';

@Injectable()
export class JobConfigService {
  private readonly logger = new Logger(JobConfigService.name)
  constructor(
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
  ) {}

  async createJobConfig(jobConfigData: JobConfigDto): Promise<JobConfigEntity> {
    this.logger.log(`Data to job - ${JSON.stringify(jobConfigData)}`);
    const jobRecord = this.jobConfigRepo.create({
      ...jobConfigData,
      firstRunAt: jobConfigData?.firstRunAt?.toISOString() ?? new Date().toISOString()
    });
    return this.jobConfigRepo.save(jobRecord);
  }

  async getJobConfigById(id: string): Promise<JobConfigEntity> {
    const job = await this.jobConfigRepo.findOne({ where: { id } });
    if (!job) {
      throw new Error(`Job with id ${id} not found`);
    }
    return job;
  }

  async getJobConfigs(condition: FindManyOptions<JobConfigEntity>): Promise<JobConfigEntity[]> {
    return await this.jobConfigRepo.find(condition);
  }

 
  
  async updateJobConfig(id: string, data: Partial<JobConfigDto>): Promise<JobConfigEntity> {
    const job = await this.jobConfigRepo.findOne({ where: { id } });
    if (!job) {
      throw new Error(`Job with id ${id} not found`);
    }
    Object.assign(job, data);
    return this.jobConfigRepo.save(job);
  }
  
  async deleteJobConfig(id: string): Promise<{ message: string }> {
    const job = await this.jobConfigRepo.findOne({ where: { id } });
    if (!job) {
      throw new Error(`Job with id ${id} not found`);
    }
  
    await this.jobConfigRepo.remove(job);
    return { message: `Job with id ${id} has been deleted` };
  }
  
  async getAllJobConfig(): Promise<JobConfigEntity[]> {
    return await this.jobConfigRepo.find();
  }
}
