import { HttpException, HttpStatus, Injectable, Logger,BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { validate as isUUID, v4 as uuidv4 } from 'uuid';
import { Repository } from 'typeorm';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobConfigDto } from './dto/jobconfig.dto';
import { JobListingDTO } from './dto/joblisting.dto';
import { JobConfigCutoverBulk, JobConfigDiscoverBulk, JobConfigMigrateBulk, JobConfigPrecheck, MigrateConfig } from './dto/jobdicoverybulk.dto';
import { JobConfigBulkMigrateResStatus, JobRunStatus, JobStatus, JobType, Protocol, TemplateType } from 'src/constants/enums';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { FlattenedCutoverConfig, InActivateJobConfigPayload, JobConfigBulkCutoverRes, JobConfigBulkMigrateRes, JobConfigPrecheckRes } from './jobconfig.types';
import { OnEvent } from '@nestjs/event-emitter';
import { EmitterEvents } from 'src/constants/events';
import { ScheduleStatus } from 'src/constants/status';
import { nextDate } from 'src/utils/mapper';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { BulkMigrateJobConfig } from './dto/bulkMigrateJob.dto';
import { ProjectEntity } from 'src/entities/project.entity';

@Injectable()
export class JobConfigService {
  private readonly logger = new Logger(JobConfigService.name)
  constructor(
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
    @InjectRepository(InventoryEntity)
    private inventoryRepo: Repository<InventoryEntity>,
    @InjectRepository(JobRunEntity)
    private jobRunRepo: Repository<JobRunEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
  ) {}

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

  async createBulkMigrate(bulkMigrate: BulkMigrateJobConfig): Promise<JobConfigBulkMigrateRes[]> {
    const firstRunAt = bulkMigrate?.firstRunAt ?? new Date();
    const jobConfigs: Partial<JobConfigEntity>[] = [];

    if (!bulkMigrate?.migrateConfigs) {
      return [];
    }

    for (const config of bulkMigrate.migrateConfigs) {
      if (!config?.destinationPathId) {
        continue;
      }

      for (const destinationPath of config.destinationPathId) {
        const existingJobConfigs = await this.jobConfigRepo.find({
          where: { jobType: JobType.MIGRATE, sourcePathId: config?.sourcePathId, targetPathId: destinationPath },
          select: { sourcePathId: true, targetPathId: true, scheduler: true }
        });

        const existingSet = new Set(existingJobConfigs.map(jobConfig => `${jobConfig?.sourcePathId}-${jobConfig?.targetPathId}`));

        if (existingSet.has(`${config?.sourcePathId}-${destinationPath}`)) {
          await this.jobConfigRepo.update(
            {
              jobType: JobType.MIGRATE,
              sourcePathId: config?.sourcePathId,
              targetPathId: destinationPath,
              scheduler: In([ScheduleStatus.READY_TO_BE_SCHEDULED, ScheduleStatus.SCHEDULING])
            },
            {
              excludeFilePatterns: bulkMigrate?.options?.excludeFilePatterns,
              preserveAccessTime: bulkMigrate?.options?.preserveAccessTime,
              excludeOlderThan: bulkMigrate?.options?.excludeOlderThan,
              firstRunAt: firstRunAt,
              scheduler: ScheduleStatus.SCHEDULING
            }
          );
        } else {
          jobConfigs.push(this.jobConfigRepo.create({
            status: JobStatus.Active,
            excludeFilePatterns: bulkMigrate?.options?.excludeFilePatterns,
            jobType: JobType.MIGRATE,
            preserveAccessTime: bulkMigrate?.options?.preserveAccessTime,
            sourcePathId: config?.sourcePathId,
            targetPathId: destinationPath,
            excludeOlderThan: bulkMigrate?.options?.excludeOlderThan,
            firstRunAt: firstRunAt,
            scheduler: ScheduleStatus.SCHEDULING,
            futureScheduleAt: bulkMigrate?.futureRunSchedule
          }));
        }
      }
    }

    if (jobConfigs.length > 0) {
      return (await this.jobConfigRepo.save(jobConfigs)).map(({ id, jobType, sourcePathId, targetPathId }) => ({
        id,
        jobType,
        status: JobConfigBulkMigrateResStatus.CREATED,
        sourcePathId,
        targetPathId
      }));
    } else {
      return [];
    }
  }

  async createBulkCutover(
    bulkCutover: JobConfigCutoverBulk
  ): Promise<JobConfigBulkCutoverRes[]> {
    try {
      const allCutoverConfigs = this.flattenCutoverConfig(
        bulkCutover.cutoverConfig
      );
      const jobConfigs = await this.findJobConfigs(allCutoverConfigs);
      const jobRunStatuses = await this.jobRunRepo.find({
        where: { jobConfigId: In(jobConfigs.map((j) => j.id)) },
        order: { endTime: "DESC" }, 
      });

      const latestJobStatusMap = new Map<
        string,
        { status: JobRunStatus; endTime: Date }
      >();

      jobRunStatuses.forEach((jobRun) => {
        if (!latestJobStatusMap.has(jobRun.jobConfigId)) {
          latestJobStatusMap.set(jobRun.jobConfigId, {
            status: jobRun.status,
            endTime: jobRun.endTime,
          });
        }
      });

      const completedMigrations = jobConfigs.filter(
        (config) =>
          config.jobType === JobType.MIGRATE &&
          latestJobStatusMap.has(config.id) &&
          latestJobStatusMap.get(config.id)!.status === JobRunStatus.Completed
      );

      const jobConfigMap = new Map<string, JobConfigEntity>();
      completedMigrations.forEach((config) => {
        jobConfigMap.set(config.id, config);
      });

      const newCutoverJobs: JobConfigEntity[] = [];

      for (const { sourcePathId, destinationPathId } of allCutoverConfigs) {
        for (const config of jobConfigMap.values()) {
          if (
            config.sourcePathId === sourcePathId &&
            config.targetPathId === destinationPathId
          ) {
            const existingCutover = await this.jobConfigRepo.findOne({
              where: {
                jobType: JobType.CutOver,
                sourcePathId,
                targetPathId: destinationPathId,
              },
            });

            if (!existingCutover) {
              newCutoverJobs.push(
                this.jobConfigRepo.create({
                  jobType: JobType.CutOver,
                  sourcePathId,
                  targetPathId: destinationPathId,
                  excludeFilePatterns: config.excludeFilePatterns,
                  scheduler: config.scheduler,
                  futureScheduleAt: config.futureScheduleAt,
                  status: config.status,
                  preserveAccessTime: config.preserveAccessTime,
                  firstRunAt: config.firstRunAt,
                })
              );
            }
          }
        }
      }

      const savedJobs = await this.jobConfigRepo.save(newCutoverJobs);

      if (savedJobs.length === 0) {
        throw new HttpException(
          {
            status: "failed",
            message:
              "No completed migration found for the given source path ID or its already exists",
          },
          HttpStatus.BAD_REQUEST
        );
      }

      return savedJobs.map((job) => ({
        id: job.id,
        jobType: job.jobType,
        sourcePathId: job.sourcePathId,
        targetPathId: job.targetPathId,
        status: "created",
      }));
    } catch (error) {
      throw new HttpException(
        {
          status: "failed",
          message:
            error.message ||
            "An error occurred while creating bulk cutover job",
        },
        HttpStatus.INTERNAL_SERVER_ERROR
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
        isReportReady: jobRun.isReportReady,
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

  async getConfigsByProjectId(projectId: string) {
    if (!isUUID(projectId))
      throw new BadRequestException('Invalid projectId');

    const project = await this.projectRepo.findOne({
      select: {
        id: true,
        projectName: true,
        configs: {
          id: true,
          configName: true,
          fileServers: {
            id: true,
            protocol: true,
            volumes: {
              id: true,
              volumePath: true
            }
          }
        }
      },
      where: { id: projectId },
      relations: {
        configs: {
          fileServers: {
            volumes: true
          }
        }
      }
    });

    if (!project) throw new NotFoundException(`Project for id ${projectId} not found.`);
    return project;
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

  private templates = {
    sid: 'sid_template.csv',
    gid: 'gid_template.csv',
    uid: 'uid_template.csv',
  };

  getTemplateFilename(type: TemplateType) {
    return this.templates[type];
  }

  sendCsvFile(filename: string, res: Response) {
    const filePath = join(process.cwd(), process.env.TEMPLATES_PATH, filename);
    this.logger.log(`filePath ${filePath}`);
    
    if (!existsSync(filePath)) {
      throw new NotFoundException(`CSV file ${filename} not found at ${filePath}`);
    }

    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'text/csv');

    const fileStream = createReadStream(filePath);
    
    fileStream.pipe(res);
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
      const sourceParam = `sourcePathId_${index}`;
      const targetParam = `destinationPathId_${index}`;
      if (index === 0) {
        queryBuilder.where(
          `(jobConfig.sourcePathId = :${sourceParam} AND jobConfig.targetPathId = :${targetParam}) AND jobConfig.jobType = 'MIGRATE'`,
          { [sourceParam]: sourcePathId, [targetParam]: destinationPathId }
        );
      } else {
        queryBuilder.orWhere(
          `(jobConfig.sourcePathId = :${sourceParam} AND jobConfig.targetPathId = :${targetParam})`,
          { [sourceParam]: sourcePathId, [targetParam]: destinationPathId }
        );
      }
    });
    return await queryBuilder.getMany();
  }
}
