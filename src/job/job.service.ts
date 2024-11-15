import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { JobEntity } from '../entities/job.entity';
import { JobDTO } from '../dto/job.dto';

@Injectable()
export class JobService {

  constructor(
    @InjectRepository(JobEntity)
    private jobRepo: Repository<JobEntity>,
  ) {}

  async createJob(jobData: JobDTO): Promise<JobEntity> {
    console.log(`Data to job - ${JSON.stringify(jobData)}`);
    const jobRecord = this.jobRepo.create({
        source_config_id: jobData?.source_config_id,
        target_config_id: jobData?.target_config_id,
        file_filters: jobData?.file_filters,
        recursive_flag: jobData?.recursive_flag,
        timeout: jobData?.timeout,
        retries: jobData?.retries,
        network_throtlling: jobData?.network_throtlling,
        overwrite_policy: jobData?.overwrite_policy,
        file_permissions: jobData?.file_permissions,
        cron_settings: jobData?.cron_settings,
        integrative_algorithms: jobData?.integrative_algorithms,
        chunk_size: jobData?.chunk_size,
        createdBy: jobData?.created_by,
        updatedBy: jobData?.updated_by
    });

    return this.jobRepo.save(jobRecord);
  }

  async getJobById(id: string): Promise<JobEntity> {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) {
      throw new Error(`Job with id ${id} not found`);
    }
    return job;
  }

  async getJobs(condition: FindManyOptions<JobEntity>): Promise<JobEntity[]> {
    return await this.jobRepo.find(condition);
  }
  
  async updateJob(id: string, data: JobDTO): Promise<JobEntity> {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) {
      throw new Error(`Job with id ${id} not found`);
    }
  
    Object.assign(job, data);
  
    return this.jobRepo.save(job);
  }
  
  async deleteJob(id: string): Promise<{ message: string }> {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) {
      throw new Error(`Job with id ${id} not found`);
    }
  
    await this.jobRepo.remove(job);
    return { message: `Job with id ${id} has been deleted` };
  }
  
  async getAllJob(): Promise<JobEntity[]> {
    return await this.jobRepo.find();
  }
}
