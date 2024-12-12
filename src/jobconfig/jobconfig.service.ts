import { v4 as uuid } from 'uuid';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { Injectable, Logger } from '@nestjs/common';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { CreateJobConfigDto } from '../dto/jobconfig.dto';
import { JobListingDTO } from 'src/jobconfig/joblisting.dto';
import * as parser from 'cron-parser';
import { log } from 'console';
import { FindallJobDetailsPageDto } from 'src/jobconfig/findallJobDetails.dto';
import { JobStatus } from 'src/constants/enums';

@Injectable()
export class JobConfigService {
  private readonly logger = new Logger(JobConfigService.name)
  constructor(
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
  ) {}

  // async createJobConfig(jobConfigData: CreateJobConfigDto): Promise<JobConfigEntity> {
  //   this.logger.log(`Data to job - ${JSON.stringify(jobConfigData)}`);
  //   const jobRecord = this.jobConfigRepo.create({
  //     jobType: jobConfigData.jobType,
  //     status: jobConfigData.status,
  //     jobSchedule: jobConfigData.jobSchedule,
  //     excludeOlderThan: jobConfigData.excludeOlderThan,
  //     preserveAccessTime: jobConfigData.preserveAccessTime,
  //     sourcePathId: jobConfigData.sourcePathId,
  //     targetPathId: jobConfigData.targetPathId,
  //     createdBy: jobConfigData?.createdBy,
  //     updatedBy: jobConfigData?.updatedBy
  //   });
  //   return this.jobConfigRepo.save(jobRecord);
  // }

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
      .leftJoin('jobrun', 'jobRun', 'jobRun.jobConfig Id = jobconfig.id')
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

  async getAllJobConfig(): Promise<JobListingDTO[]> {
    const allJobsDetails = await this.jobConfigRepo.createQueryBuilder('jobconfig')
      .leftJoin('jobconfig.jobRunDetails', 'jobRun')
      .leftJoin('jobconfig.paths', 'volumes')
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
      log(job)
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
