import { v4 as uuid } from 'uuid';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { Injectable, Logger } from '@nestjs/common';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { CreateJobConfigDto } from '../dto/jobconfig.dto';
import { JobListingDTO } from 'src/jobconfig/joblisting.dto';
import * as parser from 'cron-parser';
import { error, log } from 'console';
import { FindallJobDetailsPageDto } from 'src/jobconfig/findallJobDetails.dto';
import { JobStatus } from 'src/constants/enums';
import path from 'path';
import { InventoryEntity } from 'src/entities/inventory.entity';

@Injectable()
export class JobConfigService {
  private readonly logger = new Logger(JobConfigService.name)
  constructor(
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
    @InjectRepository(InventoryEntity)
    private inventoryRepo: Repository<InventoryEntity>,
  ) { }

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

  async getJobConfigById(id: string): Promise<any> {
    const jobConfig = await this.jobConfigRepo.findOne({ where: { id },  
      relations: [
        'jobRuns',
        'sourcePath', 
        'sourcePath.fileServer', 
        'sourcePath.fileServer.config',
        'targetPath',
        'targetPath.fileServer',
        'targetPath.fileServer.config',
      ],
    });

    const runStats= await Promise.all(jobConfig.jobRuns.map(async (jobRun) => {
    
      const inventoryCounts = await this.inventoryRepo
        .createQueryBuilder('inventory')
        .select([
          "SUM(CASE WHEN inventory.isDirectory = false THEN 1 ELSE 0 END) AS fileCount",
          "SUM(CASE WHEN inventory.isDirectory = true THEN 1 ELSE 0 END) AS directoryCount",
          "SUM(inventory.fileSize) AS totalSize",
        ])
        .where('inventory.jobRunId = :jobRunId', { jobRunId: jobRun.id })
        .getRawOne();
      return {
        jobRunId: jobRun.id,
        status: jobRun.status,
        startTime: jobRun.startTime,
        endTime: jobRun.endTime, 
        jobType: jobConfig.jobType,
        timeElapsed : jobRun.endTime ? jobRun.endTime.getTime() - jobRun.startTime.getTime()  : Date.now() - jobRun.startTime.getTime(),
        scannedFilesCount: BigInt(inventoryCounts.filecount || '0')?.toString(),
        scannedDirectoriesCount: BigInt(inventoryCounts.directorycount || '0')?.toString(),
        totalScannedSize: BigInt(inventoryCounts.totalsize || '0')?.toString(),
        errors: []
      };
    }));
  
    const payload={
      id: jobConfig.id,
    jobType: jobConfig.jobType,
    sourceServer: {
      serverName: jobConfig.sourcePath?.fileServer?.config?.configName || null,
      path: jobConfig.sourcePath?.volumePath || null,
      protocol: jobConfig.sourcePath?.fileServer?.protocol || null,
    },

    destinationServer: jobConfig.targetPath? {
      serverName: jobConfig.targetPath?.fileServer?.config?.configName || null,
      path: jobConfig.targetPath?.volumePath || null,
      protocol: jobConfig.targetPath?.fileServer?.protocol || null,
    }:{},

    status: jobConfig.status,    
    createdAt: jobConfig.createdAt,
    jobRuns: runStats,
    errors: [],
  };
    console.log(payload)
    if (!jobConfig) {
      throw new Error(`Job with id ${id} not found`);
    }
    return payload;
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

  async getAllJobConfig(projectId:string): Promise<JobListingDTO[]> {
    const allJobsDetails = await this.jobConfigRepo.createQueryBuilder('jobconfig')
      .leftJoin('jobconfig.jobRuns', 'jobRun')
      .leftJoin('jobconfig.sourcePath', 'sourceVolumes')
      .leftJoin('jobconfig.targetPath', 'targetVolumes')
      .leftJoin('sourceVolumes.fileServer', 'sourceFileServer')
      .leftJoin('targetVolumes.fileServer', 'targetFileServer')
      .leftJoin('sourceFileServer.config', 'sourceConfig')
      .leftJoin('targetFileServer.config', 'targetConfig')
      .select([
        'jobconfig.id AS jobConfigId',
        'jobconfig.jobType AS jobType',
        'jobconfig.status AS jobConfigStatus',
        'jobconfig.sourcePathId AS sourcePath',
        'jobconfig.targetPathId AS targetPath',
        'jobconfig.futureScheduleAt AS futureSchedule',
        'sourceVolumes.volumePath AS sourcePath',
        'targetVolumes.volumePath AS targetPath',
        'sourceFileServer.protocol AS sourceProtocol',
        'targetFileServer.protocol AS targetProtocol',
        'sourceConfig.configName AS sourceServerName',
        'targetConfig.configName AS targetServerName',
        'jobconfig.createdAt AS createdAt',
      ]).addSelect('COUNT(jobRun.id)', 'totalRuns')
      .where('sourceConfig.projectId = :projectId', { projectId })
      .orWhere('targetConfig.projectId = :projectId', { projectId })
      .groupBy('jobconfig.id')
      .addGroupBy('jobconfig.jobType')
      .addGroupBy('jobconfig.status')
      .addGroupBy('jobconfig.sourcePathId')
      .addGroupBy('jobconfig.targetPathId')
      .addGroupBy('jobconfig.futureScheduleAt')
      .addGroupBy('sourceVolumes.volumePath')
      .addGroupBy('targetVolumes.volumePath')
      .addGroupBy('sourceFileServer.protocol')
      .addGroupBy('targetFileServer.protocol')
      .addGroupBy('sourceConfig.configName')
      .addGroupBy('targetConfig.configName')
      .addGroupBy('jobconfig.createdAt')
      .getRawMany();
    console.log(allJobsDetails)

    const payload: JobListingDTO[] = [];
    allJobsDetails.forEach((job) => {
      log(job)
      payload.push({
        jobConfigId: job.jobconfigid,
        jobType: job.jobtype,
        jobStatus: job.jobconfigstatus,
        nextScheduleDate: parser.parseExpression(job.futureschedule).next().toDate(),
        sourceServer: {
          serverName: job.sourceservername,
          path: job.sourcepath,
          protocol: job.sourceprotocol
        },
        destinationServer: job.targetpath ? {
          serverName: job.targetservername,
          path: job.targetpath,
          protocol: job.targetprotocol
        } : {},
        errors: 0,
        totalRuns: job.totalRuns,
        configName: job.configname
      });
    });
    return payload
  }
}
