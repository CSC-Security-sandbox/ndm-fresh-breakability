import { v4 as uuid } from 'uuid';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { Injectable, Logger } from '@nestjs/common';
import { JobConfigEntity, JobStatus } from '../entities/jobconfig.entity';
import { CreateJobConfigDto } from '../dto/jobconfig.dto';

@Injectable()
export class JobConfigService {
  private readonly logger = new Logger(JobConfigService.name)
  constructor(
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
  ) {}

  async createJobConfig(jobConfigData: CreateJobConfigDto): Promise<JobConfigEntity> {
    this.logger.log(`Data to job - ${JSON.stringify(jobConfigData)}`);
    const jobRecord = this.jobConfigRepo.create({
      jobType: jobConfigData.jobType,
      status: jobConfigData.status,
      jobSchedule: jobConfigData.jobSchedule,
      excludeOlderThan: jobConfigData.excludeOlderThan,
      preserveAccessTime: jobConfigData.preserveAccessTime,
      sourcePathId: jobConfigData.sourcePathId,
      targetPathId: jobConfigData.targetPathId,
      createdBy: jobConfigData?.createdBy,
      updatedBy: jobConfigData?.updatedBy
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

  async getJobConfigsForCreatingJobRun() {
    return await this.jobConfigRepo
      .createQueryBuilder('jobconfig')
      .leftJoin('jobrun', 'jobRun', 'jobRun.jobConfigId = jobconfig.id')
      .where('jobconfig.status = :status', { status: JobStatus.Active })
      .andWhere('jobRun.id IS NULL')
      .getMany();
  }
  
  async updateJobConfig(id: string, data: Partial<CreateJobConfigDto>): Promise<JobConfigEntity> {
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
