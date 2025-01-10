import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobConfigDto } from './dto/jobconfig.dto';
import { JobListingDTO } from './dto/joblisting.dto';
import { JobConfigDiscoverBulk } from './dto/jobdicoverybulk.dto';
import { JobStatus, JobType } from 'src/constants/enums';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { InActivateJobConfigPayload } from './jobconfig.types';
import { OnEvent } from '@nestjs/event-emitter';
import { EmitterEvents } from 'src/constants/events';
import { ScheduleStatus } from 'src/constants/status';
import { nextDate } from 'src/utils/mapper';

@Injectable()
export class JobConfigService {
  private readonly logger = new Logger(JobConfigService.name)
  constructor(
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
    @InjectRepository(InventoryEntity)
    private inventoryRepo: Repository<InventoryEntity>,
  ) { }

  // ------------ Events ---------------- //
  @OnEvent(EmitterEvents.IN_ACTIVE_JOB_CONFIG)
  async inActivateJobConfig (payload: InActivateJobConfigPayload) {
    await this.jobConfigRepo.update({id: payload.jobConfigId}, {status: JobStatus.InActive})
  }

  // ------------ Bulk Discovery ---------------- //
  async createBulkDiscovery(bulkDiscovery: JobConfigDiscoverBulk): Promise<JobConfigEntity[]> {
    const firstRunAt = bulkDiscovery?.firstRunAt?.toISOString() ?? new Date().toISOString()
    const existingList = await this.jobConfigRepo.find({
      where: { jobType: JobType.DISCOVER, sourcePath: In(bulkDiscovery.sourcePathIds ?? [])}, select: {sourcePathId:true, scheduler: true}
    })
   
    await this.jobConfigRepo.update({jobType: JobType.DISCOVER, sourcePathId: In(bulkDiscovery?.sourcePathIds), scheduler: In([ScheduleStatus.READY_TO_BE_SCHEDULED, ScheduleStatus.SCHEDULING])}, {
      excludeFilePatterns: bulkDiscovery.excludeFilePatterns,
      preserveAccessTime: bulkDiscovery.preserveAccessTime,
      excludeOlderThan:  bulkDiscovery.excludeOlderThan,
      futureScheduleAt: bulkDiscovery.futureSchedule,
      firstRunAt: firstRunAt,
      scheduler: ScheduleStatus.SCHEDULING
    })

    const existingSet = new Set(existingList.map(it=>it.sourcePathId))
    const entries:JobConfigEntity[] = []

    bulkDiscovery.sourcePathIds.forEach((path: string) =>  {
      if(!existingSet.has(path))
        entries.push(this.jobConfigRepo.create({
          status: JobStatus.Active,
          excludeFilePatterns: bulkDiscovery.excludeFilePatterns,
          jobType:  JobType.DISCOVER,
          preserveAccessTime: bulkDiscovery.preserveAccessTime,
          sourcePathId: path,
          excludeOlderThan:  bulkDiscovery.excludeOlderThan,
          futureScheduleAt: bulkDiscovery.futureSchedule,
          firstRunAt: firstRunAt,
          scheduler: ScheduleStatus.SCHEDULING,
          createdBy: bulkDiscovery.createdBy
        })
      )})
    
    return await this.jobConfigRepo.save(entries);
  }

  // ------------ Bulk update ---------------- //
  async updateJobConfig(id: string, data: Partial<JobConfigDto>): Promise<JobConfigEntity> {
    const job = await this.jobConfigRepo.findOne({ where: { id } });
    if (!job) {
      throw new Error(`Job with id ${id} not found`);
    }
    Object.assign(job, data);
    return this.jobConfigRepo.save(job);
  }

  // ------------ Bulk delete ---------------- //
  async deleteJobConfig(id: string): Promise<{ message: string }> {
    const job = await this.jobConfigRepo.findOne({ where: { id } });
    if (!job) {
      throw new Error(`Job with id ${id} not found`);
    }
    await this.jobConfigRepo.remove(job);
    return { message: `Job with id ${id} has been deleted` };
  }

  // ------------ Job Config By Id ---------------- //
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

    if (!jobConfig) 
      throw new Error(`Job with id ${id} not found`);

    const runStats = await Promise.all(jobConfig.jobRuns.map(async (jobRun) => {
    
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
        totalScannedSize: this.covertBytes(Number(inventoryCounts.totalsize || '0')),
        errors: []
      };
    }));
  
    const payload={
      jobConfigId: id,
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

    return payload;
  }

  // ------------ Job Config All ---------------- //
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
        'jobconfig.firstRunAt AS firstRunAt',
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

    const payload: JobListingDTO[] = [];
    allJobsDetails.forEach((job) => {
      payload.push({
        jobConfigId: job.jobconfigid,
        jobType: job.jobtype,
        jobStatus: job.jobconfigstatus,
        nextScheduleDate: nextDate(job.jobtype, job.firstrunat, job.futureschedule),
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

  covertBytes(bytes: number): string {
    const bytesInKB = 1024;
    const bytesInMB = bytesInKB * 1024;
    const bytesInGB = bytesInMB * 1024;
    const bytesInTB = bytesInGB * 1024;
    const bytesInPB = bytesInTB * 1024;

    if (bytes < bytesInKB) {
        return `${bytes} B`;
    } else if (bytes < bytesInMB) {
        return `${(bytes / bytesInKB).toFixed(2)} KB`;
    } else if (bytes < bytesInGB) {
        return `${(bytes / bytesInMB).toFixed(2)} MB`;
    } else if (bytes < bytesInTB) {
        return `${(bytes / bytesInGB).toFixed(2)} GB`;
    } else if (bytes < bytesInPB) {
        return `${(bytes / bytesInTB).toFixed(2)} TB`;
    } else {
        return `${(bytes / bytesInPB).toFixed(2)} PB`;
    }
}


}
