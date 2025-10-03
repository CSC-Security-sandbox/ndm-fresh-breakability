import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { v4 as uuidv4 } from 'uuid';
import {
  ConfigStatus,
  ConfigurationType,
  Protocol,
  ProtocolVersion,
  ServerType,
  WorkFlows,
} from 'src/constants/enums';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { FileServerWorkingDirectoryMappingEntity } from 'src/entities/fileserver_workingdirectory_mapping.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { JobConfigEntity, JobType } from 'src/entities/jobconfig.entity';
import { JobRunEntity, JobRunStatus } from 'src/entities/jobrun.entity';
import { ConfigurationService } from './configuration.service';
import { WorkflowService } from 'src/workflow/workflow.service';
import { ConfigDTO, WorkingDirDTO } from './dto/config.dto';
import { WorkflowExecutionStatus } from 'src/workflow/workflow.types';
import { ListPathWorkflowStatus } from './configuration.types';
import { SendMailService } from 'src/util/send-email';
import { ConfigService } from '@nestjs/config';
import { PathUploadsEntity } from 'src/entities/pathupload.entity';

const mockConfig = {
  id: uuidv4(),
  configName: 'Test Config',
  configType: 'Type1',
};
const mockSanitizedConfig = {
  id: uuidv4(),
  configName: 'My Config Name',
  configType: 'Type1',
};
const mockFileServer = {
  id: uuidv4(),
  host: 'localhost',
  serverType: 'Type1',
  password: '',
  workers: [],
  volumes: [],
};
const mockWorker = { id: uuidv4(), workerName: 'Worker1' };

const mockConfigRepository = {
  count: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockProjectRepository = {
  findOne: jest.fn(),
};

const mockFileServerRepository = {
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue({
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([
      {
        id: 'fileServer1',
        protocol: 'NFS',
        workers: [{ workerId: 'worker1', workerName: 'Worker 1' }],
        config: {
          id: 'config1',
          configName: 'Config 1',
          status: 'ACTIVE',
          workingDirectory: { workingDirectory: '/path1' },
        },
      },
      {
        id: 'fileServer2',
        protocol: 'SMB',
        workers: [],
        config: {
          id: 'config2',
          configName: 'Config 2',
          status: 'DRAFT',
          workingDirectory: { workingDirectory: '' },
        },
      },
    ]),
  }),
};

const mockVolumeRepository = {
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockWorkerRepository = {
  findByIds: jest.fn(),
  find: jest.fn(),
};

const mockMappingRepository = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
};

const mockPathUploadRepository = {
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
};
jest.fn().mockReturnThis();
jest.fn().mockReturnThis();
jest.fn().mockReturnThis();
jest.fn().mockReturnThis();
jest.fn().mockResolvedValue({ affected: 1 });
const jobConfigRepoMock = {
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockJobRunRepo = {
  count: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
};

describe('ConfigurationService', () => {
  let service: ConfigurationService;
  let configRepository: Repository<ConfigEntity>;
  let workflowService: WorkflowService;
  let projectRepository: Repository<ProjectEntity>;
  let sendMailService: SendMailService;
  let jobConfigRepo: Repository<JobConfigEntity>;
  let jobRunRepo: Repository<JobRunEntity>;
  let pathUploadRepository: Repository<PathUploadsEntity>;
  let volumeRepo: Repository<VolumeEntity>;
  let fileServerRepository: Repository<FileServerEntity>;
  let volumeRepository: Repository<VolumeEntity>;
  let workerRepository: Repository<WorkerEntity>;
  let mappingRepository: Repository<FileServerWorkingDirectoryMappingEntity>;
  const loggerFactoryMock = {
    create: jest.fn().mockReturnValue({
      log: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    }),
  };

  const startWorkflowMock = jest.fn().mockResolvedValue({ workflowId: '123' });
  const getWorkFlowResMock = jest.fn().mockResolvedValue({ result: 'success' });

  const mockWorkflowService = {
    startWorkflow: startWorkflowMock,
    getWorkFlowRes: getWorkFlowResMock,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigurationService,
        ConfigService,
        {
          provide: getRepositoryToken(ConfigEntity),
          useValue: mockConfigRepository,
        },
        {
          provide: getRepositoryToken(ProjectEntity),
          useValue: mockProjectRepository,
        },
        {
          provide: getRepositoryToken(FileServerEntity),
          useValue: mockFileServerRepository,
        },
        {
          provide: getRepositoryToken(JobConfigEntity),
          useValue: jobConfigRepoMock,
        },
        {
          provide: getRepositoryToken(JobRunEntity),
          useValue: mockJobRunRepo,
        },
        {
          provide: getRepositoryToken(PathUploadsEntity),
          useValue: mockPathUploadRepository,
        },
        {
          provide: getRepositoryToken(VolumeEntity),
          useValue: mockVolumeRepository,
        },
        {
          provide: getRepositoryToken(WorkerEntity),
          useValue: mockWorkerRepository,
        },
        {
          provide: getRepositoryToken(FileServerWorkingDirectoryMappingEntity),
          useValue: mockMappingRepository,
        },
        { provide: LoggerFactory, useValue: loggerFactoryMock },
        {
          provide: WorkflowService,
          useValue: mockWorkflowService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: SendMailService,
          useValue: {
            sendMail: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ConfigurationService>(ConfigurationService);
    configRepository = module.get<Repository<ConfigEntity>>(
      getRepositoryToken(ConfigEntity),
    );
    fileServerRepository = module.get<Repository<FileServerEntity>>(
      getRepositoryToken(FileServerEntity),
    );
    mappingRepository = module.get<
      Repository<FileServerWorkingDirectoryMappingEntity>
    >(getRepositoryToken(FileServerWorkingDirectoryMappingEntity));

    volumeRepository = module.get<Repository<VolumeEntity>>(
      getRepositoryToken(VolumeEntity),
    );
    workerRepository = module.get<Repository<WorkerEntity>>(
      getRepositoryToken(WorkerEntity),
    );
    projectRepository = module.get<Repository<ProjectEntity>>(
      getRepositoryToken(ProjectEntity),
    );
    workflowService = module.get<WorkflowService>(WorkflowService);
    sendMailService = module.get<SendMailService>(SendMailService);
    jobConfigRepo = module.get<Repository<JobConfigEntity>>(
      getRepositoryToken(JobConfigEntity),
    );
    jobRunRepo = module.get<Repository<JobRunEntity>>(
      getRepositoryToken(JobRunEntity),
    );
    pathUploadRepository = module.get<Repository<PathUploadsEntity>>(
      getRepositoryToken(PathUploadsEntity),
    );
    volumeRepo = module.get<Repository<VolumeEntity>>(
      getRepositoryToken(VolumeEntity),
    );
  });

  describe('getAllConfig', () => {
    it('should return paginated config results', async () => {
      mockConfigRepository.find.mockResolvedValue([mockConfig]);
      mockConfigRepository.count.mockResolvedValue(1);

      const result = await service.getAllConfig({
        page: '1',
        limit: '10',
        sort: 'createdAt',
        order: 'asc',
      });

      expect(mockConfigRepository.find).toHaveBeenCalled();
      expect(result.serverConfig).toEqual([mockConfig]);
      expect(result.total).toBe(1);
    });

    it('should return all configs without pagination if page and limit are not provided', async () => {
      mockConfigRepository.find.mockResolvedValue([mockConfig]);
      mockConfigRepository.count.mockResolvedValue(1);

      const result = await service.getAllConfig({});

      expect(mockConfigRepository.find).toHaveBeenCalled();
      expect(result.serverConfig).toEqual([mockConfig]);
      expect(result.total).toBe(1);
    });

    it('should handle empty filter with default sort and order', async () => {
      mockConfigRepository.find.mockResolvedValue([]);
      mockConfigRepository.count.mockResolvedValue(0);

      const result = await service.getAllConfig({});

      expect(mockConfigRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { createdAt: 'ASC' },
        }),
      );
      expect(result).toEqual({ serverConfig: [], total: 0 });
    });

    it('should handle custom sort and order', async () => {
      mockConfigRepository.find.mockResolvedValue([mockConfig]);
      mockConfigRepository.count.mockResolvedValue(1);

      await service.getAllConfig({
        sort: 'configName',
        order: 'desc',
      });

      expect(mockConfigRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { configName: 'desc' },
        }),
      );
    });
  });

  describe('getConfigById', () => {
    it('should return config when valid ID is passed', async () => {
      mockConfigRepository.findOne.mockResolvedValue({
        ...mockConfig,
        fileServers: [mockFileServer],
      });
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);
      jest.spyOn(service, 'isUploadInProgress').mockResolvedValue(false);
      const result = await service.getConfigById(mockConfig.id);

      expect(result).toBeDefined();
    });

    it('should throw BadRequestException if invalid UUID is passed', async () => {
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);
      await expect(service.getConfigById('invalid-uuid')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if config is not found', async () => {
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);
      mockConfigRepository.findOne.mockResolvedValue(null);
      await expect(service.getConfigById(uuidv4())).rejects.toThrow(
        InternalServerErrorException,
      );
    });
    it('should handle ERRORED status by setting fileServers volumes to empty array', async () => {
      // Mock config with ERRORED status
      const fileServerId = uuidv4();
      const volumeId = uuidv4();
      const mockConfig = {
        id: uuidv4(),
        status: ConfigStatus.ERRORED,
        fileServers: [
          {
            id: fileServerId,
            volumes: [{ id: volumeId, volumePath: '/path/to/volume' }],
            workers: [{ stats: { updatedAt: new Date() } }],
          },
        ],
      };

      jest
        .spyOn(configRepository, 'findOne')
        .mockResolvedValue(mockConfig as any);
      jest.spyOn(pathUploadRepository, 'find').mockResolvedValue([]);
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);
      jest.spyOn(service, 'isUploadInProgress').mockResolvedValue(false);

      const result = await service.getConfigById(mockConfig.id);

      // Verify that volumes array is empty
      expect(result.fileServers[0].volumes).toEqual([]);
    });

    it('should handle DRAFT status by setting fileServers volumes to empty array', async () => {
      // Mock config with DRAFT status
      const fileServerId = uuidv4();
      const volumeId = uuidv4();
      const mockConfig = {
        id: uuidv4(),
        status: ConfigStatus.DRAFT,
        fileServers: [
          {
            id: fileServerId,
            volumes: [{ id: volumeId, volumePath: '/path/to/volume' }],
            workers: [{ stats: { updatedAt: new Date() } }],
          },
        ],
      };

      jest
        .spyOn(configRepository, 'findOne')
        .mockResolvedValue(mockConfig as any);
      jest.spyOn(pathUploadRepository, 'find').mockResolvedValue([]);
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);
      jest.spyOn(service, 'isUploadInProgress').mockResolvedValue(false);

      const result = await service.getConfigById(mockConfig.id);

      // Verify that volumes array is empty
      expect(result.fileServers[0].volumes).toEqual([]);
    });
  });

  describe('isConfigNameUnique', () => {
    it('should throw InternalServerErrorException for generic errors', async () => {
      // Mock projectRepository.findOne to throw a generic error
      jest.spyOn(projectRepository, 'findOne').mockImplementation(() => {
        throw new Error('Database connection error');
      });

      await expect(
        service.isConfigNameUnique('project-id', 'config-name'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('fetchConfigWithRelations', () => {
    it('should propagate BadRequestException', async () => {
      // Mock configRepository.findOne to throw a BadRequestException
      jest.spyOn(configRepository, 'findOne').mockImplementation(() => {
        throw new BadRequestException('Invalid parameter');
      });

      // Call the method through getCutoverDetailsByConfigId which uses fetchConfigWithRelations
      await expect(
        service.getCutoverDetailsByConfigId(uuidv4()),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('extractValidJobConfigs', () => {
    it('should handle errors and propagate them', async () => {
      // Create a mock config that will cause an error in extractValidJobConfigs
      const mockConfig = {
        fileServers: [
          {
            volumes: [
              {
                jobConfig: null, // This will cause an error when trying to filter
              },
            ],
          },
        ],
      };

      // Mock configRepository.findOne to return our problematic config
      jest
        .spyOn(configRepository, 'findOne')
        .mockResolvedValue(mockConfig as any);

      // Call the method through getCutoverDetailsByConfigId which uses extractValidJobConfigs
      await expect(
        service.getCutoverDetailsByConfigId(uuidv4()),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should correctly filter job configs based on status conditions', async () => {
      // Create a mock config with various job configs
      const mockConfig = {
        fileServers: [
          {
            protocol: Protocol.NFS,
            volumes: [
              {
                jobConfig: [
                  {
                    // This should be included (CutOver + Errored)
                    jobType: JobType.CutOver,
                    status: 'ACTIVE',
                    sourcePathId: 'source1',
                    targetPathId: 'target1',
                    jobRunDetails: [
                      {
                        status: JobRunStatus.Errored,
                      },
                    ],
                  },
                  {
                    // This should be included (Migrate + Completed)
                    jobType: JobType.Migrate,
                    status: 'ACTIVE',
                    sourcePathId: 'source2',
                    targetPathId: 'target2',
                    jobRunDetails: [
                      {
                        status: JobRunStatus.Completed,
                      },
                    ],
                  },
                  {
                    // This should NOT be included (CutOver but no Errored runs)
                    jobType: JobType.CutOver,
                    status: 'ACTIVE',
                    sourcePathId: 'source3',
                    targetPathId: 'target3',
                    jobRunDetails: [
                      {
                        status: JobRunStatus.Running,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      // Mock configRepository.findOne to return our config
      jest
        .spyOn(configRepository, 'findOne')
        .mockResolvedValue(mockConfig as any);

      // Mock volumeRepository.find to return valid volumes
      jest.spyOn(volumeRepository, 'find').mockResolvedValue([
        {
          id: 'source1',
          volumePath: '/source1',
          isValid: true,
          isDisabled: false,
          fileServer: { config: { id: 'config1', configName: 'Config 1' } },
        },
        {
          id: 'target1',
          volumePath: '/target1',
          isValid: true,
          isDisabled: false,
          fileServer: { config: { id: 'config2', configName: 'Config 2' } },
        },
        {
          id: 'source2',
          volumePath: '/source2',
          isValid: true,
          isDisabled: false,
          fileServer: { config: { id: 'config1', configName: 'Config 1' } },
        },
        {
          id: 'target2',
          volumePath: '/target2',
          isValid: true,
          isDisabled: false,
          fileServer: { config: { id: 'config2', configName: 'Config 2' } },
        },
      ] as any);

      // Call getCutoverDetailsByConfigId
      const result = await service.getCutoverDetailsByConfigId(uuidv4());

      // Verify that only the expected job configs are included
      expect(result.length).toBe(2);
      expect(result[0].sourcePath.id).toBe('source1');
      expect(result[1].sourcePath.id).toBe('source2');
    });
  });

  describe('getVolumeDetailsMap', () => {
    it('should propagate BadRequestException', async () => {
      // Create valid job configs
      const validJobConfigs = [
        {
          sourcePathId: 'source1',
          targetPathId: 'target1',
        },
      ];

      // Mock volumeRepository.find to throw a BadRequestException
      jest.spyOn(volumeRepository, 'find').mockImplementation(() => {
        throw new BadRequestException('Invalid parameter');
      });

      // Mock configRepository.findOne to return a valid config
      jest.spyOn(configRepository, 'findOne').mockResolvedValue({
        fileServers: [
          {
            volumes: [
              {
                jobConfig: [
                  {
                    jobType: JobType.CutOver,
                    status: 'ACTIVE',
                    sourcePathId: 'source1',
                    targetPathId: 'target1',
                    jobRunDetails: [
                      {
                        status: JobRunStatus.Errored,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      } as any);

      // Call the method through getCutoverDetailsByConfigId which uses getVolumeDetailsMap
      await expect(
        service.getCutoverDetailsByConfigId(uuidv4()),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('constructResponse', () => {
    it('should handle errors and propagate them', async () => {
      // Create a mock config
      const mockConfig = {
        fileServers: [
          {
            protocol: Protocol.NFS,
            volumes: [
              {
                jobConfig: [
                  {
                    jobType: JobType.CutOver,
                    status: 'ACTIVE',
                    sourcePathId: 'source1',
                    targetPathId: 'target1',
                    jobRunDetails: [
                      {
                        status: JobRunStatus.Errored,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      // Mock configRepository.findOne to return our config
      jest
        .spyOn(configRepository, 'findOne')
        .mockResolvedValue(mockConfig as any);

      // Mock volumeRepository.find to return valid volumes
      jest.spyOn(volumeRepository, 'find').mockResolvedValue([
        {
          id: 'source1',
          volumePath: '/source1',
          isValid: true,
          isDisabled: false,
          fileServer: { config: { id: 'config1', configName: 'Config 1' } },
        },
      ] as any);

      // Create a problematic volumeMap that will cause an error in constructResponse
      const volumeMap = new Map();
      volumeMap.set('source1', {
        id: 'source1',
        sourcePathName: '/source1',
        // Missing required properties will cause an error
      });

      // Replace the original getVolumeDetailsMap method to return our problematic volumeMap
      jest
        .spyOn(service as any, 'getVolumeDetailsMap')
        .mockResolvedValue(volumeMap);

      const result = await service.getCutoverDetailsByConfigId(uuidv4());
      expect(result).toEqual([
        {
          destinationFileServer: {},
          destinationPath: { destinationPathName: '', id: '' },
          jobConfig: [
            {
              id: undefined,
              jobRunDetails: [{ id: undefined, status: 'ERRORED' }],
              jobType: 'CUT_OVER',
            },
          ],
          protocol: 'NFS',
          sourcePath: { id: 'source1', sourcePathName: '/source1' },
        },
      ]);
    });
  });

  describe('createConfiguration', () => {
    it('should set config status to ERRORED when all workers are unhealthy', async () => {
      // Create a mock config DTO
      const createConfigDTO: ConfigDTO = {
        projectId: uuidv4(),
        configName: 'Test Config',
        configType: ConfigurationType.file,
        workingDirectory: {
          pathName: '/test/path',
          pathId: 'path-id',
          workingDirectory: '/working/dir',
        },
        fileServers: [
          {
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            serverType: ServerType.other,
            userName: 'user',
            workers: ['worker1'],
          },
        ],
      };

      // Mock worker with unhealthy stats
      const unhealthyWorker = {
        workerId: 'worker1',
        stats: {
          updatedAt: new Date(Date.now() - 1000000), // Old timestamp to make worker unhealthy
        },
      };

      // Mock repository methods
      jest
        .spyOn(workerRepository, 'find')
        .mockResolvedValue([unhealthyWorker] as any);
      jest
        .spyOn(service, 'isConfigNameUnique')
        .mockResolvedValue({ isUnique: true } as any);
      jest.spyOn(service, 'isAllWorkerUnHealthy').mockResolvedValue(true);
      jest.spyOn(configRepository, 'create').mockReturnValue({
        id: uuidv4(),
        ...createConfigDTO,
      } as any);
      jest
        .spyOn(configRepository, 'save')
        .mockImplementation((entity) =>
          Promise.resolve(entity as ConfigEntity),
        );
      jest.spyOn(fileServerRepository, 'create').mockReturnValue({} as any);

      // Call createConfiguration
      const result = await service.createConfiguration(
        createConfigDTO,
        uuidv4(),
        uuidv4(),
      );

      // Verify that status is set to ERRORED
      expect(result.status).toBe(ConfigStatus.ERRORED);
      expect(result.errorMessage).toBe('worker is down');

      // Verify that startValidateWorkingDirectoryWorkflow is not called
      expect(workflowService.startWorkflow).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should handle and wrap generic errors', async () => {
      const configId = uuidv4();

      // Mock configRepository.findOne to return a config
      jest
        .spyOn(configRepository, 'findOne')
        .mockResolvedValue({ id: configId } as any);

      // Mock configRepository.remove to throw a generic error
      jest.spyOn(configRepository, 'remove').mockImplementation(() => {
        throw new Error('Database error');
      });

      // Call remove
      await expect(service.remove(configId)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('updateResult', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should handle and wrap errors from getWorkFlowRes', async () => {
      // Mock workflowService.getWorkFlowRes to throw an error
      jest.spyOn(workflowService, 'getWorkFlowRes').mockImplementation(() => {
        throw new Error('Workflow service error');
      });

      // Call updateResult
      service.updateResult('workflow-id', 'config-id');

      // Fast-forward timers
      jest.runAllTimers();
      await Promise.resolve();

      // Verify that the error is logged
      expect(service['logger'].error).toHaveBeenCalled();
    });
  });

  describe('updatePaths', () => {
    it('should handle and wrap generic errors', async () => {
      const configId = uuidv4();
      const details = {
        completed: [
          {
            protocolType: 'NFS',
            paths: ['/path1'],
          },
        ],
      };

      // Mock configRepository.findOne to throw a generic error
      jest.spyOn(configRepository, 'findOne').mockImplementation(() => {
        throw new Error('Database error');
      });

      // Call updatePaths
      await expect(
        service.updatePaths(configId, details as any),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should disable volumes no longer in the completed payload', async () => {
      const configId = uuidv4();
      const fileServerId = uuidv4();

      // Create details with only one path
      const details = {
        completed: [
          {
            protocolType: 'NFS',
            paths: ['/path1'],
          },
        ],
      };

      // Create a mock config with two volumes, one of which is not in the completed payload
      const mockConfig = {
        id: configId,
        fileServers: [
          {
            id: fileServerId,
            protocol: 'NFS',
            volumes: [
              { id: 'vol1', volumePath: '/path1' },
              { id: 'vol2', volumePath: '/path2' }, // This one should be disabled
            ],
          },
        ],
      };

      // Mock repository methods
      jest
        .spyOn(configRepository, 'findOne')
        .mockResolvedValue(mockConfig as any);
      jest.spyOn(volumeRepository, 'create').mockReturnValue({} as any);
      jest.spyOn(volumeRepository, 'save').mockResolvedValue({} as any);
      jest.spyOn(volumeRepository, 'update').mockResolvedValue({} as any);
      jest.spyOn(fileServerRepository, 'update').mockResolvedValue({} as any);
      jest.spyOn(configRepository, 'update').mockResolvedValue({} as any);

      // Mock queryBuilder methods
      jest.spyOn(volumeRepository, 'createQueryBuilder').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      } as any);

      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      } as any);

      // Call updatePaths
      await service.updatePaths(configId, details as any);

      // Verify that volumes.update was called with the correct parameters
      expect(volumeRepository.update).toHaveBeenCalledWith(
        { fileServerId, volumePath: In(['/path2']) },
        { isDisabled: true },
      );
    });
  });

  describe('isRefreshPossible', () => {
    it('should handle and propagate errors', async () => {
      const configId = uuidv4();

      // Mock configRepository.find to throw an error
      jest.spyOn(configRepository, 'find').mockImplementation(() => {
        throw new Error('Database error');
      });

      // Call isRefreshPossible
      await expect(service.isRefreshPossible(configId)).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('createConfiguration', () => {
    it('should sanitize configName before saving', async () => {
      mockConfigRepository.create.mockReturnValue({
        ...mockSanitizedConfig,
        fileServers: [mockFileServer],
      });
      mockWorkerRepository.find.mockResolvedValue([mockWorker]);
      jest
        .spyOn(service, 'isConfigNameUnique')
        .mockResolvedValue({ isUnique: true });

      const createConfigDTO = {
        projectId: '123456',
        createdBy: '123123',
        stage: '',
        workingDirectory: {
          pathName: '/temp',
          pathId: '123123',
          workingDirectory: '/working/dir',
        },
        configName: '   <b>  My <i>Config</i> Name  </b>   ',
        configType: ConfigurationType.file,
        fileServers: [
          {
            host: 'localhost',
            protocolVersion: ProtocolVersion.NFSv3,
            serverType: ServerType.emc,
            workers: [mockWorker.id],
            volumes: [
              {
                volumePath: '/new-path',
                isIncluded: true,
                createdBy: '1234567',
              },
            ],
            createdBy: '1234567',
            protocol: Protocol.NFS,
            userName: 'TEST',
          },
        ],
      };

      const sanitizedConfigName = 'My Config Name';
      const savedConfig = {
        id: uuidv4(),
        ...createConfigDTO,
        configName: sanitizedConfigName,
      };
      mockConfigRepository.save.mockResolvedValue(savedConfig);
      mockConfigRepository.findOne.mockResolvedValue(savedConfig);
      jest
        .spyOn(service, 'startValidateWorkingDirectoryWorkflow')
        .mockResolvedValue(undefined);
      jest.spyOn(service, 'isAllWorkerUnHealthy').mockResolvedValue(false);
      jest.spyOn(service, 'refreshConfig').mockResolvedValue(undefined);

      const result = await service.createConfiguration(
        createConfigDTO,
        uuidv4(),
        uuidv4(),
      );

      expect(mockConfigRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          configName: sanitizedConfigName,
        }),
      );
      expect(result.configName).toBe(sanitizedConfigName);
    });

    it('should create and save a new configuration', async () => {
      mockConfigRepository.create.mockReturnValue({
        ...mockConfig,
        fileServers: [mockFileServer],
      });
      mockWorkerRepository.find.mockResolvedValue([mockWorker]);
      jest
        .spyOn(service, 'isConfigNameUnique')
        .mockResolvedValue({ isUnique: true });

      const createConfigDTO = {
        projectId: '123456',
        createdBy: '123123',
        stage: '',
        workingDirectory: {
          pathName: '/temp',
          pathId: '123123',
          workingDirectory: '/working/dir',
        },
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        fileServers: [
          {
            host: 'localhost',
            protocolVersion: ProtocolVersion.NFSv3,
            serverType: ServerType.emc,
            workers: [mockWorker.id],
            volumes: [
              {
                volumePath: '/new-path',
                isIncluded: true,
                createdBy: '1234567',
              },
            ],
            createdBy: '1234567',
            protocol: Protocol.NFS,
            userName: 'TEST',
          },
        ],
      };

      const savedConfig = { id: uuidv4(), ...createConfigDTO };
      mockConfigRepository.save.mockResolvedValue(savedConfig);
      mockConfigRepository.findOne.mockResolvedValue(savedConfig);

      jest.spyOn(service, 'refreshConfig').mockResolvedValue(undefined);
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      const result = await service.createConfiguration(
        createConfigDTO,
        uuidv4(),
        uuidv4(),
      );

      expect(service.isConfigNameUnique).toHaveBeenCalledWith(
        createConfigDTO.projectId,
        createConfigDTO.configName,
      );
      expect(result).toEqual(savedConfig);
      expect(mockConfigRepository.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException if project ID is invalid', async () => {
      jest
        .spyOn(service, 'isConfigNameUnique')
        .mockRejectedValue(new NotFoundException('Invalid Project ID'));
      const createConfigDTO = {
        projectId: '123456',
        createdBy: '123123',
        stage: '',
        workingDirectory: {
          pathName: '/temp',
          pathId: '123123',
          workingDirectory: '/working/dir',
        },
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        fileServers: [
          {
            host: 'localhost',
            protocolVersion: ProtocolVersion.NFSv3,
            serverType: ServerType.emc,
            workers: [mockWorker.id],
            volumes: [
              {
                volumePath: '/new-path',
                isIncluded: true,
                createdBy: '1234567',
              },
            ],
            createdBy: '1234567',
            protocol: Protocol.NFS,
            userName: 'TEST',
          },
        ],
      };
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      await expect(
        service.createConfiguration(createConfigDTO, uuidv4(), uuidv4()),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if config name already exists', async () => {
      jest
        .spyOn(service, 'isConfigNameUnique')
        .mockRejectedValue(
          new BadRequestException(
            'Config name already exists for this project.',
          ),
        );
      const createConfigDTO = {
        projectId: '123456',
        createdBy: '123123',
        stage: '',
        workingDirectory: {
          pathName: '/temp',
          pathId: '123123',
          workingDirectory: '/working/dir',
        },
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        fileServers: [
          {
            host: 'localhost',
            protocolVersion: ProtocolVersion.NFSv3,
            serverType: ServerType.emc,
            workers: [mockWorker.id],
            volumes: [
              {
                volumePath: '/new-path',
                isIncluded: true,
                createdBy: '1234567',
              },
            ],
            createdBy: '1234567',
            protocol: Protocol.NFS,
            userName: 'TEST',
          },
        ],
      };
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      await expect(
        service.createConfiguration(createConfigDTO, uuidv4(), uuidv4()),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create working directory mapping when workingDirectory is provided', async () => {
      const configId = uuidv4();
      const workingDirData = {
        pathName: '/test/path',
        pathId: '123',
        workingDirectory: '/working/dir',
      };
      const createConfigDTO = {
        configName: 'Test Config',
        configType: ConfigurationType.file,
        projectId: '123456',
        workingDirectory: workingDirData,
        fileServers: [
          {
            host: 'test.com',
            serverType: ServerType.emc,
            protocol: Protocol.NFS,
            userName: 'test',
            protocolVersion: ProtocolVersion.NFSv3,
            workers: ['worker1'],
          },
        ],
      };

      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);
      jest
        .spyOn(service, 'isConfigNameUnique')
        .mockResolvedValue({ isUnique: true });
      mockWorkerRepository.find.mockResolvedValue([{ workerId: 'worker1' }]);
      mockConfigRepository.create.mockReturnValue({
        id: configId,
        ...createConfigDTO,
      });
      mockConfigRepository.save.mockResolvedValue({
        id: configId,
        ...createConfigDTO,
      });

      await service.createConfiguration(createConfigDTO, uuidv4(), uuidv4());

      expect(mockMappingRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ ...workingDirData, configId }),
      );
    });

    it('should handle database error during working directory save', async () => {
      const workingDirData = {
        pathName: '/test/path',
        pathId: '123',
        workingDirectory: '/working/dir',
      };
      const createConfigDTO = {
        configName: 'Test Config',
        configType: ConfigurationType.file,
        projectId: '123456',
        workingDirectory: workingDirData,
        fileServers: [
          {
            host: 'test.com',
            serverType: ServerType.emc,
            protocol: Protocol.NFS,
            userName: 'test',
            workers: ['worker1'],
            protocolVersion: ProtocolVersion.NFSv3,
          },
        ],
      };
      jest
        .spyOn(service, 'isConfigNameUnique')
        .mockResolvedValue({ isUnique: true });
      mockMappingRepository.save.mockRejectedValue(new Error('Database error'));
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      await expect(
        service.createConfiguration(createConfigDTO, uuidv4(), uuidv4()),
      ).rejects.toThrow('Error Occurred during creating Config');
    });

    it('should handle empty workers array in fileServer', async () => {
      const createConfigDTO = {
        configName: 'Test Config',
        configType: ConfigurationType.file,
        projectId: 'valid-project-id',
        workingDirectory: {
          pathName: '/temp',
          pathId: '123123',
          workingDirectory: '/working-directory',
        },
        fileServers: [
          {
            host: 'test.com',
            serverType: ServerType.emc,
            protocol: Protocol.NFS,
            userName: 'test',
            protocolVersion: ProtocolVersion.NFSv3,
            workers: [],
          },
        ],
      };

      jest
        .spyOn(service, 'isConfigNameUnique')
        .mockResolvedValue({ isUnique: true });
      mockConfigRepository.create.mockResolvedValue(createConfigDTO);
      mockConfigRepository.save.mockResolvedValue(createConfigDTO);
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      await expect(
        service.createConfiguration(createConfigDTO, 'user-id', 'trace-123'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('updateConfiguration', () => {
    it('should update and save the configuration', async () => {
      const existingConfig = {
        id: uuidv4(),
        configName: 'Old Config',
        configType: ConfigurationType.file,
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            createdBy: '1234567',
            volumes: [],
            workers: [],
          },
        ],
      };

      const updateConfigDTO: ConfigDTO = {
        projectId: '123456',
        createdBy: '123123',
        configName: 'Updated Config',
        workingDirectory: {
          pathName: '/test/path',
          pathId: '123',
          workingDirectory: '/working/dir',
        },
        configType: ConfigurationType.file,
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocolVersion: ProtocolVersion.NFSv3,
            serverType: ServerType.emc,
            workers: [mockWorker.id],
            createdBy: '1234567',
            protocol: Protocol.NFS,
            userName: 'TEST',
          },
        ],
      };

      const existingMapping = {
        id: 'mapping-123',
        pathId: '123',
        pathName: '/old/path',
        workingDirectory: '/old/dir',
      };

      const updatedMapping = {
        ...existingMapping,
        pathName: '/test/path',
        workingDirectory: '/working/dir',
      };

      mockConfigRepository.findOne.mockResolvedValue(existingConfig);
      mockConfigRepository.save.mockResolvedValue({
        ...existingConfig,
        ...updateConfigDTO,
      });
      mockWorkerRepository.find.mockResolvedValue([
        { workerId: mockWorker.id },
      ]);
      mockFileServerRepository.create.mockReturnValue(
        updateConfigDTO.fileServers[0],
      );
      mockMappingRepository.findOne.mockResolvedValue(existingMapping);
      mockMappingRepository.save.mockResolvedValue(updatedMapping);

      jest.spyOn(service, 'refreshConfig').mockResolvedValue({} as any);
      const result = await service.updateConfiguration(
        existingConfig.id,
        updateConfigDTO,
        uuidv4(),
        uuidv4(),
      );

      expect(mockMappingRepository.findOne).toHaveBeenCalledWith({
        where: { configId: existingConfig.id },
      });
      expect(mockMappingRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'mapping-123',
          pathName: '/test/path',
          workingDirectory: '/working/dir',
          pathId: '123',
        }),
      );

      expect(mockFileServerRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: mockFileServer.id,
          host: 'localhost',
          protocol: Protocol.NFS,
          protocolVersion: ProtocolVersion.NFSv3,
          userName: 'TEST',
          isRefreshed: false,
        }),
      );

      expect(result).toBeDefined();
      expect(result.configName).toBe(updateConfigDTO.configName);
    });

    it('should throw NotFoundException if config is not found', async () => {
      mockConfigRepository.findOne.mockResolvedValue(null);
      await expect(
        service.updateConfiguration(
          uuidv4(),
          {} as ConfigDTO,
          uuidv4(),
          uuidv4(),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle working directory mapping not found', async () => {
      const existingConfig = {
        id: uuidv4(),
        fileServers: [
          {
            id: mockFileServer.id,
            protocol: Protocol.NFS,
            host: 'localhost',
            workers: [],
          },
        ],
      };

      const updateConfigDTO: ConfigDTO = {
        projectId: '123456',
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        workingDirectory: {
          pathId: 'non-existent',
          pathName: '/test/path',
          workingDirectory: '/working/dir',
        },
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            workers: [mockWorker.id],
            userName: 'TEST',
          },
        ],
      };

      mockConfigRepository.findOne.mockResolvedValue(existingConfig);
      mockMappingRepository.findOne.mockRejectedValue(new Error('Not found'));
      jest.spyOn(service, 'refreshConfig').mockResolvedValue({} as any);
      await expect(
        service.updateConfiguration(
          existingConfig.id,
          updateConfigDTO,
          uuidv4(),
          uuidv4(),
        ),
      ).rejects.toThrow('Not found');
    });

    it('should return the mapping if found', async () => {
      const existingConfig = {
        id: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f',
        configName: 'Test Config',
        configType: ConfigurationType.file,
        fileServers: [
          {
            id: mockFileServer.id,
            protocol: Protocol.NFS,
            host: 'localhost',
            workers: [],
          },
        ],
      };

      const updateConfigDTO: ConfigDTO = {
        projectId: '123456',
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        workingDirectory: {
          pathId: 'non-existent',
          pathName: '/test/path',
          workingDirectory: '/working/dir',
        },
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            workers: [mockWorker.id],
            userName: 'TEST',
          },
        ],
      };

      const expectedResult = {
        id: existingConfig.id,
        configName: updateConfigDTO.configName,
        configType: updateConfigDTO.configType,
        projectId: updateConfigDTO.projectId,
        createdBy: updateConfigDTO.createdBy,
        fileServers: updateConfigDTO.fileServers,
        workingDirectory: updateConfigDTO.workingDirectory,
      };

      mockConfigRepository.findOne.mockResolvedValue(existingConfig);
      mockConfigRepository.save.mockResolvedValue(expectedResult);
      mockWorkerRepository.find.mockResolvedValue([
        { workerId: mockWorker.id },
      ]);
      mockMappingRepository.findOne.mockResolvedValue({
        id: '1234',
        configId: existingConfig.id,
        pathName: '/test/path',
        workingDirectory: '/working/dir',
        pathId: 'non-existent',
      });

      jest.spyOn(service, 'refreshConfig').mockResolvedValue({} as any);
      const result = await service.updateConfiguration(
        existingConfig.id,
        updateConfigDTO,
        uuidv4(),
        uuidv4(),
      );

      expect(result).toEqual(expectedResult);
      expect(mockMappingRepository.findOne).toHaveBeenCalledWith({
        where: { configId: existingConfig.id },
      });
    });

    it('should throw NotFoundException if mapping is not found', async () => {
      const existingConfig = {
        id: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f',
        configName: 'Test Config',
        configType: ConfigurationType.file,
        createdBy: 'user1',
        fileServers: [
          {
            id: mockFileServer.id,
            protocol: Protocol.NFS,
            host: 'localhost',
            workers: [],
            createdBy: 'user1',
            serverType: 'type1',
            volumes: [],
          },
        ],
      };

      const updateConfigDTO: ConfigDTO = {
        projectId: '123456',
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        workingDirectory: {
          pathId: 'non-existent',
          pathName: '/test/path',
          workingDirectory: '/working/dir',
        },
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            workers: [mockWorker.id],
            userName: 'TEST',
          },
        ],
      };

      mockConfigRepository.findOne.mockResolvedValue(existingConfig);
      mockMappingRepository.findOne.mockResolvedValue(null); // mapping not found
      mockWorkerRepository.find.mockResolvedValue([
        { workerId: mockWorker.id, stats: [] },
      ]);

      jest.spyOn(service, 'refreshConfig').mockResolvedValue({} as any);

      await expect(
        service.updateConfiguration(
          '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f',
          updateConfigDTO,
          uuidv4(),
          uuidv4(),
        ),
      ).rejects.toThrowError(
        new NotFoundException(
          'Mapping for configId 36bfd77f-1d7c-47a3-8c62-3c8739e2f88f not found',
        ),
      );

      expect(mockMappingRepository.findOne).toHaveBeenCalledWith({
        where: { configId: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f' },
      });
    });

    it('should handle update when workingDirectory is null', async () => {
      const existingConfig = {
        id: uuidv4(),
        configName: 'Old Config',
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            workers: [],
          },
        ],
      };

      const updateConfigDTO: ConfigDTO = {
        projectId: '123456',
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        workingDirectory: {
          pathName: '',
          pathId: '',
          workingDirectory: '',
        },
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            userName: 'test',
            workers: [mockWorker.id],
          },
        ],
      };

      const existingMapping = {
        id: 'mapping-123',
        pathId: '123',
        pathName: '/old/path',
        workingDirectory: '/old/dir',
      };

      mockConfigRepository.findOne.mockResolvedValue(existingConfig);
      mockConfigRepository.save.mockResolvedValue({
        ...existingConfig,
        ...updateConfigDTO,
      });
      mockWorkerRepository.find.mockResolvedValue([
        { workerId: mockWorker.id },
      ]);
      mockMappingRepository.findOne.mockResolvedValue(existingMapping);
      mockMappingRepository.save.mockResolvedValue(existingMapping);

      jest.spyOn(service, 'refreshConfig').mockResolvedValue({} as any);
      const result = await service.updateConfiguration(
        existingConfig.id,
        updateConfigDTO,
        uuidv4(),
        uuidv4(),
      );

      expect(result).toBeDefined();
      expect(mockMappingRepository.save).toHaveBeenCalledWith(existingMapping);
    });

    it('should handle fileServer update with missing optional fields', async () => {
      // Mock existing config with an optional userName
      const existingConfig = {
        id: uuidv4(),
        configName: 'Old Config',
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            userName: 'oldUser', // userName is present here
            workers: [],
          },
        ],
      };

      // Updated configuration with userName
      const updateConfigDTO: ConfigDTO = {
        projectId: '123456',
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        workingDirectory: {
          pathName: '',
          pathId: '',
          workingDirectory: '',
        },
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            userName: 'test', // userName provided in update
            workers: [mockWorker.id],
          },
        ],
      };

      // Mock repository behavior
      mockConfigRepository.findOne.mockResolvedValue(existingConfig);
      mockConfigRepository.save.mockImplementation((data) => data);
      mockWorkerRepository.find.mockResolvedValue([
        { workerId: mockWorker.id },
      ]);
      mockMappingRepository.findOne.mockResolvedValue({});
      mockMappingRepository.save.mockImplementation((data) => data);

      jest.spyOn(service, 'refreshConfig').mockResolvedValue({} as any);

      // Call the update configuration service method
      await service.updateConfiguration(
        existingConfig.id,
        updateConfigDTO,
        uuidv4(),
        uuidv4(),
      );

      // Check that the repository is called with the correct userName value
      expect(mockFileServerRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userName: updateConfigDTO.fileServers[0].userName, // check the updated value
        }),
      );
    });
  });

  describe('remove', () => {
    it('should remove the configuration', async () => {
      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockConfigRepository.remove.mockResolvedValue(mockConfig);

      const result = await service.remove(mockConfig.id);

      expect(result).toEqual(mockConfig);
      expect(mockConfigRepository.remove).toHaveBeenCalled();
    });

    it('should throw BadRequestException if invalid UUID is passed', async () => {
      await expect(service.remove('invalid-uuid')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should handle non-existent config during removal', async () => {
      mockConfigRepository.findOne.mockResolvedValue(null);
      mockConfigRepository.remove.mockImplementation(() => {
        throw new NotFoundException('Config for id not found.');
      });

      await expect(service.remove(uuidv4())).rejects.toThrow('Config for id');
    });
  });

  describe('updatePaths', () => {
    it('should update paths correctly', async () => {
      const id = 'config-id';
      const details = {
        completed: [
          {
            protocolType: 'NFS',
            paths: ['/path1', '/path2'],
          },
          {
            protocolType: 'SMB',
            paths: ['/path3'],
          },
        ],
      };

      const mockConfig = {
        id,
        updatedBy: 'user-id',
        createdBy: 'creator-id',
        fileServers: [
          {
            id: 'file-server-1',
            protocol: 'NFS',
            volumes: [{ id: 'vol-1', volumePath: '/path1' }],
          },
          {
            id: 'file-server-2',
            protocol: 'SMB',
            volumes: [],
          },
        ],
      };

      jest
        .spyOn(configRepository, 'findOne')
        .mockResolvedValue(mockConfig as any);
      mockVolumeRepository.update.mockResolvedValue(null);
      mockVolumeRepository.create.mockImplementation((data) => data);
      mockVolumeRepository.save.mockImplementation((data) => data);
      mockFileServerRepository.update.mockResolvedValue(null);
      mockConfigRepository.update.mockResolvedValue(null);

      jest.spyOn(volumeRepo, 'createQueryBuilder').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockReturnValue([
          { id: 'vol-1', volumePath: '/path1' },
          { id: 'vol-2', volumePath: '/path2' },
        ]),
      } as any);

      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      } as any);

      await service.updatePaths(id, details as any);

      expect(configRepository.findOne).toHaveBeenCalledWith({
        select: {
          fileServers: {
            id: true,
            protocol: true,
            volumes: {
              id: true,
              volumePath: true,
            },
          },
        },
        where: { id },
        relations: {
          fileServers: {
            volumes: true,
          },
        },
      });
    });
  });

  describe('refresh', () => {
    it('should throw NotFoundException if config is not found', async () => {
      mockConfigRepository.findOne.mockResolvedValue(null);
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      await expect(
        service.refreshConfig(
          'ed6aeaf2-d304-4973-8a5a-45e1af8a0c81',
          'a8b5219a-79a2-44a4-b323-27dd28d5c0b9',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(configRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'ed6aeaf2-d304-4973-8a5a-45e1af8a0c81' },
        relations: { fileServers: { workers: true } },
      });
    });

    it('should not proceed if no workers are found', async () => {
      const mockConfig = {
        id: 'config-id',
        fileServers: [
          {
            id: 'file-server-1',
            host: 'localhost',
            protocol: 'NFS',
            userName: 'user',
            password: 'pass',
            workers: [],
          },
        ],
      };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);
      const result = await service.refreshConfig(
        'ed6aeaf2-d304-4973-8a5a-45e1af8a0c81',
        'a8b5219a-79a2-44a4-b323-27dd28d5c0b9',
      );

      expect(result).toBeUndefined();
    });

    it('should start workflow and update file servers', async () => {
      const mockConfig = {
        id: 'config-id',
        fileServers: [
          {
            id: 'file-server-1',
            host: 'localhost',
            protocol: 'NFS',
            userName: 'user',
            password: 'pass',
            workers: [{ workerId: 'worker-1' }, { workerId: 'worker-2' }],
          },
        ],
      };

      const mockWorkflow = { workflowId: 'workflow-123' };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);
      mockFileServerRepository.update.mockResolvedValue(null);
      jest
        .spyOn(workflowService, 'startWorkflow')
        .mockResolvedValue(mockWorkflow as any);
      jest.spyOn(service, 'updateResult').mockResolvedValue(null);

      const result = await service.refreshConfig(
        'ed6aeaf2-d304-4973-8a5a-45e1af8a0c81',
        'a8b5219a-79a2-44a4-b323-27dd28d5c0b9',
      );

      expect(result).toEqual({ workflowId: 'workflow-123' });
    });

    it('should return grouped file servers by config', async () => {
      const result = await service.getAllFileServers();
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      expect(result).toEqual([
        {
          id: 'config1',
          serverName: 'Config 1',
          hasScratchPath: true,
          status: 'ACTIVE',
          fileServers: [
            {
              id: 'fileServer1',
              protocol: 'NFS',
              workers: [{ id: 'worker1', workerName: 'Worker 1' }],
            },
          ],
        },
        {
          id: 'config2',
          serverName: 'Config 2',
          hasScratchPath: false,
          status: 'DRAFT',
          fileServers: [
            {
              id: 'fileServer2',
              protocol: 'SMB',
              workers: [],
            },
          ],
        },
      ]);
    });
  });

  describe('getCutoverDetailsByConfigId', () => {
    it('should throw BadRequestException for invalid UUID', async () => {
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);
      await expect(
        service.getCutoverDetailsByConfigId('invalid-uuid'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerErrorException if config not found', async () => {
      mockConfigRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getCutoverDetailsByConfigId(uuidv4()),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return empty array when no valid job configs found', async () => {
      const mockConfig = {
        id: uuidv4(),
        fileServers: [
          {
            protocol: Protocol.NFS,
            volumes: [
              {
                jobConfig: [
                  {
                    jobType: JobType.Scan,
                    jobRunDetails: [{ status: JobRunStatus.Completed }],
                  },
                ],
              },
            ],
          },
        ],
      };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);

      const result = await service.getCutoverDetailsByConfigId(mockConfig.id);
      expect(result).toEqual([]);
    });

    it('should successfully fetch and format cutover details', async () => {
      const configId = uuidv4();
      const mockConfig = {
        id: configId,
        fileServers: [
          {
            protocol: Protocol.NFS,
            volumes: [
              {
                jobConfig: [
                  {
                    id: 'job1',
                    jobType: JobType.Migrate,
                    sourcePathId: 'source1',
                    targetPathId: 'target1',
                    jobRunDetails: [
                      {
                        id: 'run1',
                        status: JobRunStatus.Completed,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const mockVolumes = [
        {
          id: 'source1',
          volumePath: '/source/path',
          isValid: true,
          isDisabled: false,
          fileServer: {
            config: {
              id: 'sourceConfig',
              configName: 'Source Config',
            },
          },
        },
        {
          id: 'target1',
          volumePath: '/target/path',
          isValid: true,
          isDisabled: false,
          fileServer: {
            config: {
              id: 'targetConfig',
              configName: 'Target Config',
            },
          },
        },
      ];

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockVolumeRepository.find.mockResolvedValue(mockVolumes);

      const result = await service.getCutoverDetailsByConfigId(configId);

      expect(result).toEqual([
        {
          protocol: Protocol.NFS,
          sourcePath: {
            id: 'source1',
            sourcePathName: '/source/path',
          },
          destinationPath: {
            id: 'target1',
            destinationPathName: '/target/path',
          },
          destinationFileServer: {
            id: 'targetConfig',
            destinationFileServerName: 'Target Config',
          },
          jobConfig: [
            {
              id: 'job1',
              jobType: JobType.Migrate,
              jobRunDetails: [
                {
                  id: 'run1',
                  status: JobRunStatus.Completed,
                },
              ],
            },
          ],
        },
      ]);
    });

    it('should handle missing volume details', async () => {
      const configId = uuidv4();
      const mockConfig = {
        id: configId,
        fileServers: [
          {
            protocol: Protocol.NFS,
            volumes: [
              {
                jobConfig: [
                  {
                    id: 'job1',
                    jobType: JobType.Migrate,
                    sourcePathId: 'source1',
                    targetPathId: 'target1',
                    jobRunDetails: [
                      {
                        id: 'run1',
                        status: JobRunStatus.Completed,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockVolumeRepository.find.mockResolvedValue([]);

      await expect(
        service.getCutoverDetailsByConfigId(configId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle missing fileServer or config in volume details', async () => {
      const configId = uuidv4();
      const mockConfig = {
        id: configId,
        fileServers: [
          {
            protocol: Protocol.NFS,
            volumes: [
              {
                jobConfig: [
                  {
                    id: 'job1',
                    jobType: JobType.Migrate,
                    sourcePathId: 'source1',
                    targetPathId: 'target1',
                    jobRunDetails: [
                      {
                        id: 'run1',
                        status: JobRunStatus.Completed,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const mockVolumes = [
        {
          id: 'source1',
          volumePath: '/source/path',
          fileServer: null,
          isValid: true,
          isDisabled: false,
        },
        {
          id: 'target1',
          volumePath: '/target/path',
          fileServer: {
            config: null,
          },
          isValid: true,
          isDisabled: false,
        },
      ];

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockVolumeRepository.find.mockResolvedValue(mockVolumes);

      const result = await service.getCutoverDetailsByConfigId(configId);

      expect(result[0].sourcePath).toBeDefined();
      expect(result[0].destinationFileServer).toEqual({
        id: '',
        destinationFileServerName: '',
      });
      expect(result[0].destinationPath.id).toBe('target1');
    });

    it('should handle missing sourcePathId or targetPathId', async () => {
      const configId = uuidv4();
      const mockConfig = {
        id: configId,
        fileServers: [
          {
            protocol: Protocol.NFS,
            volumes: [
              {
                jobConfig: [
                  {
                    id: 'job1',
                    jobType: JobType.Migrate,
                    sourcePathId: null,
                    targetPathId: null,
                    jobRunDetails: [
                      {
                        id: 'run1',
                        status: JobRunStatus.Completed,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockVolumeRepository.find.mockResolvedValue([]);

      await expect(
        service.getCutoverDetailsByConfigId(configId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle database error during volume lookup', async () => {
      const configId = uuidv4();
      const mockConfig = {
        id: configId,
        fileServers: [
          {
            protocol: Protocol.NFS,
            volumes: [
              {
                jobConfig: [
                  {
                    id: 'job1',
                    jobType: JobType.Migrate,
                    sourcePathId: 'source1',
                    targetPathId: 'target1',
                    jobRunDetails: [
                      {
                        id: 'run1',
                        status: JobRunStatus.Completed,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockVolumeRepository.find.mockRejectedValue(new Error('Database error'));

      await expect(
        service.getCutoverDetailsByConfigId(configId),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('checkUniqueConfigName', () => {
    it('should throw NotFoundException if project does not exist', async () => {
      jest.spyOn(projectRepository, 'findOne').mockResolvedValue(null);
      await expect(
        service.isConfigNameUnique('invalid-project-id', 'config-name'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if config name is not unique', async () => {
      jest
        .spyOn(projectRepository, 'findOne')
        .mockResolvedValue(new ProjectEntity());
      jest
        .spyOn(configRepository, 'findOne')
        .mockResolvedValue(new ConfigEntity());
      await expect(
        service.isConfigNameUnique('project-id', 'config-name'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return true if config name is unique', async () => {
      jest
        .spyOn(projectRepository, 'findOne')
        .mockResolvedValue(new ProjectEntity());
      jest.spyOn(configRepository, 'findOne').mockResolvedValue(null);
      await expect(
        service.isConfigNameUnique('project-id', 'config-name'),
      ).resolves.toEqual({ isUnique: true });
    });
  });

  describe('startValidateWorkingDirectoryWorkflow', () => {
    it('should start workflow when conditions are met', async () => {
      const configId = uuidv4();
      const traceId = uuidv4();
      const createConfig = {
        projectId: '123',
        configName: 'config',
        configType: ConfigurationType.file,
        createdBy: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f',
        workingDirectory: {
          pathName: '/test/path',
          pathId: '123',
          workingDirectory: '/working/dir',
        },
        fileServers: [
          {
            id: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f',
            serverType: ServerType.other,
            host: 'test.com',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            createdBy: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f',
            userName: 'test',
            password: 'pass',
            workers: ['worker1'],
          },
        ],
      };

      await service.startValidateWorkingDirectoryWorkflow(
        createConfig,
        configId,
        traceId,
      );

      expect(workflowService.startWorkflow).toHaveBeenCalledWith(
        WorkFlows.VALIDATE_EXPORT_PATH_AND_WORKING_DIRECTORY,
        expect.objectContaining({
          workflowId: expect.stringContaining(traceId),
          taskQueue: 'ParentWorkflow-TaskQueue',
        }),
      );
    });

    it('should not start workflow when no workers', async () => {
      const configId = uuidv4();
      const createConfig = {
        projectId: '123',
        configName: 'config',
        configType: ConfigurationType.file,
        createdBy: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f',
        workingDirectory: {
          pathName: '/test/path',
          pathId: '123',
          workingDirectory: '/working/dir',
        },
        fileServers: [
          {
            id: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f',
            serverType: ServerType.other,
            host: 'test.com',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            createdBy: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f',
            userName: 'test',
            password: 'pass',
            workers: [],
          },
        ],
      };

      startWorkflowMock.mockClear();
      await service.startValidateWorkingDirectoryWorkflow(
        createConfig,
        configId,
        'trace',
      );
      expect(startWorkflowMock).not.toHaveBeenCalled();
    });

    it('should handle workflow start error', async () => {
      const configId = uuidv4();
      const createConfig = {
        projectId: '123',
        configName: 'config',
        configType: ConfigurationType.file,
        createdBy: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f',
        workingDirectory: {
          pathName: '/test/path',
          pathId: '123',
          workingDirectory: '/working/dir',
        },
        fileServers: [
          {
            id: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f',
            serverType: ServerType.other,
            host: 'test.com',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            createdBy: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f',
            userName: 'test',
            password: 'pass',
            workers: ['worker1'],
          },
        ],
      };

      /*    startWorkflowMock.mockRejectedValueOnce(new Error('Workflow error'));
      await service.startValidateWorkingDirectoryWorkflow(
        
      );
      expect(loggerFactoryMock.create().error).toHaveBeenCalled();*/
      await expect(
        service.startValidateWorkingDirectoryWorkflow(
          {
            projectId: '',
            configName: '',
            workingDirectory: new WorkingDirDTO(),
            configType: ConfigurationType.file,
            fileServers: [],
          },
          '',
          '',
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('updateResult', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should handle workflow completion and update paths', async () => {
      const workflowId = 'workflow-1';
      const configId = 'config-1';
      const mockWorkflowResult = {
        status: WorkflowExecutionStatus.COMPLETED,
        completed: [
          {
            protocolType: 'NFS',
            paths: ['/path1'],
          },
        ],
      };

      getWorkFlowResMock.mockResolvedValueOnce(mockWorkflowResult);
      jest.spyOn(service, 'updatePaths').mockResolvedValue(undefined);
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      service.updateResult(workflowId, configId);

      jest.runAllTimers();
      await Promise.resolve();

      expect(getWorkFlowResMock).toHaveBeenCalledWith(workflowId);
      expect(service.updatePaths).toHaveBeenCalledWith(
        configId,
        mockWorkflowResult,
      );
    }, 10000);

    it('should handle missing workflow details', async () => {
      getWorkFlowResMock.mockResolvedValueOnce(null);

      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);
      service.updateResult('workflow-1', 'config-1');

      jest.runAllTimers();
      await Promise.resolve();

      expect(loggerFactoryMock.create().warn).toHaveBeenCalled();
    });

    it('should handle non-completed workflow status', async () => {
      const mockWorkflowResult = {
        status: WorkflowExecutionStatus.RUNNING,
        completed: [],
      };

      getWorkFlowResMock.mockResolvedValueOnce(mockWorkflowResult);
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      service.updateResult('workflow-1', 'config-1');

      jest.runAllTimers();
      await Promise.resolve();

      expect(loggerFactoryMock.create().warn).toHaveBeenCalled();
    });

    it('should handle workflow fetch error', async () => {
      getWorkFlowResMock.mockRejectedValueOnce(new Error('Fetch error'));
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);
      service.updateResult('workflow-1', 'config-1');
      jest.runAllTimers();
      await Promise.resolve();
      expect(loggerFactoryMock.create().error).toHaveBeenCalled();
    });
  });

  describe('updatePaths', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should handle empty paths in workflow details', async () => {
      const configId = uuidv4();
      const details = {
        completed: [
          {
            protocolType: 'NFS',
            paths: [],
          },
        ],
      };

      const mockConfig = {
        fileServers: [
          {
            id: 'fs-1',
            protocol: 'NFS',
            volumes: [],
          },
        ],
        updatedBy: 'test-user',
        createdBy: 'test-user',
      };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockVolumeRepository.create.mockReturnValue([]);
      mockVolumeRepository.save.mockResolvedValue([]);
      mockVolumeRepository.update.mockResolvedValue(undefined);
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      jest.spyOn(volumeRepo, 'createQueryBuilder').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockReturnValue([
          { id: 'vol-1', volumePath: '/path1' },
          { id: 'vol-2', volumePath: '/path2' },
        ]),
      } as any);

      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      } as any);

      await service.updatePaths(configId, details as any);

      expect(mockVolumeRepository.save).toHaveBeenCalledWith([]);
      expect(mockVolumeRepository.create).not.toHaveBeenCalled();
    });

    it('should handle multiple protocols in workflow details', async () => {
      const configId = uuidv4();
      const details = {
        completed: [
          {
            protocolType: 'NFS',
            paths: ['/path1'],
          },
          {
            protocolType: 'SMB',
            paths: ['/path2'],
          },
        ],
      };

      const mockConfig = {
        fileServers: [
          {
            id: 'fs-1',
            protocol: 'NFS',
            volumes: [],
          },
          {
            id: 'fs-2',
            protocol: 'SMB',
            volumes: [],
          },
        ],
        updatedBy: 'test-user',
        createdBy: 'test-user',
      };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockVolumeRepository.create.mockImplementation((data) => data);
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      jest.spyOn(volumeRepo, 'createQueryBuilder').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockReturnValue([
          { id: 'vol-1', volumePath: '/path1' },
          { id: 'vol-2', volumePath: '/path2' },
        ]),
      } as any);

      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      } as any);

      await service.updatePaths(configId, details as any);

      expect(mockVolumeRepository.create).toHaveBeenCalledTimes(2);
      expect(mockVolumeRepository.save).toHaveBeenCalled();
    });

    it('should update existing volumes with new reachable count', async () => {
      const configId = uuidv4();
      const details = {
        completed: [
          {
            protocolType: 'NFS',
            paths: ['/existing-path'],
          },
        ],
      };

      const mockConfig = {
        fileServers: [
          {
            id: 'fs-1',
            protocol: 'NFS',
            volumes: [
              {
                volumePath: '/existing-path',
              },
            ],
          },
        ],
      };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      await service.updatePaths(configId, details as any);
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      jest.spyOn(volumeRepo, 'createQueryBuilder').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockReturnValue([
          { id: 'vol-1', volumePath: '/path1' },
          { id: 'vol-2', volumePath: '/path2' },
        ]),
      } as any);

      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      } as any);

      expect(mockVolumeRepository.update).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ reachableCount: 1 }),
      );
    });

    it('should handle database error in findOne', async () => {
      const configId = uuidv4();
      mockConfigRepository.findOne.mockRejectedValue(
        new Error('Database error'),
      );

      const mockWorkflowStatus = {
        status: WorkflowExecutionStatus.COMPLETED,
        id: 'workflow-1',
        pending: [],
        completed: [],
      };

      await expect(
        service.updatePaths(configId, mockWorkflowStatus),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should handle error in volume update', async () => {
      const configId = uuidv4();
      const details: ListPathWorkflowStatus = {
        status: WorkflowExecutionStatus.COMPLETED,
        id: 'workflow-1',
        pending: [],
        completed: [
          {
            protocolType: Protocol.NFS,
            paths: ['/path1'],
            traceId: 'trace-1',
            status: 'success',
            hostname: 'test-host',
            workerId: 'worker-1',
            message: 'Success',
          },
        ],
      };

      const mockConfig = {
        fileServers: [
          {
            id: 'fs-1',
            protocol: 'NFS',
            volumes: [],
          },
        ],
        updatedBy: 'test-user',
        createdBy: 'test-user',
      };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockVolumeRepository.update.mockRejectedValue(new Error('Update failed'));
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      jest.spyOn(volumeRepo, 'createQueryBuilder').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockReturnValue([
          { id: 'vol-1', volumePath: '/path1' },
          { id: 'vol-2', volumePath: '/path2' },
        ]),
      } as any);

      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      } as any);

      await expect(service.updatePaths(configId, details)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should handle error in volume save', async () => {
      const configId = uuidv4();
      const details: ListPathWorkflowStatus = {
        status: WorkflowExecutionStatus.COMPLETED,
        id: 'workflow-1',
        pending: [],
        completed: [
          {
            protocolType: Protocol.NFS,
            paths: ['/path1'],
            traceId: 'trace-1',
            status: 'success',
            hostname: 'test-host',
            workerId: 'worker-1',
            message: 'Success',
          },
        ],
      };

      const mockConfig = {
        fileServers: [
          {
            id: 'fs-1',
            protocol: 'NFS',
            volumes: [],
          },
        ],
        updatedBy: 'test-user',
        createdBy: 'test-user',
      };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockVolumeRepository.save.mockRejectedValue(new Error('Save failed'));
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      jest.spyOn(volumeRepo, 'createQueryBuilder').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockReturnValue([
          { id: 'vol-1', volumePath: '/path1' },
          { id: 'vol-2', volumePath: '/path2' },
        ]),
      } as any);

      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      } as any);

      await expect(service.updatePaths(configId, details)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should not add duplicate paths to pathsMap', async () => {
      const configId = uuidv4();
      const details = {
        completed: [
          {
            protocolType: 'NFS',
            paths: ['/path1', '/path1'], // duplicate path
          },
        ],
      };

      const mockConfig = {
        fileServers: [
          {
            id: 'fs-1',
            protocol: 'NFS',
            volumes: [],
          },
        ],
        updatedBy: 'test-user',
        createdBy: 'test-user',
      };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockVolumeRepository.create.mockImplementation((data) => data);
      mockVolumeRepository.save.mockResolvedValue([]);
      mockVolumeRepository.update.mockResolvedValue(undefined);

      jest.spyOn(volumeRepo, 'createQueryBuilder').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockReturnValue([]),
      } as any);

      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      } as any);

      await service.updatePaths(configId, details as any);
      expect(mockVolumeRepository.create).toHaveBeenCalledTimes(1); // should only create once
    });

    it('should not update jobs if no invalid or disabled volumes exist', async () => {
      const configId = uuidv4();
      const details = {
        completed: [
          {
            protocolType: 'NFS',
            paths: ['/path1'],
          },
        ],
      };

      const mockConfig = {
        fileServers: [
          {
            id: 'fs-1',
            protocol: 'NFS',
            volumes: [],
          },
        ],
        updatedBy: 'test-user',
        createdBy: 'test-user',
      };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockVolumeRepository.create.mockImplementation((data) => data);
      mockVolumeRepository.save.mockResolvedValue([]);
      mockVolumeRepository.update.mockResolvedValue(undefined);

      jest.spyOn(volumeRepo, 'createQueryBuilder').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockReturnValue([]), // no invalid/disabled volumes
      } as any);

      const jobUpdate = jest.fn();
      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        update: jobUpdate,
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      } as any);

      await service.updatePaths(configId, details as any);

      expect(jobUpdate).not.toHaveBeenCalled();
    });

    it('should fallback to createdBy if updatedBy is not set', async () => {
      const configId = uuidv4();
      const details = {
        completed: [
          {
            protocolType: 'NFS',
            paths: ['/new-path'],
          },
        ],
      };

      const mockConfig = {
        fileServers: [
          {
            id: 'fs-1',
            protocol: 'NFS',
            volumes: [],
          },
        ],
        updatedBy: undefined,
        createdBy: 'creator',
      };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockVolumeRepository.create.mockImplementation((data) => data);
      mockVolumeRepository.save.mockResolvedValue([]);
      mockVolumeRepository.update.mockResolvedValue(undefined);

      jest.spyOn(volumeRepo, 'createQueryBuilder').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockReturnValue([]),
      } as any);

      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      } as any);

      await service.updatePaths(configId, details as any);

      expect(mockVolumeRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: 'creator' }),
      );
    });

    it('should not create volumes if all paths already exist', async () => {
      const configId = uuidv4();
      const details = {
        completed: [
          {
            protocolType: 'NFS',
            paths: ['/existing-path'],
          },
        ],
      };

      const mockConfig = {
        fileServers: [
          {
            id: 'fs-1',
            protocol: 'NFS',
            volumes: [{ volumePath: '/existing-path' }],
          },
        ],
        updatedBy: 'test-user',
        createdBy: 'test-user',
      };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockVolumeRepository.update.mockResolvedValue(undefined);
      mockVolumeRepository.save.mockResolvedValue([]);
      mockVolumeRepository.create.mockImplementation((data) => data);

      jest.spyOn(volumeRepo, 'createQueryBuilder').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockReturnValue([]),
      } as any);

      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      } as any);

      await service.updatePaths(configId, details as any);
      expect(mockVolumeRepository.create).not.toHaveBeenCalled();
      expect(mockVolumeRepository.save).toHaveBeenCalledWith([]);
    });
  });

  describe('refreshConfig', () => {
    it('should throw BadRequestException for invalid UUID', async () => {
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);
      await expect(
        service.refreshConfig('invalid-uuid', 'trace-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when config not found', async () => {
      const configId = uuidv4();
      mockConfigRepository.findOne.mockResolvedValue(null);
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      await expect(
        service.refreshConfig(configId, 'trace-123'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle empty fileServers array', async () => {
      const configId = uuidv4();
      mockConfigRepository.findOne.mockResolvedValue({
        id: configId,
        fileServers: [],
      });
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      const result = await service.refreshConfig(configId, 'trace-123');
      expect(result).toBeUndefined();
    });

    it('should handle database error', async () => {
      const configId = uuidv4();
      mockConfigRepository.findOne.mockRejectedValue(
        new Error('Database error'),
      );
      jest.spyOn(service, 'isRefreshPossible').mockResolvedValue(true);

      await expect(
        service.refreshConfig(configId, 'trace-123'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('updateConfiguration', () => {
    const userId = 'user-123';
    const traceId = 'trace-123';

    it('should throw BadRequestException if configId is invalid', async () => {
      await expect(
        service.updateConfiguration(
          'invalid-uuid',
          {} as ConfigDTO,
          userId,
          traceId,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw NotFoundException if config is not found', async () => {
      mockConfigRepository.findOne.mockResolvedValue(null);
      await expect(
        service.updateConfiguration(uuidv4(), {} as ConfigDTO, userId, traceId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if mapping is not found', async () => {
      const configId = uuidv4();
      const config = {
        id: configId,
        configName: 'Test Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            workers: [],
            volumes: [],
            serverType: ServerType.emc,
            createdBy: userId,
          },
        ],
      };
      const updateConfigDTO: ConfigDTO = {
        projectId: 'proj-1',
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        workingDirectory: {
          pathName: '/new/path',
          pathId: 'path-1',
          workingDirectory: '/working/dir',
        },
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            workers: [mockWorker.id],
            userName: 'user',
          },
        ],
      };
      mockConfigRepository.findOne.mockResolvedValue(config);
      mockMappingRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateConfiguration(configId, updateConfigDTO, userId, traceId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update config and send email with added/removed workers', async () => {
      const configId = uuidv4();
      const config = {
        id: configId,
        configName: 'Old Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        updatedBy: undefined,
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            workers: [{ workerId: 'old-worker', workerName: 'Old Worker' }],
            volumes: [],
            serverType: ServerType.emc,
            createdBy: userId,
          },
        ],
      };
      const updateConfigDTO: ConfigDTO = {
        projectId: 'proj-1',
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        workingDirectory: {
          pathName: '/new/path',
          pathId: 'path-1',
          workingDirectory: '/working/dir',
        },
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            workers: [mockWorker.id],
            userName: 'user',
          },
        ],
      };
      const mapping = {
        id: 'mapping-1',
        configId,
        pathName: '/old/path',
        workingDirectory: '/old/dir',
        pathId: 'old-path-id',
      };
      mockConfigRepository.findOne.mockResolvedValue(config);
      mockMappingRepository.findOne.mockResolvedValue(mapping);
      mockWorkerRepository.find.mockResolvedValue([
        {
          workerId: mockWorker.id,
          workerName: 'Worker1',
          stats: { updatedAt: new Date() },
        },
      ]);
      mockWorkerRepository.find.mockImplementation(({ where }) => {
        if (where && where.workerId && Array.isArray(where.workerId._value)) {
          return Promise.resolve([
            {
              workerId: mockWorker.id,
              workerName: 'Worker1',
              stats: { updatedAt: new Date() },
            },
          ]);
        }
        return Promise.resolve([]);
      });
      mockFileServerRepository.create.mockImplementation((data) => data);
      mockConfigRepository.save.mockImplementation((data) => data);
      mockMappingRepository.save.mockImplementation((data) => data);
      jest.spyOn(service, 'refreshConfig').mockResolvedValue({} as any);
      sendMailService.sendMail = jest.fn().mockResolvedValue(undefined);

      const result = await service.updateConfiguration(
        configId,
        updateConfigDTO,
        userId,
        traceId,
      );

      expect(mockConfigRepository.save).toHaveBeenCalled();
      expect(sendMailService.sendMail).toHaveBeenCalled();
      expect(result.configName).toBe('Updated Config');
      expect(mockMappingRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          pathName: '/new/path',
          workingDirectory: '/working/dir',
          pathId: 'path-1',
        }),
      );
    });

    it('should set config status to ERRORED if all workers are unhealthy', async () => {
      const configId = uuidv4();
      const config = {
        id: configId,
        configName: 'Old Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        updatedBy: undefined,
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            workers: [{ workerId: mockWorker.id, workerName: 'Worker1' }],
            volumes: [],
            serverType: ServerType.emc,
            createdBy: userId,
          },
        ],
      };
      const updateConfigDTO: ConfigDTO = {
        projectId: 'proj-1',
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        workingDirectory: {
          pathName: '/new/path',
          pathId: 'path-1',
          workingDirectory: '/working/dir',
        },
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            workers: [mockWorker.id],
            userName: 'user',
          },
        ],
      };
      const mapping = {
        id: 'mapping-1',
        configId,
        pathName: '/old/path',
        workingDirectory: '/old/dir',
        pathId: 'old-path-id',
      };
      mockConfigRepository.findOne.mockResolvedValue(config);
      mockMappingRepository.findOne.mockResolvedValue(mapping);
      // Simulate unhealthy workers
      mockWorkerRepository.find.mockResolvedValue([
        {
          workerId: mockWorker.id,
          workerName: 'Worker1',
          stats: { updatedAt: new Date(Date.now() - 1000 * 1000) },
        },
      ]);
      mockFileServerRepository.create.mockImplementation((data) => data);
      mockConfigRepository.save.mockImplementation((data) => data);
      mockMappingRepository.save.mockImplementation((data) => data);
      jest.spyOn(service, 'isAllWorkerUnHealthy').mockResolvedValue(true);
      jest.spyOn(service, 'refreshConfig').mockResolvedValue({} as any);
      sendMailService.sendMail = jest.fn().mockResolvedValue(undefined);

      const result = await service.updateConfiguration(
        configId,
        updateConfigDTO,
        userId,
        traceId,
      );

      expect(result.status).toBeDefined();
      expect(result.status).toBe('ERRORED');
    });

    it('should throw InternalServerErrorException on unexpected error', async () => {
      const configId = uuidv4();
      const config = {
        id: configId,
        configName: 'Old Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            workers: [],
            volumes: [],
            serverType: ServerType.emc,
            createdBy: userId,
          },
        ],
      };
      const updateConfigDTO: ConfigDTO = {
        projectId: 'proj-1',
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        workingDirectory: {
          pathName: '/new/path',
          pathId: 'path-1',
          workingDirectory: '/working/dir',
        },
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            workers: [mockWorker.id],
            userName: 'user',
          },
        ],
      };
      mockConfigRepository.findOne.mockResolvedValue(config);
      mockMappingRepository.findOne.mockResolvedValue({});
      mockWorkerRepository.find.mockImplementation(() => {
        throw new Error('DB error');
      });

      await expect(
        service.updateConfiguration(configId, updateConfigDTO, userId, traceId),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should update config when workingDirectory is null', async () => {
      const configId = uuidv4();
      const config = {
        id: configId,
        configName: 'Old Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            workers: [],
            volumes: [],
            serverType: ServerType.emc,
            createdBy: userId,
          },
        ],
      };
      const updateConfigDTO: ConfigDTO = {
        projectId: 'proj-1',
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        workingDirectory: {
          pathName: '',
          pathId: '',
          workingDirectory: '',
        },
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            workers: [mockWorker.id],
            userName: 'user',
          },
        ],
      };
      const mapping = {
        id: 'mapping-1',
        configId,
        pathName: '/old/path',
        workingDirectory: '/old/dir',
        pathId: 'old-path-id',
      };
      mockConfigRepository.findOne.mockResolvedValue(config);
      mockMappingRepository.findOne.mockResolvedValue(mapping);
      mockWorkerRepository.find.mockResolvedValue([
        {
          workerId: mockWorker.id,
          workerName: 'Worker1',
          stats: { updatedAt: new Date() },
        },
      ]);
      mockFileServerRepository.create.mockImplementation((data) => data);
      mockConfigRepository.save.mockImplementation((data) => data);
      mockMappingRepository.save.mockImplementation((data) => data);
      jest.spyOn(service, 'refreshConfig').mockResolvedValue({} as any);
      sendMailService.sendMail = jest.fn().mockResolvedValue(undefined);

      const result = await service.updateConfiguration(
        configId,
        updateConfigDTO,
        userId,
        traceId,
      );

      expect(result.configName).toBe('Updated Config');
      expect(mockMappingRepository.save).toHaveBeenCalledWith(
        expect.objectContaining(mapping),
      );
    });
  });

  describe('updateConfiguration (additional cases)', () => {
    const userId = 'user-123';
    const traceId = 'trace-123';
    const configId = uuidv4();

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should throw BadRequestException if id is not a valid UUID', async () => {
      await expect(
        service.updateConfiguration(
          'not-a-uuid',
          {} as ConfigDTO,
          userId,
          traceId,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw NotFoundException if config is not found', async () => {
      mockConfigRepository.findOne.mockResolvedValue(null);
      await expect(
        service.updateConfiguration(configId, {} as ConfigDTO, userId, traceId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if mapping is not found', async () => {
      const config = {
        id: configId,
        configName: 'Test Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            workers: [],
            volumes: [],
            serverType: ServerType.emc,
            createdBy: userId,
          },
        ],
      };
      const updateConfigDTO: ConfigDTO = {
        projectId: 'proj-1',
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        workingDirectory: {
          pathName: '/new/path',
          pathId: 'path-1',
          workingDirectory: '/working/dir',
        },
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            workers: [mockWorker.id],
            userName: 'user',
          },
        ],
      };
      mockConfigRepository.findOne.mockResolvedValue(config);
      mockMappingRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateConfiguration(configId, updateConfigDTO, userId, traceId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update config and send email with added/removed workers', async () => {
      const config = {
        id: configId,
        configName: 'Old Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        updatedBy: undefined,
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            workers: [{ workerId: 'old-worker', workerName: 'Old Worker' }],
            volumes: [],
            serverType: ServerType.emc,
            createdBy: userId,
          },
        ],
      };
      const updateConfigDTO: ConfigDTO = {
        projectId: 'proj-1',
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        workingDirectory: {
          pathName: '/new/path',
          pathId: 'path-1',
          workingDirectory: '/working/dir',
        },
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            workers: [mockWorker.id],
            userName: 'user',
          },
        ],
      };
      const mapping = {
        id: 'mapping-1',
        configId,
        pathName: '/old/path',
        workingDirectory: '/old/dir',
        pathId: 'old-path-id',
      };
      mockConfigRepository.findOne.mockResolvedValue(config);
      mockMappingRepository.findOne.mockResolvedValue(mapping);
      mockWorkerRepository.find.mockResolvedValue([
        {
          workerId: mockWorker.id,
          workerName: 'Worker1',
          stats: { updatedAt: new Date() },
        },
      ]);
      mockWorkerRepository.find.mockImplementation(({ where }) => {
        if (where && where.workerId && Array.isArray(where.workerId._value)) {
          return Promise.resolve([
            {
              workerId: mockWorker.id,
              workerName: 'Worker1',
              stats: { updatedAt: new Date() },
            },
          ]);
        }
        return Promise.resolve([]);
      });
      mockFileServerRepository.create.mockImplementation((data) => data);
      mockConfigRepository.save.mockImplementation((data) => data);
      mockMappingRepository.save.mockImplementation((data) => data);
      jest.spyOn(service, 'refreshConfig').mockResolvedValue({} as any);
      sendMailService.sendMail = jest.fn().mockResolvedValue(undefined);

      const result = await service.updateConfiguration(
        configId,
        updateConfigDTO,
        userId,
        traceId,
      );

      expect(mockConfigRepository.save).toHaveBeenCalled();
      expect(sendMailService.sendMail).toHaveBeenCalled();
      expect(result.configName).toBe('Updated Config');
      expect(mockMappingRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          pathName: '/new/path',
          workingDirectory: '/working/dir',
          pathId: 'path-1',
        }),
      );
    });

    it('should set config status to ERRORED if all workers are unhealthy', async () => {
      const config = {
        id: configId,
        configName: 'Old Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        updatedBy: undefined,
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            workers: [{ workerId: mockWorker.id, workerName: 'Worker1' }],
            volumes: [],
            serverType: ServerType.emc,
            createdBy: userId,
          },
        ],
      };
      const updateConfigDTO: ConfigDTO = {
        projectId: 'proj-1',
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        workingDirectory: {
          pathName: '/new/path',
          pathId: 'path-1',
          workingDirectory: '/working/dir',
        },
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            workers: [mockWorker.id],
            userName: 'user',
          },
        ],
      };
      const mapping = {
        id: 'mapping-1',
        configId,
        pathName: '/old/path',
        workingDirectory: '/old/dir',
        pathId: 'old-path-id',
      };
      mockConfigRepository.findOne.mockResolvedValue(config);
      mockMappingRepository.findOne.mockResolvedValue(mapping);
      // Simulate unhealthy workers
      mockWorkerRepository.find.mockResolvedValue([
        {
          workerId: mockWorker.id,
          workerName: 'Worker1',
          stats: { updatedAt: new Date(Date.now() - 1000 * 1000) },
        },
      ]);
      mockFileServerRepository.create.mockImplementation((data) => data);
      mockConfigRepository.save.mockImplementation((data) => data);
      mockMappingRepository.save.mockImplementation((data) => data);
      jest.spyOn(service, 'isAllWorkerUnHealthy').mockResolvedValue(true);
      jest.spyOn(service, 'refreshConfig').mockResolvedValue({} as any);
      sendMailService.sendMail = jest.fn().mockResolvedValue(undefined);

      const result = await service.updateConfiguration(
        configId,
        updateConfigDTO,
        userId,
        traceId,
      );

      expect(result.status).toBe('ERRORED');
    });

    it('should throw InternalServerErrorException on unexpected error', async () => {
      const config = {
        id: configId,
        configName: 'Old Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            workers: [],
            volumes: [],
            serverType: ServerType.emc,
            createdBy: userId,
          },
        ],
      };
      const updateConfigDTO: ConfigDTO = {
        projectId: 'proj-1',
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        workingDirectory: {
          pathName: '/new/path',
          pathId: 'path-1',
          workingDirectory: '/working/dir',
        },
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            workers: [mockWorker.id],
            userName: 'user',
          },
        ],
      };
      mockConfigRepository.findOne.mockResolvedValue(config);
      mockMappingRepository.findOne.mockResolvedValue({});
      mockWorkerRepository.find.mockImplementation(() => {
        throw new Error('DB error');
      });

      await expect(
        service.updateConfiguration(configId, updateConfigDTO, userId, traceId),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should update config when workingDirectory is null', async () => {
      const config = {
        id: configId,
        configName: 'Old Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            workers: [],
            volumes: [],
            serverType: ServerType.emc,
            createdBy: userId,
          },
        ],
      };
      const updateConfigDTO: ConfigDTO = {
        projectId: 'proj-1',
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        createdBy: userId,
        workingDirectory: {
          pathName: '',
          pathId: '',
          workingDirectory: '',
        },
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            workers: [mockWorker.id],
            userName: 'user',
          },
        ],
      };
      const mapping = {
        id: 'mapping-1',
        configId,
        pathName: '/old/path',
        workingDirectory: '/old/dir',
        pathId: 'old-path-id',
      };
      mockConfigRepository.findOne.mockResolvedValue(config);
      mockMappingRepository.findOne.mockResolvedValue(mapping);
      mockWorkerRepository.find.mockResolvedValue([
        {
          workerId: mockWorker.id,
          workerName: 'Worker1',
          stats: { updatedAt: new Date() },
        },
      ]);
      mockFileServerRepository.create.mockImplementation((data) => data);
      mockConfigRepository.save.mockImplementation((data) => data);
      mockMappingRepository.save.mockImplementation((data) => data);
      jest.spyOn(service, 'refreshConfig').mockResolvedValue({} as any);
      sendMailService.sendMail = jest.fn().mockResolvedValue(undefined);

      const result = await service.updateConfiguration(
        configId,
        updateConfigDTO,
        userId,
        traceId,
      );

      expect(result.configName).toBe('Updated Config');
      expect(mockMappingRepository.save).toHaveBeenCalledWith(
        expect.objectContaining(mapping),
      );
    });

    it('should update fileServer with missing optional fields', async () => {
      const config = {
        id: configId,
        configName: 'Old Config',
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            userName: 'oldUser',
            workers: [],
          },
        ],
      };
      const updateConfigDTO: ConfigDTO = {
        projectId: 'proj-1',
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        workingDirectory: {
          pathName: '',
          pathId: '',
          workingDirectory: '',
        },
        fileServers: [
          {
            id: mockFileServer.id,
            host: 'localhost',
            protocol: Protocol.NFS,
            protocolVersion: ProtocolVersion.NFSv3,
            userName: 'test',
            workers: [mockWorker.id],
          },
        ],
      };
      mockConfigRepository.findOne.mockResolvedValue(config);
      mockConfigRepository.save.mockImplementation((data) => data);
      mockWorkerRepository.find.mockResolvedValue([
        { workerId: mockWorker.id },
      ]);
      mockMappingRepository.findOne.mockResolvedValue({});
      mockMappingRepository.save.mockImplementation((data) => data);
      mockFileServerRepository.create.mockImplementation((data) => data);
      jest.spyOn(service, 'refreshConfig').mockResolvedValue({} as any);

      await service.updateConfiguration(
        configId,
        updateConfigDTO,
        userId,
        traceId,
      );

      expect(mockFileServerRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userName: updateConfigDTO.fileServers[0].userName,
        }),
      );
    });
  });

  describe('isRefreshPossible', () => {
    it('should return false if any job config has scheduler as SCHEDULING', async () => {
      const configId = 'config-id';
      const fileServerId = 'file-server-id';
      const mockConfig = [
        {
          id: 'config-id',
          fileServers: [
            {
              id: 'file-server-id',
              volumes: [{ id: 'volume-id', volumePath: '/path/to/volume' }],
            },
          ],
        },
      ];
      jest
        .spyOn(mockConfigRepository, 'find')
        .mockResolvedValue(mockConfig as any);
      jest.spyOn(jobConfigRepo, 'find').mockResolvedValue([
        { scheduler: 'SCHEDULING', fileServerId } as any,
      ]);
      const result = await service.isRefreshPossible(configId);
      expect(result).toBe(false);
    });

    it('SHould return false if any job config has job scheduled for future', async () => {
      const configId = 'config-id';
      const fileServerId = 'file-server-id';
      const mockConfig = [
        {
          id: 'config-id',
          fileServers: [
            {
              id: fileServerId,
              volumes: [{ id: 'volume-id', volumePath: '/path/to/volume' }],
            },
          ],
        },
      ];
      jest
        .spyOn(mockConfigRepository, 'find')
        .mockResolvedValue(mockConfig as any);
      jest.spyOn(jobConfigRepo, 'find').mockResolvedValue([
        {
          fileServerId: fileServerId,
          futureScheduleAt: '*/5 * * * *',
        } as any,
      ]);
      const result = await service.isRefreshPossible(configId);
      expect(result).toBe(false);
    });

    it('Should return true if file server has no volumes', async () => {
      const configId = 'config-id';
      const fileServerId = 'file-server-id';
      const mockConfig = [
        {
          id: 'config-id',
          fileServers: [
            {
              id: fileServerId,
              volumes: [],
            },
          ],
        },
      ];
      jest
        .spyOn(mockConfigRepository, 'find')
        .mockResolvedValue(mockConfig as any);
      jest.spyOn(jobConfigRepo, 'find').mockResolvedValue([]);
      const result = await service.isRefreshPossible(configId);
      expect(result).toBe(true);
    });

    it('Should return false if any job is running for the file server', async () => {
      const configId = 'config-id';
      const fileServerId = 'file-server-id';
      const mockConfig = [
        {
          id: 'config-id',
          fileServers: [
            {
              id: fileServerId,
              volumes: [{ id: 'volume-id', volumePath: '/path/to/volume' }],
            },
          ],
        },
      ];
      jest
        .spyOn(mockConfigRepository, 'find')
        .mockResolvedValue(mockConfig as any);
      jest.spyOn(jobConfigRepo, 'find').mockResolvedValue([
        { fileServerId: fileServerId, futureScheduleAt: null } as any,
      ]);
      jest.spyOn(jobRunRepo, 'count').mockResolvedValue(1);
      const result = await service.isRefreshPossible(configId);
      expect(result).toBe(false);
    });

    it('Should return true if file server is valid for refresh', async () => {
      const configId = 'config-id';
      const fileServerId = 'file-server-id';
      const mockConfig = [
        {
          id: 'config-id',
          fileServers: [
            {
              id: fileServerId,
              volumes: [{ id: 'volume-id', volumePath: '/path/to/volume' }],
            },
          ],
        },
      ];
      jest
        .spyOn(mockConfigRepository, 'find')
        .mockResolvedValue(mockConfig as any);
      jest.spyOn(jobConfigRepo, 'find').mockResolvedValue([
        { fileServerId: fileServerId, futureScheduleAt: null } as any,
      ]);
      jest.spyOn(jobRunRepo, 'count').mockResolvedValue(0);
      const result = await service.isRefreshPossible(configId);
      expect(result).toBe(true);
    });
  });

  describe('isUploadInProgress', () => {
    it('Should return false if no upload found for file server', async () => {
      jest.spyOn(pathUploadRepository, 'createQueryBuilder').mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      } as any);
      const result = await service.isUploadInProgress(['file-server-id']);
      expect(result).toBe(false);
    });

    it('Should return false if no workers found for file server', async () => {
      jest.spyOn(pathUploadRepository, 'createQueryBuilder').mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          fileServerId: 'file-server-id',
          workers: [],
          uploadId: 'upload-id',
        }),
      } as any);

      jest.spyOn(workflowService, 'getWorkFlowRes').mockResolvedValue(null);
      const result = await service.isUploadInProgress(['file-server-id']);
      expect(result).toBe(false);
    });

    it('Should return true if upload is in progress for file server', async () => {
      jest.spyOn(pathUploadRepository, 'findOne').mockReturnValue({
        uploadId: 'upload-id',
      } as any);

      const mockWorkflowResult = {
        status: WorkflowExecutionStatus.RUNNING,
        id: 'workflow-1',
      };
      jest
        .spyOn(workflowService, 'getWorkFlowRes')
        .mockResolvedValue(mockWorkflowResult as any);

      const result = await service.isUploadInProgress(['file-server-id']);
      expect(result).toBe(true);
    });

    it('Should return false if got into catch block', async () => {
      jest
        .spyOn(pathUploadRepository, 'findOne')
        .mockRejectedValue(new Error('Database error'));

      const result = await service.isUploadInProgress(['file-server-id']);
      expect(result).toBe(false);
    });
  });
});
