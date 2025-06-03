import { v4 as uuid } from 'uuid';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Injectable, NotFoundException } from '@nestjs/common';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

import { WorkflowService } from '../workflow/workflow.service';
import { StartWorkFlowPayload } from '../workflow/workflow.types';
import { FileServerEntity } from '../entities/fileserver.entity';
import { VolumeEntity } from '../entities/volume.entity';
import { UserDetails } from '../configurations/configuration.types';
import { PathUploadsEntity } from 'src/entities/pathupload.entity';
import { ImportVolumePathsDto } from './dto/path-upload.dto';
import { ExportPathSource, UploadPathAction, WorkFlows } from 'src/constants/enums';

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
          id: uuid(),
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

  async confirmPathUpload(uploadId: string, userDetails?: UserDetails): Promise<any> {
    const upload = await this.uploadRepo.findOneBy({ id: uploadId });
    if (!upload) {
      this.logger.error(`Upload with ID ${uploadId} not found`);
      throw new NotFoundException(`Upload with ID ${uploadId} not found`);
    }

    return {
      status: 'success',
      message: 'Path upload confirmed successfully',
      uploadId: upload.id
    };
  }

  async processExportPathUpload(uploadId: string): Promise<{ status: string, message: string, workflowId?: string }> {
    const upload = await this.uploadRepo.find({ where: { uploadId } });
    if (!upload.length) {
      this.logger.error(`Upload with ID ${uploadId} not found`);
      throw new Error(`Upload with ID ${uploadId} not found`);
    }
    const fileServerId = upload[0].fileServerId;
    const fileServer = await this.fileServerRepo.findOne({ where: { id: fileServerId }, relations: ['workers'] });
    this.logger.log(`Processing export path upload with ID ${uploadId}`);

    const traceId = uploadId;
    const startWorkFlowPayload: StartWorkFlowPayload = {
      workflowId: `${WorkFlows.VALIDATE_PATHS}-${traceId}`,
      taskQueue: 'ParentWorkflow-TaskQueue',
      args: [{
        traceId: traceId,
        payload: {
          traceId,
          paths: upload.map(path => path.volumePath),
          fileServer: {
            type: fileServer?.protocol,
            protocolVersion: fileServer?.protocolVersion.replace(/^v/, ''),
            host: fileServer?.host.trim(),
            username: fileServer?.userName,
            password: fileServer?.password,
          },
          workerIds: fileServer.workers.map(worker => worker.workerId),
        },
        options: {},
      }]
    };
    await this.workFlowService.startWorkflow(WorkFlows.VALIDATE_PATHS, startWorkFlowPayload);
    return {
      status: 'success',
      message: 'Export path upload processed successfully',
      workflowId: 'workflow.workflowId',
    }
  }
}