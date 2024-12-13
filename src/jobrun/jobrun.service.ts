import { JobConfigService } from '../jobconfig/jobconfig.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Injectable, Logger } from '@nestjs/common';
import { FindManyOptions, In, Repository } from 'typeorm';
import { JobRunDto, JobRunFilterDto } from './jobrun.dto';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobRunStatus } from 'src/constants/enums';
import { InventoryEntity } from 'src/entities/inventory.entity';
import path from 'path';

@Injectable()
export class JobRunService {

  private readonly logger = new Logger(JobRunService.name);

  constructor(
    @InjectRepository(JobRunEntity)
    private jobRunRepo: Repository<JobRunEntity>,
    @InjectRepository(InventoryEntity)
    private inventoryRepo: Repository<InventoryEntity>,

    private readonly jobConfigService: JobConfigService
  ) { }

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

  async getJobAllRuns(
    page: number,
    limit: number,
    sortField: string,
    sortOrder: 'ASC' | 'DESC',
    filter: JobRunFilterDto,
  ) {
    const jobRuns = await this.jobRunRepo.createQueryBuilder('jobRun')
    .leftJoinAndSelect('jobRun.jobConfig', 'jobConfig')
    .leftJoinAndSelect('jobConfig.sourcePath', 'sourceVolume')
    .leftJoinAndSelect('jobConfig.targetPath', 'targetVolume')  // Assuming targetPath relates to Volumes
    .leftJoinAndSelect('sourceVolume.fileServer', 'sourceFileServer')
    .leftJoinAndSelect('targetVolume.fileServer', 'targetFileServer')
    .leftJoinAndSelect('sourceFileServer.config', 'sourceConfig')
    .leftJoinAndSelect('targetFileServer.config', 'targetConfig')
    .where('sourceConfig.projectId = :projectId', { projectId:filter.projectId })
    .orWhere('targetConfig.projectId = :projectId', { projectId:filter.projectId })
    .select([
      'jobRun.id AS jobRunId',
      'jobConfig.jobType AS jobType', 
      'jobConfig.id AS jobConfigId',
      'sourceVolume.volumePath AS volumePath',
      'sourceFileServer.protocol AS sourceFileServerProtocol',
      'sourceConfig.configName AS sourceConfigName',
      'targetVolume.volumePath AS targetVolumePath',
      'targetFileServer.protocol AS targetFileServerProtocol',
      'targetConfig.configName AS targetConfigName',
      'jobRun.status AS status',
      'jobRun.startTime AS startTime',
      'jobRun.endTime AS endTime',
    ])
    .getRawMany();

      console.log(jobRuns)

    const runStats = await Promise.all(jobRuns.map(async (jobRun) => {
      console.log(jobRun)

      const inventoryCounts = await this.inventoryRepo
        .createQueryBuilder('inventory')
        .select([
          "SUM(CASE WHEN inventory.isDirectory = false THEN 1 ELSE 0 END) AS fileCount",
          "SUM(CASE WHEN inventory.isDirectory = true THEN 1 ELSE 0 END) AS directoryCount",
          "SUM(inventory.fileSize) AS totalSize",
        ])
        .where('inventory.jobRunId = :jobRunId', { jobRunId: jobRun.jobrunid })
        .getRawOne();
      return {
        jobRunId: jobRun.id,
        status: jobRun.status,
        startTime: jobRun.starttime,
        endTime: jobRun.endtime,
        jobType: jobRun.jobtype,
        sourceServer: {
          serverName: jobRun.sourceconfigname,
          path: jobRun.volumepath,
          protocol: jobRun.sourcefileserverprotocol,
        },
        destinationServer: jobRun.targetvolumepath ? {
          serverName: jobRun.targetconfigname,
          path: jobRun.targetvolumepath,
          protocol: jobRun.targetfileserverprotocol,
        }:{},
        timeElapsed: jobRun.endtime ? jobRun.endtime.getTime() - jobRun.starttime.getTime() : Date.now() - jobRun.starttime.getTime(),
        scannedFilesCount: BigInt(inventoryCounts.filecount || '0')?.toString(),
        scannedDirectoriesCount: BigInt(inventoryCounts.directorycount || '0')?.toString(),
        totalScannedSize: BigInt(inventoryCounts.totalsize || '0')?.toString(),
        errors: []
      };
    }));
    return runStats;

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