import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobConfigDto } from './dto/jobconfig.dto';
import { JobListingDTO } from './dto/joblisting.dto';
import { JobConfigCutoverBulk, JobConfigDiscoverBulk, JobConfigMigrateBulk, JobConfigPrecheck, MigrateConfig } from './dto/jobdicoverybulk.dto';
import { JobRunStatus, JobStatus, JobType, Protocol } from 'src/constants/enums';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { FlattenedCutoverConfig, InActivateJobConfigPayload, JobConfigBulkCutoverRes, JobConfigBulkMigrateRes, JobConfigPrecheckRes } from './jobconfig.types';
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
    private inventoryRepo: Repository<InventoryEntity>
  ) { }

  // ------------ Events ---------------- //
  @OnEvent(EmitterEvents.IN_ACTIVE_JOB_CONFIG)
  async inActivateJobConfig (payload: InActivateJobConfigPayload) {
    await this.jobConfigRepo.update({id: payload.jobConfigId}, {status: JobStatus.InActive})
  }

  // ------------ Bulk Discovery ---------------- //
  async createBulkDiscovery(bulkDiscovery: JobConfigDiscoverBulk): Promise<JobConfigEntity[]> {
    const firstRunAt = bulkDiscovery?.firstRunAt ?? new Date()
    const existingList = await this.jobConfigRepo.find({
      where: { jobType: JobType.DISCOVER, sourcePath: In(bulkDiscovery.sourcePathIds ?? [])}, select: {sourcePathId:true, scheduler: true}
    })
   
    await this.jobConfigRepo.update({jobType: JobType.DISCOVER, sourcePathId: In(bulkDiscovery?.sourcePathIds), scheduler: In([ScheduleStatus.READY_TO_BE_SCHEDULED, ScheduleStatus.SCHEDULING])}, {
      excludeFilePatterns: bulkDiscovery.excludeFilePatterns,
      preserveAccessTime: bulkDiscovery.preserveAccessTime,
      excludeOlderThan:  bulkDiscovery.excludeOlderThan,
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
          firstRunAt: firstRunAt,
          scheduler: ScheduleStatus.SCHEDULING,
          createdBy: bulkDiscovery.createdBy
        })
      )})
    
    return await this.jobConfigRepo.save(entries);
  }

  async createBulkMigrate(bulkMigrate: JobConfigMigrateBulk): Promise<JobConfigBulkMigrateRes[]> {
    try {
      return [
        {
          status: 'created',
          id: 'b84f2e0a-c013-4c19-9fe7-4ff8c7d65d39',
          jobType: JobType.MIGRATE,
          sourcePathId: 'e98cb64f-57d5-40b7-b7fe-1c4fda581b6d',
          targetPathId: 'fc3d1b79-7288-4d8d-8bc3-ec0b7753dbfc'
        },
        {
          status: 'failed',
          id: 'b84f2e0a-c013-4c19-9fe7-4ff8c7d65d38',
          jobType: JobType.MIGRATE,
          sourcePathId: 'e98cb64f-57d5-40b7-b7fe-1c4fda581b6d',
          targetPathId: 'fc3d1b79-7288-4d8d-8bc3-ec0b7753dbfd'
        }
      ];
    } catch (error) {
      throw new HttpException({
          status: 'failed',
          message: error.message || 'An error occurred while creating bulk migrate job',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }


  async createBulkCutover(bulkCutover: JobConfigCutoverBulk): Promise<JobConfigBulkCutoverRes[]> {
    try {
      // Step 1: flat the array with one source path with one destinataion path.
      const allCutoverConfigs = this.flattenCutoverConfig(bulkCutover.cutoverConfig);
      // Step 2: fetch base migration record and it's currosponding file_server, jobconfigs.
      const jobConfigs = await this.findJobConfigs(allCutoverConfigs);
      return jobConfigs as any;
      // Step 3: extract exclude pattern details.
      // Step 4: create jobconfig for the step 1 with exclude patterns from step 3.
      return [
        {
          status: 'created',
          id: 'b84f2e0a-c013-4c19-9fe7-4ff8c7d65d39',
          jobType: JobType.CutOver,
          sourcePathId: 'e98cb64f-57d5-40b7-b7fe-1c4fda581b6d',
          targetPathId: 'fc3d1b79-7288-4d8d-8bc3-ec0b7753dbfc',
        },
        {
          status: 'failed',
          id: 'b84f2e0a-c013-4c19-9fe7-4ff8c7d65d38',
          jobType: JobType.CutOver,
          sourcePathId: 'e98cb64f-57d5-40b7-b7fe-1c4fda581b6d',
          targetPathId: 'fc3d1b79-7288-4d8d-8bc3-ec0b7753dbfd',
        }
      ];
    } catch (error) {
      throw new HttpException({
          status: 'failed',
          message: error.message || 'An error occurred while creating bulk cutover job',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  flattenCutoverConfig(config: MigrateConfig[]): FlattenedCutoverConfig[] {
    return config.flatMap(({ sourcePathId, destinationPathId }) =>
      destinationPathId.map((destId) => ({
        sourcePathId,
        destinationPathId: destId,
      }))
    );
  }

  async precheck(data: JobConfigPrecheck): Promise<JobConfigPrecheckRes[]> {
    try {
      return [
        {
          status: "success",
          workerId: "worker-12345",
          workerName: "worker",
          sourceFileServerConnection: {
            status: "success",
            message: "File server connection established."
          },
          targetFileServerConnection: {
            status: "success",
            message: "File server connection established."
          },
          mountStatus: {
            status: "mounted"
          },
          permissions: {
            source: {
              path: "/mnt/source",
              writeAccess: true,
              message: "Worker has write access to the source path."
            },
            target: {
              path: "/mnt/target",
              writeAccess: true,
              message: "Worker has write access to the target path."
            }
          }
        }
      ]
    } catch (error) {
      throw new HttpException({
          status: 'failed',
          message: error.message || 'An error occurred precheck',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ------------  update ---------------- //
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
      aggregateData: {
        timeElapsed: 0,
        scannedFilesCount: 0,
        scannedDirectoriesCount: 0,
        totalScannedSize: "0 B"
      },
      errors: [],
    };

    return payload;
  }

  async getCutoverDetailsByFileServerId(fileServerId: string) {
    return [{
      protocol: Protocol.NFS,
      sourcePath: { id: 'b84f2e0a-c013-4c19-9fe7-4ff8c7d65d39', sourcePathName: '/source/test' },
      destinationFileServer: { id: 'b84f2e0a-c013-4c19-9fe7-4ff8c7d65d39', destinationFileServerName: 'fileServer1' },
      destinationPath: { id: 'b84f2e0a-c013-4c19-9fe7-4ff8c7d65d39', destinationPathName: '/destination/test' },
      jobConfig: [{
        id: 'b84f2e0a-c013-4c19-9fe7-4ff8c7d65d39',
        jobType: JobType.MIGRATE,
        jobRunDetails: {
          id: 'b84f2e0a-c013-4c19-9fe7-4ff8c7d65d39',
          status: JobRunStatus.Completed
        }
      }]
    }]
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
        'jobconfig.createdAt AS "createdAt"',
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
        configName: job.configname,
        createdAt: job.createdAt
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

  async findJobConfigs(conditions: { sourcePathId: string; destinationPathId: string }[]) {
    if (conditions.length === 0) return [];
    const queryBuilder = this.jobConfigRepo.createQueryBuilder("jobConfig");
    conditions.forEach(({ sourcePathId, destinationPathId }, index) => {
      if (index === 0) {
        queryBuilder.where(
          "(jobConfig.sourcePathId = :sourcePathId0 AND jobConfig.targetPathId = :destinationPathId0) and jobType = 'MIGRATE'",
          { sourcePathId, destinationPathId }
        );
      } else {
        queryBuilder.orWhere(
          `(jobConfig.sourcePathId = :sourcePathId${index} AND jobConfig.targetPathId = :destinationPathId${index}) and jobType = 'MIGRATE'`,
          { [`sourcePathId${index}`]: sourcePathId, [`targetPathId${index}`]: destinationPathId }
        );
      }
    });
    return await queryBuilder.getMany();
  }
}
