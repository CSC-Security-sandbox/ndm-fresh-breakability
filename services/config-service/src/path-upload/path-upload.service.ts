import { v4 as uuid } from 'uuid';
import { Brackets, In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

import { WorkflowService } from '../workflow/workflow.service';
import { StartWorkFlowPayload } from '../workflow/workflow.types';
import { FileServerEntity } from '../entities/fileserver.entity';
import { VolumeEntity } from '../entities/volume.entity';
import { UserDetails } from '../configurations/configuration.types';
import { PathUploadsEntity } from 'src/entities/pathupload.entity';
import { ImportVolumePathsDto } from './dto/path-upload.dto';
import {ExportPathSource, UploadPathAction, WorkFlows} from 'src/constants/enums';
import { JobConfigEntity, JobStatus } from 'src/entities/jobconfig.entity';
import { JobRunEntity, JobRunStatus } from 'src/entities/jobrun.entity';
import * as fs from 'fs';

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

  async processFileUpload(
    importVolumePathsDto: ImportVolumePathsDto,
    fileServerId: string,
    userDetails?: UserDetails,
  ): Promise<any> {
    try {
      const fileServer = await this.fileServerRepo.findOneBy({
        id: fileServerId,
      });
      if (!fileServer)
        throw new BadRequestException(
          'An unexpected error occurred while uploading the file. The specified file server could not be found.',
        );

      if (
        !!fileServer &&
        fileServer.exportPathSource !== ExportPathSource.MANUAL_UPLOAD
      ) {
        this.logger.warn(
          `The file server with ID ${fileServerId} is not set up for manual upload`,
        );
        throw new BadRequestException(
          `An unexpected error occurred while uploading the file. The file server with ID ${fileServerId} is not set up for manual upload`,
        );
      }

      const parsedData = importVolumePathsDto.contents
        .split('\n')
        .map((line) => line.split(','));
      // check if the first line exists and is "path" if not return error if yes remove it
      if (parsedData.length === 0 || !parsedData[0][0].startsWith('path')) {
        throw new BadRequestException(
          'An unexpected error occurred while uploading the file. The CSV file is either empty or missing a valid header. It should start with "path".',
        );
      }
      // If the first line is "path" then remove it
      if (parsedData[0][0].startsWith('path')) parsedData.shift();
      const fileName = importVolumePathsDto.fileName || null;

      // parsedData should contain at least one row after removing the header
      if (!parsedData.length) {
        throw new BadRequestException(
          'An unexpected error occurred while uploading the file. The CSV file is empty or lacks valid export paths.',
        );
      }

      const uploadStats = {
        newPaths: 0,
        alreadyExitingPaths: 0,
        noLongerAvailablePaths: 0,
      };
      const uploadId = uuid();
      const existingPaths = await this.volumeRepo.find({
        where: { fileServerId },
      });

      for (const row of parsedData) {
        const [volumePath] = row;
        const trimmedPath = volumePath.trim();
        if (!trimmedPath) continue;
        if (
          existingPaths.filter(
            (path) =>
              path.volumePath === trimmedPath &&
              path.fileServerId === fileServerId,
          ).length > 0
        ) {
          this.logger.warn(
            `Path ${trimmedPath} already exists for file server ${fileServerId}`,
          );
          uploadStats.alreadyExitingPaths++;
          // createUpload
          await this.createUpload({
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
          uploadId,
          volumePath: trimmedPath,
          fileServerId: fileServerId,
          fileName: fileName || '',
          action: UploadPathAction.CREATE,
          createdBy: userDetails?.user?.id || null,
        });
        this.logger.log(
          `New path ${trimmedPath} added for file server ${fileServerId}`,
        );
        uploadStats.newPaths++;
      }

      /*
        all the paths with fileServerId from the 
        volume entity which are not in the uploadData,
        increment noLongerAvailablePaths count by number of such paths
      */
      existingPaths.filter(async (path) => {
        const isPathNoLongerAvailable = !parsedData.some(
          (row) => row[0].trim() === path.volumePath,
        );
        if (isPathNoLongerAvailable) {
          uploadStats.noLongerAvailablePaths++;
          this.logger.warn(
            `Path ${path.volumePath} is no longer available for file server ${fileServerId}`,
          );
          await this.createUpload({
            id: path.id,
            uploadId,
            volumePath: path.volumePath,
            fileServerId: fileServerId,
            fileName: fileName || '',
            action: UploadPathAction.DELETE,
            createdBy: userDetails?.user?.id || null,
          });
          return true;
        }
        return false;
      });

      return {
        message: 'File upload processed successfully',
        uploadId,
        newPaths: uploadStats.newPaths,
        alreadyExitingPaths: uploadStats.alreadyExitingPaths,
        noLongerAvailablePaths: uploadStats.noLongerAvailablePaths,
      };
    } catch (error) {
      this.logger.error('Error processing file upload', error);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Error processing file upload  ${error.message}`,
      );
    }
  }

  async createUpload(
    uploadData: Partial<PathUploadsEntity>,
  ): Promise<Partial<PathUploadsEntity>> {
    const newUpload = this.uploadRepo.create(uploadData);
    const savedUpload = await this.uploadRepo.save(newUpload);
    return savedUpload;
  }

  async processUploadPathValidation(
    uploadId: string,
  ): Promise<{ message: string; workflowId?: string }> {
    try {
      const fileServer = await this.fileServerRepo
        .createQueryBuilder('fileServer')
        .leftJoinAndSelect('fileServer.uploads', 'uploads')
        .leftJoinAndSelect('fileServer.workers', 'workers')
        .where('uploads.uploadId = :uploadId', { uploadId })
        .getOne();

      if (!fileServer) {
        this.logger.error(`No upload found with ID ${uploadId}.`);
        throw new Error(`No upload found with ID ${uploadId}.`);
      }
      this.logger.log(`Processing export path upload with ID ${uploadId}`);

      // mark all the current paths as invalid
      const disabledPaths: string[] = [],
        enabledPaths: string[] = [];
      for (const path of fileServer.uploads) {
        if (path.action === UploadPathAction.DELETE)
          disabledPaths.push(path.volumePath);
        else enabledPaths.push(path.volumePath);
      }
      await this.volumeRepo.update(
        { fileServerId: fileServer.id, volumePath: In(disabledPaths) },
        { isDisabled: true },
      );
      await this.volumeRepo.update(
        { fileServerId: fileServer.id, volumePath: In(enabledPaths) },
        { isDisabled: false },
      );

      const traceId = uploadId;
      const startWorkFlowPayload: StartWorkFlowPayload = {
        workflowId: `${WorkFlows.VALIDATE_PATHS}-${traceId}`,
        taskQueue: 'ParentWorkflow-TaskQueue',
        args: [
          {
            traceId: traceId,
            payload: {
              traceId,
              paths: fileServer.uploads
                .filter((up) => up.action !== UploadPathAction.DELETE)
                .map((path) => {
                  return { pathId: path.id, path: path.volumePath };
                }),
              fileServer: {
                type: fileServer?.protocol,
                protocolVersion: fileServer?.protocolVersion.replace(/^v/, ''),
                host: fileServer?.host.trim(),
                username: fileServer?.userName,
                password: fileServer?.password,
              },
              workerIds: fileServer.workers.map((worker) => worker.workerId),
            },
            options: {
              workflowExecutionTimeout: '1h',
              workflowTaskTimeout: '120s',
            },
          },
        ],
      };
      const workflow = await this.workFlowService.startWorkflow(
        WorkFlows.VALIDATE_PATHS,
        startWorkFlowPayload,
      );
      return {
        message: 'Export path upload processed successfully',
        workflowId: workflow.workflowId,
      };
    } catch (error) {
      this.logger.error('Error processing export path upload', error);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'An unexpected error occurred while uploading export paths. ' +
          error.message,
      );
    }
  }

  async processUploadUpdate(validationResult: any[], uploadId: string) {
    try {
      const updateResult = await this.uploadRepo.findOne({
        where: { uploadId },
      });
      if (!updateResult) {
        this.logger.error(`No upload found with ID ${uploadId}.`);
        throw new NotFoundException(`No upload found with ID ${uploadId}.`);
      }
      if (
        !validationResult ||
        !Array.isArray(validationResult) ||
        validationResult.length === 0
      ) {
        this.logger.error('The validation result is missing or invalid.');
        throw new BadRequestException(
          'The validation result is missing or invalid.',
        );
      }

      const fileServerId = updateResult.fileServerId;
      const result = await this.processValidationResult(
        fileServerId,
        validationResult,
      );
      if (!result) {
        throw new BadRequestException(
          'Unable to process the validation result.',
        );
      }

      const createdBy = updateResult.createdBy || null;
      const allPaths = [
        ...result.validPaths.map((p) => ({
          ...p,
          isValid: true,
          reachableCount: p.reachableCount,
          createdBy,
        })),
        ...result.invalidPaths.map((p) => ({
          ...p,
          isValid: false,
          reachableCount: 0,
          createdBy,
        })),
      ];

      const existingPaths = await this.volumeRepo.find({
        where: {
          fileServerId,
          volumePath: In(allPaths.map((p) => p.volumePath)),
        },
        select: ['id', 'volumePath', 'isValid', 'reachableCount'],
      });

      const existingPathsMap = new Map(
        existingPaths.map((v) => [`${v.volumePath}-${fileServerId}`, v]),
      );
      const newPaths: VolumeEntity[] = [];

      for (const path of allPaths) {
        const pathKey = `${path.volumePath}-${fileServerId}`;
        const existingPath = existingPathsMap.get(pathKey);
        if (existingPath) {
          // Update existing path
          existingPath.isValid = path.isValid;
          existingPath.reachableCount = path.reachableCount;
          existingPath.createdBy = createdBy;
          await this.volumeRepo.save(existingPath);
        } else {
          // Create new path
          const newVolume = this.volumeRepo.create({
            id: path.id,
            volumePath: path.volumePath,
            fileServerId,
            isValid: path.isValid,
            reachableCount: path.reachableCount,
            createdBy: createdBy,
          });
          newPaths.push(newVolume);
        }
        // update the upload record with validation response
        await this.uploadRepo.update(path.id, {
          validationResponse: JSON.stringify(
            `${path.isValid ? 'SUCCESS: ' : 'ERROR: '} ${path.message}`,
          ),
        });
      }
      if (newPaths.length > 0) await this.volumeRepo.save(newPaths);

      // Inactivate all the job configurations that are using invalid paths as sourcePathId or targetPathId
      const inValidPaths = await this.volumeRepo.find({
        where: [
          { fileServerId, isValid: false },
          { fileServerId, isDisabled: true },
        ],
        select: ['id'],
      });
      if (inValidPaths.length) {
        await this.jobConfigRepo
          .createQueryBuilder('jobConfig')
          .update()
          .set({ status: JobStatus.InActive })
          .where(
            'jobConfig.source_path_id IN (:...invalidVolumePaths) OR jobConfig.target_path_id IN (:...invalidVolumePaths)',
            { invalidVolumePaths: inValidPaths.map((path) => path.id) },
          )
          .andWhere('jobConfig.status = :status', { status: JobStatus.Active })
          .execute();
      }

      return result;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Process Upload Path are failed. ' + error.message,
      );
    }
  }

  async createVolumeForFileServer(
    data: Partial<VolumeEntity>,
  ): Promise<VolumeEntity> {
    const fileServer = await this.fileServerRepo.findOne({
      where: { id: data.fileServerId },
    });
    if (!fileServer) {
      this.logger.error(`File server with ID ${data.fileServerId} not found`);
      throw new Error(`File server with ID ${data.fileServerId} not found`);
    }

    const volumeEntity = this.volumeRepo.create(data);
    return await this.volumeRepo.save(volumeEntity);
  }

  async processValidationResult(
    fileServerId: string,
    validationResult: any[],
  ): Promise<{ validPaths: any[]; invalidPaths: any[] }> {
    try {
      const validPaths = new Map<string, any>();
      const invalidPaths = new Map<string, any>();

      validationResult.reduce((acc, item: any) => {
        item.validationResult.forEach((result) => {
          const path = result.result.path;
          if (!acc[result.result.path]) {
            acc[path] = {
              id: result.result.pathId,
              volumePath: path,
              reachableCount: 0,
              fileServerId,
              message: result.result.message,
            };
          }
          if (result.result.status === 'success') {
            acc[path].reachableCount += 1;
            validPaths.set(path, acc[path]);
          } else {
            // if a path is invalid and already exists in validPaths, remove it from validPaths
            if (validPaths.has(path)) validPaths.delete(path);
            invalidPaths.set(path, acc[path]);
          }
        });
        return acc;
      }, {});

      return {
        validPaths: Array.from(validPaths.values()) as any,
        invalidPaths: Array.from(invalidPaths.values()) as any,
      };
    } catch (error) {
      this.logger.error(
        `Error processing validation result for file server ${fileServerId}`,
        error,
      );
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Error processing validation result: ${error.message}`,
      );
    }
  }

  async isRefreshPossible(fileServerId: string): Promise<boolean> {
    try {
      const fileServer = await this.fileServerRepo.findOne({
        where: { id: fileServerId },
        relations: { volumes: true },
      });
      if (!fileServer) {
        this.logger.error(`File server with ID ${fileServerId} not found`);
        throw new NotFoundException(
          `File server with ID ${fileServerId} not found`,
        );
      }

      const volumeIds = fileServer.volumes.map((volume) => volume.id);
      // fetch all the job configurations that has any of the volumeIds in their sourcePathId or targetPathId and status is ACTIVE
      const blockingJobConfigExists = await this.jobConfigRepo
        .createQueryBuilder('jobConfig')
        .where(
          '(jobConfig.sourcePathId IN (:...volumeIds) OR jobConfig.targetPathId IN (:...volumeIds))',
          { volumeIds },
        )
        .andWhere('jobConfig.status = :status', { status: 'ACTIVE' })
        .andWhere(
          new Brackets((qb) => {
            qb.where('jobConfig.scheduler = :scheduling', {
              scheduling: 'SCHEDULING',
            }).orWhere('jobConfig.futureScheduleAt IS NOT NULL');
          }),
        )
        .getExists();

      if (blockingJobConfigExists) {
        this.logger.warn(
          `Refresh is not possible for file server ${fileServerId} due to active job configs with scheduler=SCHEDULING or futureScheduleAt set.`,
        );
        return false;
      }

      // fetch all the jobs that are in running state for above job configurations
      const runningJobs = await this.jobRunRepo
        .createQueryBuilder('jobRun')
        .innerJoin('jobRun.jobConfig', 'jobConfig')
        .where('jobRun.status = :status', { status: JobRunStatus.Running })
        .andWhere(
          '(jobConfig.sourcePathId IN (:...volumeIds) OR jobConfig.targetPathId IN (:...volumeIds))',
          { volumeIds },
        )
        .andWhere('jobConfig.status = :status', { status: 'ACTIVE' })
        .getCount();

      if (runningJobs > 0) {
        this.logger.warn(
          `Refresh is not possible for file server ${fileServerId} as there are running jobs`,
        );
        return false;
      }

      this.logger.log(`Refresh is possible for file server ${fileServerId}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error checking if refresh is possible for file server ${fileServerId}`,
        error,
      );
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Error checking if refresh is possible: ${error.message}`,
      );
    }
  }

  async createUploadDirectory(): Promise<void> {
    if (!fs.existsSync('/uploads')) {
      fs.mkdirSync('/uploads', { recursive: true });
    }
  }

  async getUploadedPaths(
    fileServerId: string,
  ): Promise<
    { path: string; action: string; message: string; is_valid: boolean }[]
  > {
    try {
      const uploads = await this.uploadRepo
        .createQueryBuilder('pu')
        .leftJoin('volume', 'v', 'v.id = pu.id')
        .select([
          'pu.volume_path AS path',
          'pu.action AS action',
          `CASE WHEN COALESCE(v.is_valid, true) THEN 'Valid' ELSE 'Invalid' END AS is_valid`,
          'pu.validation_response AS message',
        ])
        .where((qb) => {
          const subQuery = qb
            .subQuery()
            .select('sub.upload_id')
            .from('path_uploads', 'sub')
            .where('sub.file_server_id = :fileServerId', { fileServerId })
            .orderBy('sub.created_at', 'DESC')
            .limit(1)
            .getQuery();
          return `pu.upload_id = ${subQuery}`;
        })
        .setParameter('fileServerId', fileServerId)
        .getRawMany();

      if (!uploads || uploads.length === 0) {
        this.logger.warn(
          `No export paths found to download. Please manually upload the export paths for file server ${fileServerId}`,
        );
        throw new NotFoundException(
          `No export paths found to download. Please manually upload the export paths for file server ${fileServerId}`,
        );
      }
      this.logger.log(
        `Found ${uploads.length} uploads for file server ${fileServerId}`,
      );
      return uploads;
    } catch (error) {
      this.logger.error(
        `Error fetching uploaded paths for file server ${fileServerId}`,
        error,
      );
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Error fetching uploaded paths: ${error.message}`,
      );
    }
  }
}
