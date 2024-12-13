import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobConfigDto } from './dto/jobconfig.dto';
import { JobListingDTO } from './dto/joblisting.dto';
import * as parser from 'cron-parser';
import { JobConfigDiscoverBulk } from './dto/jobdicoverybulk.dto';
import { JobStatus, JobType } from 'src/constants/enums';

@Injectable()
export class JobConfigService {
  private readonly logger = new Logger(JobConfigService.name)
  constructor(
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
  ) {}

  async createJobConfig(jobConfigData: JobConfigDto): Promise<JobConfigEntity> {
    const jobRecord = this.jobConfigRepo.create({
      ...jobConfigData,
      firstRunAt: jobConfigData?.firstRunAt?.toISOString() ?? new Date().toISOString()
    });
    return await this.jobConfigRepo.save(jobRecord);
  }


  async createBulkDiscovery(bulkDiscovery: JobConfigDiscoverBulk): Promise<JobConfigEntity[]> {
    const firstRunAt = bulkDiscovery?.firstRunAt?.toISOString() ?? new Date().toISOString()
    const jobRecord: JobConfigEntity[] = bulkDiscovery.sourcePathIds.map((path: string) :JobConfigEntity=> this.jobConfigRepo.create({
      status: JobStatus.Active,
      excludeFilePatterns: bulkDiscovery.excludeFilePatterns,
      jobType:  JobType.Scan,
      preserveAccessTime: bulkDiscovery.preserveAccessTime,
      sourcePathId: path,
      excludeOlderThan:  bulkDiscovery.excludeOlderThan,
      futureScheduleAt: bulkDiscovery.futureSchedule,
      firstRunAt: firstRunAt,
      createdBy: bulkDiscovery.createdBy
    }))
    return await this.jobConfigRepo.save(jobRecord);
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

  async getAllJobConfig(): Promise<JobListingDTO[]> {
    const allJobsDetails = await this.jobConfigRepo.createQueryBuilder('jobconfig')
      .leftJoin('jobconfig.jobRun', 'jobRun')
      .leftJoin('jobconfig.sourcePath', 'volumes')
      .leftJoin('volumes.fileServer', 'fileServer')
      .leftJoin('fileServer.config', 'config')
      .select([
        'jobconfig.id AS jobConfigId',
        'jobconfig.jobType AS jobType',
        'jobconfig.status AS jobConfigStatus',
        'jobconfig.sourcePathId AS sourcePathId',
        'jobconfig.targetPathId AS targetPathId',
        'jobconfig.futureScheduleAt AS futureSchedule',
        'volumes.volumePath AS path',
        'fileServer.protocol AS protocol',
        'config.configName AS configName',
        'jobconfig.createdAt AS createdAt',
      ]).addSelect('COUNT(jobRun.id)', 'totalRuns')
      .groupBy('jobconfig.id')
      .addGroupBy('jobconfig.jobType')
      .addGroupBy('jobconfig.status')
      .addGroupBy('jobconfig.sourcePathId')
      .addGroupBy('jobconfig.targetPathId')
      .addGroupBy('jobconfig.futureScheduleAt')
      .addGroupBy('volumes.volumePath')
      .addGroupBy('fileServer.protocol')
      .addGroupBy('config.configName')
      .addGroupBy('jobconfig.createdAt')
      .getRawMany();
    const payload: JobListingDTO[] = [];
    allJobsDetails.forEach((job) => {
      payload.push({
        jobConfigId: job.jobconfigid,
        jobType: job.jobtype,
        jobStatus: job.jobconfigstatus,
        nextScheduleDate: parser.parseExpression(job.futureschedule).next().toDate(),
        sourcePath: job.path,
        destinationPath: job.targetPathId,
        errors: 0,
        protocol: job.protocol,
        totalRuns: job.totalRuns,
        configName: job.configname
      });
    });
    return payload
  }
}
