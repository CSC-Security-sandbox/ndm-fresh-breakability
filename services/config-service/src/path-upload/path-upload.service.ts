import { v4 as uuid } from 'uuid';
import { In, Not, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

import { WorkflowService } from '../workflow/workflow.service';
import { StartWorkFlowPayload } from '../workflow/workflow.types';
import { FileServerEntity } from '../entities/fileserver.entity';
import { VolumeEntity } from '../entities/volume.entity';
import { UserDetails } from '../configurations/configuration.types';
import { PathUploadsEntity } from 'src/entities/pathupload.entity';
import { ImportVolumePathsDto } from './dto/path-upload.dto';
import { ExportPathSource, UploadPathAction, WorkFlows } from 'src/constants/enums';
import { JobConfigEntity, JobStatus } from 'src/entities/jobconfig.entity';
import { JobRunEntity, JobRunStatus } from 'src/entities/jobrun.entity';
import * as fs from 'fs';
import { join } from 'path';

@Injectable()
export class PathUploadService {
  private logger: LoggerService;
  constructor(
    private loggerFactory: LoggerFactory,
    private readonly workFlowService: WorkflowService,

    @InjectRepository(PathUploadsEntity)
    private readonly uploadRepo: Repository<PathUploadsEntity>,

    @InjectRepository(FileServerEntity)
    private readonly fileServerRepo: Repository<FileServerEntity>,
    
    @InjectRepository(VolumeEntity)
    private readonly volumeRepo: Repository<VolumeEntity>,

    @InjectRepository(JobConfigEntity)
    private readonly jobConfigRepo: Repository<JobConfigEntity>,

    @InjectRepository(JobRunEntity)
    private readonly jobRunRepo: Repository<JobRunEntity>,
  ) {
    this.logger = this.loggerFactory.create(PathUploadService.name);
  }

  async processFileUpload(importVolumePathsDto: ImportVolumePathsDto, fileServerId: string, userDetails?: UserDetails): Promise<any> {
    const fileServer = await this.fileServerRepo.findOneBy({ id: fileServerId });
    if (!fileServer) throw new NotFoundException('File server does not exists');
    
    if (!!fileServer && fileServer.exportPathSource !== ExportPathSource.MANUAL_UPLOAD) {
      this.logger.warn(`File server with ID ${fileServerId} is not configured for manual import`);
      throw new NotFoundException(`File server with ID ${fileServerId} is not configured for manual import`);
    }

    const parsedData = importVolumePathsDto.contents.split('\n').map(line => line.split(','));
    // check if the first line exists and is "path" if not return error if yes remove it
    if (parsedData.length === 0 || !parsedData[0][0].startsWith('path')) {
      throw new NotFoundException('CSV file is empty or does not contain valid data');
    }
    // If the first line is "path" then remove it
    if (parsedData[0][0].startsWith('path')) parsedData.shift();
    const fileName = importVolumePathsDto.fileName || null;

    const uploadStats = {
      newPaths: 0,
      alreadyExitingPaths: 0,
      noLongerAvailablePaths: 0,
    }
    const uploadId = uuid();
    for (const row of parsedData) {
      const [volumePath] = row;
      if (!volumePath || volumePath.trim() === '') continue;
      const trimmedPath = volumePath.trim();
      const existingPath = await this.volumeRepo.findOne({
        where: { volumePath: trimmedPath, fileServerId },
      });
      if (existingPath) {
        this.logger.warn(`Path ${trimmedPath} already exists for file server ${fileServerId}`);
        uploadStats.alreadyExitingPaths++;
        // createUpload
        await this.createUpload({
          id: existingPath.id,
          uploadId,
          volumePath: trimmedPath,
          fileServerId: fileServerId,
          fileName: fileName || '',
          action: UploadPathAction.DUPLICATE,
          createdBy: userDetails?.user?.id || null,
        });
        continue;
      }
      // If the path does not exist, create a new PathUploadsEntity
      await this.createUpload({
        id: uuid(),
        uploadId,
        volumePath: trimmedPath,
        fileServerId: fileServerId,
        fileName: fileName || '',
        action: UploadPathAction.CREATE,
        createdBy: userDetails?.user?.id || null,
      });
      this.logger.log(`New path ${trimmedPath} added for file server ${fileServerId}`);
      uploadStats.newPaths++;
    }

    // all the paths with fileServerId from the volume entity which are not in the uploadData, increment noLongerAvailablePaths count by number of such paths
    const existingPaths = await this.volumeRepo.find({
      where: { fileServerId },
      select: ['volumePath'],
    });

    existingPaths.filter(async path => {
      const isPathNoLongerAvailable = !parsedData.some(row => row[0].trim() === path.volumePath);
      if (isPathNoLongerAvailable) {
        uploadStats.noLongerAvailablePaths++;
        this.logger.warn(`Path ${path.volumePath} is no longer available for file server ${fileServerId}`);
        await this.createUpload({
          id: path.id,
          uploadId,
          volumePath: path.volumePath,
          fileServerId: fileServerId,
          fileName: fileName || '',
          action: UploadPathAction.DELETE,
          createdBy: userDetails?.user?.id || null,
        });
        // await this.volumeRepo.update({ id: path.id }, { isDisabled: true })
        return true;
      }
      return false;
    });

    return {
      status: 'success',
      message: 'File upload processed successfully',
      uploadId,
      newPaths: uploadStats.newPaths,
      alreadyExitingPaths: uploadStats.alreadyExitingPaths,
      noLongerAvailablePaths: uploadStats.noLongerAvailablePaths,
    };
  }

  async createUpload(uploadData: Partial<PathUploadsEntity>): Promise<Partial<PathUploadsEntity>> {
    const newUpload = this.uploadRepo.create(uploadData);
    const savedUpload = await this.uploadRepo.save(newUpload);
    return savedUpload;
  }

  async processUploadPathValidation(uploadId: string): Promise<{ status: string, message: string, workflowId?: string }> {
    const upload = await this.uploadRepo.find({ where: { uploadId } });
    if (!upload.length) {
      this.logger.error(`Upload with ID ${uploadId} not found`);
      throw new Error(`Upload with ID ${uploadId} not found`);
    }
    const fileServerId = upload[0].fileServerId;
    const fileServer = await this.fileServerRepo.findOne({ where: { id: fileServerId }, relations: ['workers'] });
    this.logger.log(`Processing export path upload with ID ${uploadId}`);

    // mark all the current paths as invalid
    for(const path of upload) {
      const isDisabled = path.action === UploadPathAction.DELETE ? true : false;
      await this.volumeRepo.update({ volumePath: path.volumePath, fileServerId: path.fileServerId }, { isValid: false, isDisabled })
    }

    const traceId = uploadId;
    const startWorkFlowPayload: StartWorkFlowPayload = {
      workflowId: `${WorkFlows.VALIDATE_PATHS}-${traceId}`,
      taskQueue: 'ParentWorkflow-TaskQueue',
      args: [{
        traceId: traceId,
        payload: {
          traceId,
          paths: upload.filter(up => up.action !== UploadPathAction.DELETE).map(path => {
            return { pathId: path.id, path: path.volumePath }
          }),
          fileServer: {
            type: fileServer?.protocol,
            protocolVersion: fileServer?.protocolVersion.replace(/^v/, ''),
            host: fileServer?.host.trim(),
            username: fileServer?.userName,
            password: fileServer?.password,
          },
          workerIds: fileServer.workers.map(worker => worker.workerId),
        },
        options: {
          workflowExecutionTimeout: '1h',
          workflowTaskTimeout: '120s',
          workflowRunTimeout: '120s',
        },
      }]
    };
    const workflow = await this.workFlowService.startWorkflow(WorkFlows.VALIDATE_PATHS, startWorkFlowPayload);
    return {
      status: 'success',
      message: 'Export path upload processed successfully',
      workflowId: workflow.workflowId,
    }
  }

  async processUploadUpdate(validationResult: any[], uploadId: string) {
    const updateResult = await this.uploadRepo.findOne({ where: { uploadId } });
    if (!updateResult) {
      this.logger.error(`Upload with ID ${uploadId} not found`);
      throw new NotFoundException(`Upload with ID ${uploadId} not found`);
    }
    if (!validationResult || !Array.isArray(validationResult) || validationResult.length === 0) {
      this.logger.error('Validation result is empty or invalid');
      throw new BadRequestException('Validation result is empty or invalid');
    }

    const fileServerId = updateResult.fileServerId;
    const result = await this.processValidationResult(fileServerId, validationResult);
    if (!result) {
      throw new BadRequestException('Failed to process validation result');
    }
    const createdBy = updateResult.createdBy || null;
    for (const validPath of result.validPaths) {
      const existingVolume = await this.volumeRepo.findOne({ where: { volumePath: validPath.volumePath, fileServerId } });
      if (existingVolume) {
        existingVolume.reachableCount = validPath.reachableCount;
        existingVolume.isValid = true;
        existingVolume.createdBy = createdBy;
        await this.volumeRepo.save(existingVolume);
      }
      else {
        const newVolume = this.volumeRepo.create({
          id: validPath.id,
          volumePath: validPath.volumePath,
          fileServerId,
          reachableCount: validPath.reachableCount,
          isValid: true,
          createdBy: createdBy,
        });
        await this.volumeRepo.save(newVolume);
      }
    }

    for (const invalidPath of result.invalidPaths) {
      const existingVolume = await this.volumeRepo.findOne({ where: { volumePath: invalidPath.volumePath, fileServerId } });
      if (existingVolume) {
        existingVolume.isValid = false;
        existingVolume.createdBy = createdBy;
        await this.volumeRepo.save(existingVolume);
      }
      else {
        const newVolume = this.volumeRepo.create({
          id: invalidPath.id,
          volumePath: invalidPath.volumePath,
          fileServerId,
          isValid: false,
          createdBy: createdBy,
        });
        await this.volumeRepo.save(newVolume);
      }
    }

    // Inactivate all the job configurations that are using invalid paths as sourcePathId or targetPathId 
    const inValidPaths = await this.volumeRepo.find({
      where: [{ fileServerId, isValid: false }, { fileServerId, isDisabled: true }],
      select: ['id'],
    })
    if(inValidPaths.length) {
      await this.jobConfigRepo
      .createQueryBuilder('jobConfig')
      .update()
      .set({ status:  JobStatus.InActive })
      .where('jobConfig.source_path_id IN (:...invalidVolumePaths) OR jobConfig.target_path_id IN (:...invalidVolumePaths)', { invalidVolumePaths: inValidPaths.map(path => path.id) })
      .andWhere('jobConfig.status = :status', { status: JobStatus.Active })
      .execute();
    }

    return result;
  }

  async createVolumeForFileServer(data: Partial<VolumeEntity>): Promise<VolumeEntity> {
    const fileServer = await this.fileServerRepo.findOne({ where: { id: data.fileServerId } });
    if (!fileServer) {
      this.logger.error(`File server with ID ${data.fileServerId} not found`);
      throw new Error(`File server with ID ${data.fileServerId} not found`);
    }

    const volumeEntity = this.volumeRepo.create(data);
    return await this.volumeRepo.save(volumeEntity);
  }

  async processValidationResult(fileServerId: string, validationResult: any[]) {
    const validPaths = new Map<string, any>();
    const invalidPaths = new Map<string, any>();
    
    const pathGroupedResults = validationResult.reduce((acc, item: any) => {
      item.validationResult.forEach(result => {
        const path = result.result.path;
        if (!acc[result.result.path]) {
          acc[path] = {
            id: result.result.pathId,
            volumePath: path,
            reachableCount: 0,
            fileServerId,
          };
        }
        if (result.result.status === 'success') {
          acc[path].reachableCount += 1;
          validPaths.set(path, acc[path]);
        } else {
          invalidPaths.set(path, { ...acc[path], id: result.result.pathId, message: result.result.message || 'Unknown error' });
        }
      });
      return acc;
    }, {});

    return {
      validPaths: Array.from(validPaths.values()),
      invalidPaths: Array.from(invalidPaths.values()),
      totalValidPaths: validPaths.size,
      totalInvalidPaths: invalidPaths.size,
      totalPaths: Object.keys(pathGroupedResults).length,
    };
  }

  async isRefreshPossible(fileServerId: string): Promise<boolean> {
    const fileServer = await this.fileServerRepo.findOne({
      where: { id: fileServerId },
      relations: { volumes: true },
    });
    if (!fileServer) {
      this.logger.error(`File server with ID ${fileServerId} not found`);
      throw new NotFoundException(`File server with ID ${fileServerId} not found`);
    }

    const volumeIds = fileServer.volumes.map(volume => volume.id);
    // fetch all the job configurations that has any of the volumeIds in their sourcePathId or targetPathId and status is ACTIVE
    const jobConfigs = await this.jobConfigRepo
      .createQueryBuilder('jobConfig')
      .where('jobConfig.sourcePathId IN (:...volumeIds) OR jobConfig.targetPathId IN (:...volumeIds)', { volumeIds })
      .andWhere('jobConfig.status = :status', { status: 'ACTIVE' })
      .getMany();
    
    // check if any job config has schedule as SCHEDULING if yes then return false
    if (jobConfigs.some(jc => jc.scheduler === 'SCHEDULING')) {
      this.logger.warn(`Refresh is not possible for file server ${fileServerId} as there are jobs with SCHEDULING status`);
      return false;
    }
    
    // check if futureScheduleAt is not null for any job config, if yes then return false
    if (jobConfigs.some(jc => !!jc.futureScheduleAt)) {
      this.logger.warn(`Refresh is not possible for file server ${fileServerId} as there are jobs with futureScheduleAt set`);
      return false;
    }

    // fetch all the jobs that are in running state for above job configurations
    const runningJobs = await this.jobRunRepo.count({
      where: {
        jobConfigId: In(jobConfigs.map(jc => jc.id)),
        status: JobRunStatus.Running,
      }
    })

    if (runningJobs > 0) {
      this.logger.warn(`Refresh is not possible for file server ${fileServerId} as there are running jobs`);
      return false;
    }
    
    this.logger.log(`Refresh is possible for file server ${fileServerId}`); 
    return true;
  }

  async createUploadDirectory(): Promise<void> {
    if (!fs.existsSync(join(process.cwd(), './uploads'))) {
      fs.mkdirSync(join(process.cwd(), './uploads'), { recursive: true });
    }
  }
}