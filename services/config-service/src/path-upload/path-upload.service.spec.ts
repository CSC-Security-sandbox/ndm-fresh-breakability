import { Test, TestingModule } from '@nestjs/testing';
import { PathUploadService } from './path-upload.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileServerEntity } from '../entities/fileserver.entity';
import { VolumeEntity } from '../entities/volume.entity';
import { PathUploadsEntity } from '../entities/pathupload.entity';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { JobConfigEntity } from 'src/entities/jobconfig.entity';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { WorkflowService } from '../workflow/workflow.service';
import { ImportVolumePathsDto } from './dto/path-upload.dto';
import { ConfigService } from '@nestjs/config/dist/config.service';
import { ExportPathSource, UploadPathAction } from 'src/constants/enums';

const fs = require('fs');
const path = require('path');

const mockQueryBuilder = {
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue({ affected: 1 }),
};

const jobConfigRepoMock = {
  ...mockQueryBuilder,
  createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
};

describe('PathUploadService', () => {
  let service: PathUploadService;
  let fileServerRepo: Repository<FileServerEntity>;
  let volumeRepo: Repository<VolumeEntity>;
  let uploadRepo: Repository<PathUploadsEntity>;
  let workflowService: WorkflowService;
  let jobConfigRepo: Repository<JobConfigEntity>;
  let jobRunRepo: Repository<JobRunEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PathUploadService,
        WorkflowService,
        ConfigService,
        {
          provide: getRepositoryToken(PathUploadsEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(FileServerEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(VolumeEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(JobConfigEntity),
          useValue: jobConfigRepoMock,
        },
        {
          provide: getRepositoryToken(JobRunEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(JobRunEntity),
          useClass: Repository,
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue({
              log: jest.fn(),
              warn: jest.fn(),
              error: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<PathUploadService>(PathUploadService);
    workflowService = module.get<WorkflowService>(WorkflowService);
    fileServerRepo = module.get<Repository<FileServerEntity>>(
      getRepositoryToken(FileServerEntity),
    );
    jobRunRepo = module.get<Repository<JobRunEntity>>(
      getRepositoryToken(JobRunEntity),
    );
    volumeRepo = module.get<Repository<VolumeEntity>>(
      getRepositoryToken(VolumeEntity),
    );
    uploadRepo = module.get<Repository<PathUploadsEntity>>(
      getRepositoryToken(PathUploadsEntity),
    );
    jobConfigRepo = module.get<Repository<JobConfigEntity>>(
      getRepositoryToken(JobConfigEntity),
    );
  });

  describe('processFileUpload', () => {
    it('should throw an error if File server does not exists', async () => {
      const dto: ImportVolumePathsDto = {
        fileName: 'test.txt',
        contents: 'Test content',
        fileSize: 1024,
      };
      jest.spyOn(fileServerRepo, 'findOneBy').mockResolvedValue(null);
      await expect(
        service.processFileUpload(dto, 'non-existing-file-server-id'),
      ).rejects.toThrow(
        'An unexpected error occurred while uploading the file. The specified file server could not be found.',
      );
    });

    it('should throw error if file server is not set for manual upload', async () => {
      const dto: ImportVolumePathsDto = {
        fileName: 'test.txt',
        contents: 'Test content',
        fileSize: 1024,
      };
      const fileServer = new FileServerEntity();
      fileServer.exportPathSource = ExportPathSource.AUTO_DISCOVER;
      jest.spyOn(fileServerRepo, 'findOneBy').mockResolvedValue(fileServer);
      await expect(
        service.processFileUpload(dto, fileServer.id),
      ).rejects.toThrow(
        `An unexpected error occurred while uploading the file. The file server with ID ${fileServer.id} is not set up for manual upload`,
      );
    });

    it('should throw error if 1st line of csv file is not = path', async () => {
      const dto: ImportVolumePathsDto = {
        fileName: 'test.txt',
        contents: 'Notapath\n/path/to/file',
        fileSize: 1024,
      };
      const fileServer = new FileServerEntity();
      fileServer.exportPathSource = ExportPathSource.MANUAL_UPLOAD;
      jest.spyOn(fileServerRepo, 'findOneBy').mockResolvedValue(fileServer);
      await expect(
        service.processFileUpload(dto, fileServer.id),
      ).rejects.toThrow(
        'An unexpected error occurred while uploading the file. The CSV file is either empty or missing a valid header. It should start with \"path\".',
      );
    });

    it('should process file upload successfully', async () => {
      const dto: ImportVolumePathsDto = {
        fileName: 'test.txt',
        contents: 'path\r\n/srv/nfs_share\r\n/srv/nfs_share/data/1',
        fileSize: 1024,
      };
      const fileServer = new FileServerEntity();
      fileServer.exportPathSource = ExportPathSource.MANUAL_UPLOAD;
      jest.spyOn(fileServerRepo, 'findOneBy').mockResolvedValue(fileServer);
      jest.spyOn(uploadRepo, 'save').mockResolvedValue(new PathUploadsEntity());
      jest.spyOn(volumeRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(volumeRepo, 'find').mockResolvedValue([]);
      jest
        .spyOn(service, 'createUpload')
        .mockResolvedValue({ status: 'success' } as any);

      const result = await service.processFileUpload(dto, fileServer.id);
      expect(result).toBeDefined();
      expect(service.createUpload).toHaveBeenCalled();
      expect(result.message).toBe('File upload processed successfully');
      expect(result.newPaths).toBe(2);
      expect(result.alreadyExitingPaths).toBe(0);
      expect(result.noLongerAvailablePaths).toBe(0);
    });

    it('should process file upload successfully when paths already exist', async () => {
      const dto: ImportVolumePathsDto = {
        fileName: 'test.txt',
        contents: 'path\r\n/srv/nfs_share\r\n/srv/nfs_share/data/1',
        fileSize: 1024,
      };
      const mockExistingPath = [
        {
          id: 'path_1',
          volumePath: '/srv/nfs_share',
        },
        {
          id: 'path_2',
          volumePath: '/srv/nfs_share/data/1',
        },
      ];
      const fileServer = new FileServerEntity();
      fileServer.exportPathSource = ExportPathSource.MANUAL_UPLOAD;
      jest.spyOn(fileServerRepo, 'findOneBy').mockResolvedValue(fileServer);
      jest.spyOn(uploadRepo, 'save').mockResolvedValue(new PathUploadsEntity());
      jest
        .spyOn(volumeRepo, 'findOne')
        .mockResolvedValue(mockExistingPath[0] as any);
      jest.spyOn(volumeRepo, 'find').mockResolvedValue(mockExistingPath as any);
      jest
        .spyOn(service, 'createUpload')
        .mockResolvedValue({ status: 'success' } as any);

      const result = await service.processFileUpload(dto, fileServer.id);
      expect(result).toBeDefined();
      expect(result.message).toBe('File upload processed successfully');
      expect(result.newPaths).toBe(0);
      expect(result.alreadyExitingPaths).toBe(2);
      expect(result.noLongerAvailablePaths).toBe(0);
    });

    it('should process file upload successfully when paths no longer available', async () => {
      const dto: ImportVolumePathsDto = {
        fileName: 'test.txt',
        contents: 'path\r\n/srv/nfs_share1\r\n/srv/nfs_share/data/1/2',
        fileSize: 1024,
      };
      const mockExistingPath = [
        {
          id: 'path_1',
          volumePath: '/srv/nfs_share',
        },
        {
          id: 'path_2',
          volumePath: '/srv/nfs_share/data/1',
        },
      ];
      const fileServer = new FileServerEntity();
      fileServer.exportPathSource = ExportPathSource.MANUAL_UPLOAD;
      jest.spyOn(fileServerRepo, 'findOneBy').mockResolvedValue(fileServer);
      jest.spyOn(uploadRepo, 'save').mockResolvedValue(new PathUploadsEntity());
      jest.spyOn(volumeRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(volumeRepo, 'find').mockResolvedValue(mockExistingPath as any);
      jest
        .spyOn(service, 'createUpload')
        .mockResolvedValue({ status: 'success' } as any);

      const result = await service.processFileUpload(dto, fileServer.id);
      expect(result).toBeDefined();
      expect(result.message).toBe('File upload processed successfully');
      expect(result.newPaths).toBe(2);
      expect(result.alreadyExitingPaths).toBe(0);
      expect(result.noLongerAvailablePaths).toBe(2);
    });
  });

  describe('createUpload', () => {
    it('should create a new upload entry', async () => {
      const uploadId = 'upload-id';
      const uploadData: Partial<PathUploadsEntity> = {
        fileName: 'test.txt',
        fileServerId: 'file-server-id',
        uploadId,
        volumePath: '/srv/nfs_share',
        action: UploadPathAction.CREATE,
      };
      jest
        .spyOn(uploadRepo, 'create')
        .mockReturnValue(uploadData as PathUploadsEntity);
      jest
        .spyOn(uploadRepo, 'save')
        .mockResolvedValue({
          ...uploadData,
          id: 'new-upload-id',
        } as PathUploadsEntity);
      const result = await service.createUpload(uploadData);
      expect(result).toBeDefined();
      expect(uploadRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: uploadData.fileName,
          fileServerId: uploadData.fileServerId,
          uploadId: uploadData.uploadId,
          volumePath: uploadData.volumePath,
          action: uploadData.action,
        }),
      );
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('uploadId', uploadId);
      expect(result).toHaveProperty('fileName', uploadData.fileName);
      expect(result).toHaveProperty('volumePath', uploadData.volumePath);
      expect(result).toHaveProperty('action', uploadData.action);
      expect(result).toHaveProperty('fileServerId', uploadData.fileServerId);
    });
  });

  describe('processUploadPathValidation', () => {
    // this method is used to confirm the upload data and initialize the path validation workflow
    it('Should throw an error if uploadId does not exists', async () => {
      const uploadId = 'non-existing-upload-id';
      jest.spyOn(uploadRepo, 'find').mockResolvedValue([]);
      jest.spyOn(fileServerRepo, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest
          .fn()
          .mockRejectedValueOnce(
            new Error(`Upload with ID ${uploadId} not found`),
          ),
      } as any);
      await expect(
        service.processUploadPathValidation(uploadId),
      ).rejects.toThrow(`Upload with ID ${uploadId} not found`);
    });

    it('Should call update method of volume repo with correct parameters', async () => {
      const uploadId = 'existing-upload-id';
      const mockUpload = new PathUploadsEntity();
      mockUpload.uploadId = uploadId;
      mockUpload.fileServerId = 'file-server-id';
      mockUpload.action = UploadPathAction.CREATE;
      jest.spyOn(uploadRepo, 'find').mockResolvedValue([mockUpload]);
      jest.spyOn(fileServerRepo, 'findOne').mockResolvedValue({
        id: mockUpload.fileServerId,
        exportPathSource: ExportPathSource.MANUAL_UPLOAD,
        protocolVersion: 'v3',
        host: 'localhost',
        protocol: 'NFS',
        userName: 'test-user',
        workers: [{ id: 'worker-id', name: 'test-worker' }],
      } as any);

      jest.spyOn(fileServerRepo, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: mockUpload.fileServerId,
          exportPathSource: ExportPathSource.MANUAL_UPLOAD,
          protocolVersion: 'v3',
          host: 'localhost',
          protocol: 'NFS',
          userName: 'test-user',
          workers: [{ id: 'worker-id', name: 'test-worker' }],
          uploads: [mockUpload],
        } as any),
      } as any);

      jest
        .spyOn(volumeRepo, 'update')
        .mockResolvedValue({ affected: 1 } as any);
      jest
        .spyOn(workflowService, 'startWorkflow')
        .mockResolvedValue({
          status: 'success',
          workflowId: 'workflow-id',
        } as any);

      const result = await service.processUploadPathValidation(uploadId);
      expect(result).toBeDefined();
      expect(volumeRepo.update).toHaveBeenCalled();
      expect(result).toHaveProperty(
        'message',
        'Export path upload processed successfully',
      );
      expect(result).toHaveProperty('workflowId', 'workflow-id');
    });
  });

  describe('processUploadUpdate', () => {
    // this method is used to process and update the validation result to db.
    it('Should throw an error if uploadId does not exists', async () => {
      const uploadId = 'non-existing-upload-id';
      jest.spyOn(uploadRepo, 'findOne').mockResolvedValue(null);
      await expect(
        service.processUploadUpdate({} as any, uploadId),
      ).rejects.toThrow(`No upload found with ID non-existing-upload-id.`);
    });

    it('Should throw error if validation result is not provided or is empty or is not an array', async () => {
      const uploadId = 'existing-upload-id';
      const mockUpload = new PathUploadsEntity();
      mockUpload.uploadId = uploadId;
      jest.spyOn(uploadRepo, 'findOne').mockResolvedValue(mockUpload);
      await expect(service.processUploadUpdate(null, uploadId)).rejects.toThrow(
        'The validation result is missing or invalid.',
      );
      await expect(service.processUploadUpdate([], uploadId)).rejects.toThrow(
        'The validation result is missing or invalid.',
      );
      await expect(
        service.processUploadUpdate({} as any, uploadId),
      ).rejects.toThrow('The validation result is missing or invalid.');
    });

    it('Should throw and error if processValidationResult method fails', async () => {
      const uploadId = 'existing-upload-id';
      const mockUpload = new PathUploadsEntity();
      mockUpload.uploadId = uploadId;
      jest.spyOn(uploadRepo, 'findOne').mockResolvedValue(mockUpload);
      jest.spyOn(service, 'processValidationResult').mockImplementation(() => {
        throw new Error('Processing validation result failed');
      });
      await expect(
        service.processUploadUpdate(
          [{ volumePath: '/srv/nfs_share', isValid: true }],
          uploadId,
        ),
      ).rejects.toThrow('Processing validation result failed');
    });

    it('Should throw error if validation result is null or undefined', async () => {
      const uploadId = 'existing-upload-id';
      const mockUpload = new PathUploadsEntity();
      mockUpload.uploadId = uploadId;
      jest.spyOn(uploadRepo, 'findOne').mockResolvedValue(mockUpload);
      jest.spyOn(service, 'processValidationResult').mockResolvedValue(null);
      await expect(
        service.processUploadUpdate(
          [{ volumePath: '/srv/nfs_share', isValid: true }],
          uploadId,
        ),
      ).rejects.toThrow('Unable to process the validation result.');
      await expect(
        service.processUploadUpdate(
          [{ volumePath: '/srv/nfs_share', isValid: true }],
          uploadId,
        ),
      ).rejects.toThrow('Unable to process the validation result.');
    });

    it('Should process the validation result and update the upload entry', async () => {
      const uploadId = 'existing-upload-id';
      const mockUpload = new PathUploadsEntity();
      mockUpload.uploadId = uploadId;

      const mockValidationResult = {
        validPaths: [
          {
            volumePath: '/srv/nfs_share',
            id: 'path_1',
            reachableCount: 1,
          },
          {
            volumePath: '/srv/nfs_share/data/1',
            id: 'path_2',
            reachableCount: 1,
          },
        ],
        invalidPaths: [
          {
            volumePath: '/srv/nfs_share/invalid',
            id: 'path_3',
            reachableCount: 0,
          },
        ],
      };

      jest.spyOn(uploadRepo, 'findOne').mockResolvedValue(mockUpload);
      jest
        .spyOn(service, 'processValidationResult')
        .mockResolvedValue(mockValidationResult as any);
      jest.spyOn(uploadRepo, 'save').mockResolvedValue(mockUpload);
      jest
        .spyOn(volumeRepo, 'create')
        .mockReturnValue(mockValidationResult.validPaths[0] as any);
      jest.spyOn(volumeRepo, 'findOne').mockResolvedValue(null);
      jest
        .spyOn(volumeRepo, 'save')
        .mockResolvedValue(mockValidationResult.validPaths[0] as any);
      jest
        .spyOn(volumeRepo, 'find')
        .mockResolvedValue(mockValidationResult.validPaths as any);
      jest
        .spyOn(uploadRepo, 'update')
        .mockResolvedValue(mockValidationResult.validPaths as any);
      const result = await service.processUploadUpdate(
        mockValidationResult.validPaths,
        uploadId,
      );
      expect(result).toBeDefined();
      expect(result.validPaths.length).toBe(2);
      expect(result.invalidPaths.length).toBe(1);
    });

    it('Should update the upload entry with validation result', async () => {
      const uploadId = 'existing-upload-id';
      const mockUpload = new PathUploadsEntity();
      mockUpload.uploadId = uploadId;
      mockUpload.fileServerId = 'file-server-id';
      mockUpload.action = UploadPathAction.CREATE;

      const mockValidationResult = {
        validPaths: [
          {
            volumePath: '/srv/nfs_share',
            id: 'path_1',
            reachableCount: 1,
          },
        ],
        invalidPaths: [
          {
            volumePath: '/srv/nfs_share/invalid',
            id: 'path_2',
            reachableCount: 0,
          },
        ],
      };

      jest.spyOn(uploadRepo, 'findOne').mockResolvedValue(mockUpload);
      jest
        .spyOn(service, 'processValidationResult')
        .mockResolvedValue(mockValidationResult as any);
      jest.spyOn(uploadRepo, 'save').mockResolvedValue(mockUpload);
      jest
        .spyOn(volumeRepo, 'create')
        .mockReturnValue(mockValidationResult.validPaths[0] as any);
      jest
        .spyOn(volumeRepo, 'findOne')
        .mockResolvedValue({ id: 'path_1' } as any);
      jest
        .spyOn(volumeRepo, 'save')
        .mockResolvedValue(mockValidationResult.validPaths[0] as any);
      jest
        .spyOn(volumeRepo, 'find')
        .mockResolvedValue(mockValidationResult.validPaths as any);
      jest
        .spyOn(uploadRepo, 'update')
        .mockResolvedValue(mockValidationResult.validPaths as any);
      const result = await service.processUploadUpdate(
        mockValidationResult.validPaths,
        uploadId,
      );
      expect(result).toBeDefined();
      expect(result.validPaths.length).toBe(1);
      expect(result.invalidPaths.length).toBe(1);
    });
  });

  describe('createVolumeForFileServer', () => {
    it('Should throw an error if file server does not exist', async () => {
      const fileServerId = 'non-existing-file-server-id';
      jest.spyOn(fileServerRepo, 'findOne').mockResolvedValue(null);
      await expect(
        service.createVolumeForFileServer({ fileServerId }),
      ).rejects.toThrow(`File server with ID ${fileServerId} not found`);
    });

    it('Should create a new volume for the file server', async () => {
      const mockFileServer = new FileServerEntity();
      const mockVolume = new VolumeEntity();
      mockFileServer.exportPathSource = ExportPathSource.MANUAL_UPLOAD;
      jest.spyOn(fileServerRepo, 'findOne').mockResolvedValue(mockFileServer);
      jest.spyOn(volumeRepo, 'save').mockResolvedValue(mockVolume);
      jest.spyOn(volumeRepo, 'create').mockReturnValue(mockVolume as any);

      const result = await service.createVolumeForFileServer(mockFileServer);
      expect(result).toBeDefined();
      expect(result).toBe(mockVolume);
    });
  });

  describe('processValidationResult', () => {
    const mockFileServer = new FileServerEntity();
    it('Should return empty arrays if validation result is empty', async () => {
      const result = await service.processValidationResult(
        mockFileServer.id,
        [],
      );
      expect(result).toEqual({ validPaths: [], invalidPaths: [] });
    });

    it('Should process valid paths correctly', async () => {
      const mockValidPath = [
        {
          validationResult: [
            {
              result: {
                traceId: '7a561ec7-7dd3-47b3-9050-f9ce77c7ecea',
                status: 'success',
                workerId: '219fddb6-5e9b-4fb0-8046-bb644deed70f',
                path: '/srv/nfs_share',
                pathId: '72501a02-071e-4d01-a51a-5cd603b6ecd9',
                message: 'Paths validated',
              },
            },
            {
              result: {
                traceId: '7a561ec7-7dd3-47b3-9050-f9ce77c7ecea',
                status: 'error',
                workerId: '219fddb6-5e9b-4fb0-8046-bb644deed70f',
                path: '/srv/nfs_share/data/1',
                pathId: '20ef1307-adbd-45cf-865d-32e712a70731',
                message: 'Failed to validate',
              },
            },
          ],
        },
      ];
      const result = await service.processValidationResult(
        mockFileServer.id,
        mockValidPath,
      );
      expect(result.validPaths.length).toBe(1);
      expect(result.invalidPaths.length).toBe(1);
      expect(result.validPaths[0]).toEqual(
        expect.objectContaining({
          volumePath: '/srv/nfs_share',
          id: '72501a02-071e-4d01-a51a-5cd603b6ecd9',
          reachableCount: 1,
        }),
      );
      expect(result.invalidPaths[0]).toEqual(
        expect.objectContaining({
          volumePath: '/srv/nfs_share/data/1',
          id: '20ef1307-adbd-45cf-865d-32e712a70731',
          reachableCount: 0,
        }),
      );
    });
  });

  describe('isRefreshPossible', () => {
    it('should throw and error if file server does not exist', async () => {
      const fileServerId = 'non-existing-file-server-id';
      jest.spyOn(fileServerRepo, 'findOne').mockResolvedValue(null);
      await expect(service.isRefreshPossible(fileServerId)).rejects.toThrow(
        `File server with ID ${fileServerId} not found`,
      );
    });

    it('should return false if any job config has scheduler as SCHEDULING', async () => {
      const fileServerId = 'file-server-id';
      const mockFileServer = {
        id: fileServerId,
        exportPathSource: ExportPathSource.MANUAL_UPLOAD,
        protocolVersion: 'v3',
        host: 'localhost',
        protocol: 'NFS',
        userName: 'test-user',
        workers: [{ id: 'worker-id', name: 'test-worker' }],
        volumes: [],
      };
      mockFileServer.id = fileServerId;
      mockFileServer.exportPathSource = ExportPathSource.MANUAL_UPLOAD;
      jest
        .spyOn(fileServerRepo, 'findOne')
        .mockResolvedValue(mockFileServer as any);
      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getExists: jest
          .fn()
          .mockResolvedValue([
            { scheduler: 'SCHEDULING', fileServerId: fileServerId } as any,
          ]),
      } as any);
      const result = await service.isRefreshPossible(fileServerId);
      expect(result).toBe(false);
    });

    it('SHould return false if any job config has job scheduled for future', async () => {
      const fileServerId = 'file-server-id';
      const mockFileServer = {
        id: fileServerId,
        exportPathSource: ExportPathSource.MANUAL_UPLOAD,
        protocolVersion: 'v3',
        host: 'localhost',
        protocol: 'NFS',
        userName: 'test-user',
        workers: [{ id: 'worker-id', name: 'test-worker' }],
        volumes: [],
      };
      mockFileServer.id = fileServerId;
      mockFileServer.exportPathSource = ExportPathSource.MANUAL_UPLOAD;
      jest
        .spyOn(fileServerRepo, 'findOne')
        .mockResolvedValue(mockFileServer as any);
      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getExists: jest
          .fn()
          .mockResolvedValue([
            {
              fileServerId: fileServerId,
              futureScheduleAt: '*/5 * * * *',
            } as any,
          ]),
      } as any);
      const result = await service.isRefreshPossible(fileServerId);
      expect(result).toBe(false);
    });

    it('Should return false if any job is running for the file server', async () => {
      const fileServerId = 'file-server-id';
      const mockFileServer = {
        id: fileServerId,
        exportPathSource: ExportPathSource.MANUAL_UPLOAD,
        protocolVersion: 'v3',
        host: 'localhost',
        protocol: 'NFS',
        userName: 'test-user',
        workers: [{ id: 'worker-id', name: 'test-worker' }],
        volumes: [],
      };
      mockFileServer.id = fileServerId;
      mockFileServer.exportPathSource = ExportPathSource.MANUAL_UPLOAD;
      jest
        .spyOn(fileServerRepo, 'findOne')
        .mockResolvedValue(mockFileServer as any);
      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getExists: jest
          .fn()
          .mockResolvedValue([
            { fileServerId: fileServerId, futureScheduleAt: null } as any,
          ]),
      } as any);
      jest.spyOn(jobRunRepo, 'count').mockResolvedValue(1); // Simulating that a job is running
      const result = await service.isRefreshPossible(fileServerId);
      expect(result).toBe(false);
    });

    it('Should return true if file server is valid for refresh', async () => {
      const fileServerId = 'file-server-id';
      const mockFileServer = {
        id: fileServerId,
        exportPathSource: ExportPathSource.MANUAL_UPLOAD,
        protocolVersion: 'v3',
        host: 'localhost',
        protocol: 'NFS',
        userName: 'test-user',
        workers: [{ id: 'worker-id', name: 'test-worker' }],
        volumes: [],
      };
      mockFileServer.id = fileServerId;
      mockFileServer.exportPathSource = ExportPathSource.MANUAL_UPLOAD;
      jest
        .spyOn(fileServerRepo, 'findOne')
        .mockResolvedValue(mockFileServer as any);

      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getExists: jest.fn().mockResolvedValue(null),
      } as any);

      jest.spyOn(jobRunRepo, 'createQueryBuilder').mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      } as any);

      const result = await service.isRefreshPossible(fileServerId);
      expect(result).toBe(true);
    });
  });

  describe('createUploadDirectory', () => {
    afterEach(() => {
      jest.resetAllMocks();
    });

    it('should create the uploads directory', async () => {
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      await service.createUploadDirectory();
      expect(fs.promises.mkdir).toHaveBeenCalledWith('/uploads', { recursive: true });
    });

    it('should not throw if the uploads directory already exists', async () => {
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      await expect(service.createUploadDirectory()).resolves.not.toThrow();
    });
  });

  describe('getUploadedPaths', () => {
    it('should return uploaded paths with correct fields', async () => {
      const mockUploadData = [
        {
          path: '/mnt/path1',
          action: 'ADD',
          is_valid: 'Valid',
          message: 'Success',
        },
        {
          path: '/mnt/path2',
          action: 'REMOVE',
          is_valid: 'Invalid',
          message: 'Volume not found',
        },
      ];

      const mockQueryBuilder: any = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockImplementation((fn) => {
          // simulate qb.subQuery().select... behavior
          const qb = {
            subQuery: () => ({
              select: () => ({
                from: () => ({
                  where: () => ({
                    orderBy: () => ({
                      limit: () => ({
                        getQuery: () => "'subquery'",
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
          fn(qb); // simulate the subQuery
          return mockQueryBuilder;
        }),
        setParameter: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockUploadData),
      };

      jest
        .spyOn(uploadRepo, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder);

      const result = await service.getUploadedPaths('file-server-id-123');

      expect(result).toEqual(mockUploadData);
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalled();
    });

    it('should throw NotFoundException if no uploads are found', async () => {
      const mockQueryBuilder: any = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockImplementation((fn) => {
          const qb = {
            subQuery: () => ({
              select: () => ({
                from: () => ({
                  where: () => ({
                    orderBy: () => ({
                      limit: () => ({
                        getQuery: () => "'subquery'",
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
          fn(qb);
          return mockQueryBuilder;
        }),
        setParameter: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };

      jest
        .spyOn(uploadRepo, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder);

      await expect(
        service.getUploadedPaths('file-server-id-123'),
      ).rejects.toThrow(
        'No export paths found to download. Please manually upload the export paths for file server file-server-id-123',
      );
    });
  });
});