import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  IdentityTypes,
  JobContextFactory,
  JobStatus,
  SpeedTestJobConfig,
  SpeedTestJobContextProvider,
} from '@netapp-cloud-datamigrate/jobs-lib';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import axios from 'axios';
import {
  JobRunStatus,
  JobType,
  JobStatus as JS,
  Protocol,
  WorkFlows,
} from 'src/constants/enums';
import { ScheduleStatus } from 'src/constants/status';
import { IdentityConfigCrossMappingEntity } from 'src/entities/indentity-mapping-cross.entity';
import { IdentityMappingEntity } from 'src/entities/indentity-mapping.entity';
import { JobOptionsEntity } from 'src/entities/joboptions.entity';
import { SpeedTestConfigEntity } from 'src/entities/speed-test-job-config.entity';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import { Readable } from 'stream';
import { Repository } from 'typeorm';
import { FileServerEntity } from '../entities/fileserver.entity';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobRunEntity } from '../entities/jobrun.entity';
import { MigrationConflictService } from '../migration-conflict/migration-conflict.service';
import { RedisService } from '../redis/redis.service';
import { AuthService } from '../auth/auth.service';
import { HttpService } from '@nestjs/axios';
import { WorkflowService } from '../workflow/workflow.service';
import { JobRunInitService } from './jobrun.init.service';
import { JobRunConfig } from './jobrun.types';
import { NotFoundException } from '@nestjs/common';

// Mock the filterUnhealthyWorkers function
jest.mock('../utils/worker-filter', () => ({
  filterUnhealthyWorkers: jest.fn().mockImplementation((worker, timeout) => {
    // Default to true unless specifically configured in tests
    if (worker.workerId === 'unhealthy-worker') return false;
    if (worker.workerId === 'outdated-worker') return false;
    return true;
  }),
}));

describe('JobRunInitService', () => {
  let service: JobRunInitService;
  let jobRunRepo: Repository<JobRunEntity>;
  let speedTestConfigRepo: Repository<SpeedTestConfigEntity>;
  let jobConfigRepo: Repository<JobConfigEntity>;
  let fileServerRepo: Repository<FileServerEntity>;
  let workerJobRunMapRepo: Repository<WorkerJobRunMap>;
  let optionRepo: Repository<JobOptionsEntity>;
  let identityMappingRepo: Repository<IdentityMappingEntity>;
  let identityConfigCrossMappingRepo: Repository<IdentityConfigCrossMappingEntity>;
  let workFlowService: WorkflowService;
  let configService: ConfigService;
  let redisService: RedisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobRunInitService,
        {
          provide: getRepositoryToken(JobRunEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(SpeedTestConfigEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(JobConfigEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(FileServerEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(WorkerJobRunMap),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(JobOptionsEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(IdentityMappingEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(IdentityConfigCrossMappingEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(WorkerJobRunMap),
          useClass: Repository,
          useValue: {
            create: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(JobConfigEntity),
          useValue: {
            update: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: WorkflowService,
          useValue: {
            startWorkflow: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            getClient: jest.fn(),
            setJobContext: jest.fn(),
          },
        },
        {
          provide: AuthService,
          useValue: {
            getAccessToken: jest.fn().mockResolvedValue('mock-jwt-token'),
          },
        },
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
            post: jest.fn(),
          },
        },
        {
          provide: MigrationConflictService,
          useValue: {
            checkMigrationConflicts: jest.fn().mockResolvedValue([]),
            hasMigrationConflicts: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue({
              info: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
              debug: jest.fn(),
              log: jest.fn(),
              verbose: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<JobRunInitService>(JobRunInitService);
    jobRunRepo = module.get<Repository<JobRunEntity>>(
      getRepositoryToken(JobRunEntity),
    );
    speedTestConfigRepo = module.get<Repository<SpeedTestConfigEntity>>(
      getRepositoryToken(SpeedTestConfigEntity),
    );
    jobConfigRepo = module.get<Repository<JobConfigEntity>>(
      getRepositoryToken(JobConfigEntity),
    );
    fileServerRepo = module.get<Repository<FileServerEntity>>(
      getRepositoryToken(FileServerEntity),
    );
    workerJobRunMapRepo = module.get<Repository<WorkerJobRunMap>>(
      getRepositoryToken(WorkerJobRunMap),
    );
    optionRepo = module.get<Repository<JobOptionsEntity>>(
      getRepositoryToken(JobOptionsEntity),
    );
    identityMappingRepo = module.get<Repository<IdentityMappingEntity>>(
      getRepositoryToken(IdentityMappingEntity),
    );
    identityConfigCrossMappingRepo = module.get<
      Repository<IdentityConfigCrossMappingEntity>
    >(getRepositoryToken(IdentityConfigCrossMappingEntity));
    workFlowService = module.get<WorkflowService>(WorkflowService);
    configService = module.get<ConfigService>(ConfigService);
    redisService = module.get<RedisService>(RedisService);
    const mountBasePath = 'test-mount-base-path';
    jest.spyOn(configService, 'get').mockReturnValue(mountBasePath);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
  describe('scheduleAJob', () => {
    it('should return an array of jobs', async () => {
      const currentTime = new Date('2025-07-24T14:42:45.764Z');
      const originalDate = global.Date;
      global.Date = jest.fn(() => currentTime) as any;
      global.Date.now = jest.fn(() => currentTime.getTime());

      const jobs: JobConfigEntity[] = [];
      jest.spyOn(jobConfigRepo, 'find').mockResolvedValue(jobs);

      const result = await service.scheduleAJob();

      expect(result).toEqual(jobs);
      expect(jobConfigRepo.find).toHaveBeenCalledWith({
        select: {
          id: true,
          sourcePathId: true,
          targetPathId: true,
          sourceDirectoryPath: true,
          targetDirectoryPath: true,
          sourcePath: {
            fileServer: {
              config: {
                projectId: true,
              },
            },
          },
        },
        relations: {
          sourcePath: {
            fileServer: {
              config: true,
            },
          },
        },
        where: {
          status: 'ACTIVE',
          scheduler: ScheduleStatus.SCHEDULING,
          firstRunAt: expect.any(Object), // Use a more flexible assertion for the LessThan object
        },
      });

      // Restore original Date constructor
      global.Date = originalDate;
    });
  });

  describe('createJobRun', () => {
    it('should create a job run and return it', async () => {
      const jobConfigId = 'jobConfigId';
      const currentTime = new Date();
      const details = {} as any;
      details.jobType = JobType.DISCOVER;
      details.workers = [{ workersId: 'worker1' }, { workersId: 'worker2' }];
      details.connection = {
        sourceCredential: {
          pathId: 'sourcePathId',
          protocol: Protocol.NFS,
          username: 'username',
          password: 'password',
          host: 'localhost',
          workingDirectory: '/mount/base/path',
          isValidPath: true,
        },
        targetCredential: {
          pathId: 'targetPathId',
          protocol: Protocol.NFS,
          username: 'username',
          password: 'password',
          host: 'localhost',
          workingDirectory: '/mount/base/path',
          isValidPath: true,
        },
      };
      const jobRunRecord = {};
      const jobRun = {};

      jest.spyOn(service, 'getJobConfig').mockResolvedValue(details);
      jest.spyOn(workerJobRunMapRepo, 'create').mockReturnValue({} as any);
      jest.spyOn(optionRepo, 'create').mockReturnValue({} as any);
      jest.spyOn(jobRunRepo, 'create').mockReturnValue(jobRunRecord as any);
      jest.spyOn(jobRunRepo, 'save').mockResolvedValue(jobRun as any);
      jest.spyOn(jobConfigRepo, 'update').mockResolvedValue({} as any);
      jest.spyOn(redisService, 'getClient').mockResolvedValue({
        exists: jest.fn(),
        xGroupCreate: jest.fn().mockImplementation(() => Promise.resolve()),
        set: jest.fn().mockResolvedValue('OK'),
        xAdd: jest.fn().mockImplementation(() => Promise.resolve()),
      } as any);
      jest.spyOn(service, 'initiateWorkflow').mockResolvedValue(undefined);
      jest.spyOn(jobRunRepo, 'update').mockResolvedValue(undefined);
      const result = await service.createJobRun(jobConfigId, currentTime);
      expect(service.getJobConfig).toHaveBeenCalledWith(jobConfigId);
    });
  });

  describe('getJobConfigSpeedTest', () => {
    it('should return the job configuration for speed test', async () => {
      const excludeOlderThan = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const jobConfigId = 'jobConfigId';
      const mockJobConfig = {
        id: jobConfigId,
        preserveAccessTime: true,
        preservePermissions: true,
        excludeFilePatterns: '*.txt',
        excludeOlderThan: excludeOlderThan, // 30 days ago
        sourcePath: {
          volumePath: '/path/to/source',
          id: 'sourcePathId',
          fileServer: {
            protocol: 'NFS',
            userName: 'username',
            password: 'password',
            host: 'localhost',
          },
        },
        speedTestConfigs: [
          {
            workerEntities: [
              { workersId: 'worker1' },
              { workersId: 'worker2' },
            ],
          },
        ],
        jobType: JobType.SPEED_TEST,
      };

      const expectedJobRunConfig: JobRunConfig = {
        id: 'jobConfigId',
        preserveAccessTime: true,
        preservePermissions: true,
        excludeFilePatterns: '*.txt',
        excludeOlderThan: excludeOlderThan, // 30 days ago
        connection: {
          sourceCredential: {
            path: '/path/to/source',
            pathId: 'sourcePathId',
            protocol: Protocol.NFS,
            username: 'username',
            password: 'password',
            host: 'localhost',
            workingDirectory: undefined,
            protocolVersion: '',
            isValidPath: undefined,
            isDisabled: undefined,
          },
        },
        workers: ['worker1', 'worker2'],
        jobType: JobType.SPEED_TEST,
      };

      jest
        .spyOn(jobConfigRepo, 'findOne')
        .mockResolvedValue(mockJobConfig as any);

      const result = await service.getJobConfigSpeedTest(jobConfigId);

      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobConfigId },
        relations: {
          speedTestConfigs: {
            workerEntities: true,
          },
        },
      });
      expect(result).toEqual(expectedJobRunConfig);
    });

    it('should return default values if jobConfig is not found', async () => {
      const jobConfigId = 'nonExistentJobConfigId';

      jest
        .spyOn(jobConfigRepo, 'findOne')
        .mockResolvedValue({ id: '123' } as any);

      const result = await service.getJobConfigSpeedTest(jobConfigId);

      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobConfigId },
        relations: {
          speedTestConfigs: {
            workerEntities: true,
          },
        },
      });
      expect(result).toEqual({
        id: '123',
        preserveAccessTime: undefined,
        excludeFilePatterns: undefined,
        excludeOlderThan: undefined,
        connection: {
          sourceCredential: {
            path: undefined,
            pathId: undefined,
            protocol: undefined,
            username: undefined,
            password: undefined,
            host: undefined,
            workingDirectory: undefined, // Assuming `mountBasePath` is defined in the service
            protocolVersion: '',
          },
        },
        workers: [],
        jobType: undefined,
      });
    });
  });

  describe('getFileServerDetails', () => {
    it('should return the merged results of speed test job config and file servers', async () => {
      const jobRunId = 'jobRunId';
      const jobRun = {};
      const speedTestJobConfig = [];
      const fileServers = [];
      const mergedResults = [];

      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(jobRun as any);
      jest
        .spyOn(speedTestConfigRepo, 'find')
        .mockResolvedValue(speedTestJobConfig);
      jest.spyOn(fileServerRepo, 'find').mockResolvedValue(fileServers);

      const result = await service.getFileServerDetails(jobRunId);

      expect(result).toEqual(mergedResults);
      expect(jobRunRepo.findOne).toHaveBeenCalled();
      expect(speedTestConfigRepo.find).toHaveBeenCalled();
      expect(fileServerRepo.find).toHaveBeenCalled();
    });

    it('should throw an error if jobRun is not found', async () => {
      const jobRunId = 'jobRunId';

      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(null);

      const speedTestConfigFindSpy = jest.spyOn(speedTestConfigRepo, 'find');
      const fileServerFindSpy = jest.spyOn(fileServerRepo, 'find');

      await expect(service.getFileServerDetails(jobRunId)).rejects.toThrow(
        `JobRun with id ${jobRunId} not found`,
      );

      expect(jobRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobRunId },
        relations: ['jobConfig'],
      });

      expect(speedTestConfigFindSpy).not.toHaveBeenCalled();
      expect(fileServerFindSpy).not.toHaveBeenCalled();
    });
  });

  describe('initiateWorkflow', () => {
    const jobRunId = 'jobRunId';
    const mockWorkflowHandle = { workflowId: 'workflowId' };

    beforeEach(() => {
      jest
        .spyOn(workFlowService, 'startWorkflow')
        .mockResolvedValue(mockWorkflowHandle as any);
      jest.spyOn(jobRunRepo, 'update').mockResolvedValue(undefined);
      jest.spyOn(service, 'startStreamConsumer').mockResolvedValue(undefined);
      jest.spyOn(service, 'getFileServerDetails').mockResolvedValue({});
    });

    it('should start CUT_OVER workflow, update jobConfigRepo, and update jobRunRepo', async () => {
      const jobRunConfig = {
        jobType: JobType.CUT_OVER,
        connection: {
          sourceCredential: { pathId: 'sourcePathId' },
          targetCredential: { pathId: 'targetPathId' },
        },
      };

      await service.initiateWorkflow(jobRunId, jobRunConfig as any);

      expect(workFlowService.startWorkflow).toHaveBeenCalledWith(
        WorkFlows.CUT_OVER,
        expect.objectContaining({
          workflowId: `${WorkFlows.CUT_OVER}-${jobRunId}`,
          taskQueue: 'ParentWorkflow-TaskQueue',
          args: [
            expect.objectContaining({
              traceId: jobRunId,
              payload: jobRunConfig,
            }),
          ],
        }),
      );
      expect(jobConfigRepo.update).toHaveBeenCalledWith(
        {
          sourcePathId: 'sourcePathId',
          targetPathId: 'targetPathId',
          jobType: JobType.MIGRATE,
        },
        { status: JS.InActive },
      );
      expect(service.startStreamConsumer).toHaveBeenCalledWith(
        jobRunId,
        undefined,
      );
    });

    it('should start MIGRATE workflow (default case) and update jobRunRepo', async () => {
      const jobRunConfig = {
        jobType: JobType.MIGRATE,
        connection: {},
      };

      await service.initiateWorkflow(jobRunId, jobRunConfig as any);

      expect(workFlowService.startWorkflow).toHaveBeenCalledWith(
        WorkFlows.MIGRATE,
        expect.objectContaining({
          workflowId: `${WorkFlows.MIGRATE}-${jobRunId}`,
          taskQueue: 'ParentWorkflow-TaskQueue',
          args: [
            expect.objectContaining({
              traceId: jobRunId,
              payload: jobRunConfig,
            }),
          ],
        }),
      );
      expect(service.startStreamConsumer).toHaveBeenCalledWith(
        jobRunId,
        undefined,
      );
    });
  });
  describe('buildJobContext', () => {
    it('should build the job context and store it in Redis', async () => {
      const jobRunId = 'jobRunId';
      const jobRunConfig = {
        jobType: JobType.DISCOVER,
        workers: [],
        connection: {
          sourceCredential: {
            workingDirectory: 'workingDirectory',
            pathId: 'pathId',
          },
          targetCredential: {
            workingDirectory: 'workingDirectory',
            pathId: 'pathId',
          },
        },
      };

      jest.spyOn(redisService, 'getClient').mockResolvedValue(undefined);
      jest.spyOn(redisService, 'setJobContext').mockResolvedValue(undefined);
      jest
        .spyOn(redisService, 'getClient')
        .mockResolvedValue({ exists: jest.fn() } as any);
      jest.spyOn(redisService, 'getClient').mockResolvedValue({
        exists: jest.fn(),
        xGroupCreate: jest.fn().mockImplementation(() => Promise.resolve()),
        set: jest.fn().mockResolvedValue('OK'),
        xAdd: jest.fn().mockImplementation(() => Promise.resolve()),
      } as any);
      await service.buildJobContext(jobRunId, jobRunConfig as any);
      expect(redisService.getClient).toHaveBeenCalled();
      expect(redisService.setJobContext).toHaveBeenCalled();
    });

    it('should handle cases where no identity mappings are found for MIGRATE job type', async () => {
      const jobRunId = 'jobRunId';
      const jobRunConfig = {
        jobType: JobType.MIGRATE,
        workers: [],
        connection: {
          sourceCredential: {
            protocol: Protocol.NFS,
            host: 'sourceHost',
            username: 'sourceUser',
            password: 'sourcePass',
            pathId: 'sourcePathId',
            path: '/source/path',
            workingDirectory: '/source/workingDir',
            protocolVersion: 'v3',
          },
          targetCredential: {
            protocol: Protocol.SMB,
            host: 'targetHost',
            username: 'targetUser',
            password: 'targetPass',
            pathId: 'targetPathId',
            path: '/target/path',
            workingDirectory: '/target/workingDir',
            protocolVersion: 'v2',
          },
        },
      };

      const mockJobConfigId = { jobConfigId: 'jobConfigId' };

      const redisClientMock = {
        isOpen: false,
        connect: jest.fn(),
        exists: jest.fn().mockResolvedValue(true),
        hSet: jest.fn(),
        del: jest.fn(),
        xGroupCreate: jest.fn(),
        set: jest.fn(),
        xAdd: jest.fn(),
        catch: jest.fn(), // Mock `catch` to avoid undefined errors
      };

      jest
        .spyOn(redisService, 'getClient')
        .mockResolvedValue(redisClientMock as any);
      jest
        .spyOn(jobRunRepo, 'findOne')
        .mockResolvedValue(mockJobConfigId as any);
      jest.spyOn(identityConfigCrossMappingRepo, 'find').mockResolvedValue([]);
      jest.spyOn(identityMappingRepo, 'findBy').mockResolvedValue([]);
      jest.spyOn(redisService, 'getClient').mockResolvedValue(undefined);
      jest.spyOn(redisService, 'setJobContext').mockResolvedValue(undefined);
      jest
        .spyOn(redisService, 'getClient')
        .mockResolvedValue({ exists: jest.fn() } as any);
      jest.spyOn(redisService, 'getClient').mockResolvedValue({
        exists: jest.fn(),
        xGroupCreate: jest.fn().mockImplementation(() => Promise.resolve()),
        set: jest.fn().mockResolvedValue('OK'),
        xAdd: jest.fn().mockImplementation(() => Promise.resolve()),
      } as any);
      await service.buildJobContext(jobRunId, jobRunConfig as any);
      await service.buildJobContext(jobRunId, jobRunConfig as any);
      // expect(identityMappingRepo.findBy).toHaveBeenCalledWith({
      //   identityMap: [],
      // });
      expect(redisClientMock.hSet).not.toHaveBeenCalled();
      expect(redisService.setJobContext).toHaveBeenCalled();
    });

    it('should include shouldScanADS in job context options for Discovery job', async () => {
      const jobRunId = 'jobRunId';
      const jobRunConfig = {
        jobType: JobType.DISCOVER,
        workers: ['worker1'],
        preserveAccessTime: true,
        shouldScanADS: true,
        excludeFilePatterns: '*.tmp',
        excludeOlderThan: new Date('2025-01-01'),
        skipFile: null,
        connection: {
          sourceCredential: {
            protocol: Protocol.SMB,
            host: 'server',
            username: 'user',
            password: 'pass',
            pathId: 'pathId',
            path: '\\\\server\\share',
            workingDirectory: '/mnt',
            protocolVersion: '3',
          },
        },
      };

      const mockJobContext = {
        jobConfig: {
          options: {
            shouldScanADS: true,
            preserveAccessTime: true,
          },
        },
      };

      const mockRedisProvider = {
        buildContext: jest.fn().mockResolvedValue(mockJobContext),
      };

      const redisClientMock = {
        isOpen: true,
        exists: jest.fn().mockResolvedValue(false),
        xGroupCreate: jest.fn(),
        set: jest.fn(),
        xAdd: jest.fn(),
      };

      jest
        .spyOn(redisService, 'getClient')
        .mockResolvedValue(redisClientMock as any);
      jest
        .spyOn(JobContextFactory, 'getJobManagerProvider')
        .mockReturnValue(mockRedisProvider as any);
      jest.spyOn(redisService, 'setJobContext').mockResolvedValue(undefined);

      await service.buildJobContext(jobRunId, jobRunConfig as any);

      expect(redisService.setJobContext).toHaveBeenCalledWith(
        jobRunId,
        expect.objectContaining({
          jobConfig: expect.objectContaining({
            options: expect.objectContaining({
              shouldScanADS: true,
              preserveAccessTime: true,
            }),
          }),
        }),
      );
    });

    it('should set shouldScanADS to false when not provided in job run config', async () => {
      const jobRunId = 'jobRunId';
      const jobRunConfig = {
        jobType: JobType.DISCOVER,
        workers: [],
        preserveAccessTime: false,
        // shouldScanADS is not set
        connection: {
          sourceCredential: {
            protocol: Protocol.NFS,
            host: 'host',
            username: 'user',
            password: 'pass',
            pathId: 'pathId',
            path: '/nfs/share',
            workingDirectory: '/mnt',
            protocolVersion: '4',
          },
        },
      };

      const mockJobContext = {
        jobConfig: {
          options: {
            shouldScanADS: false,
          },
        },
      };

      const mockRedisProvider = {
        buildContext: jest.fn().mockResolvedValue(mockJobContext),
      };

      const redisClientMock = {
        isOpen: true,
        exists: jest.fn().mockResolvedValue(false),
        xGroupCreate: jest.fn(),
        set: jest.fn(),
        xAdd: jest.fn(),
      };

      jest
        .spyOn(redisService, 'getClient')
        .mockResolvedValue(redisClientMock as any);
      jest
        .spyOn(JobContextFactory, 'getJobManagerProvider')
        .mockReturnValue(mockRedisProvider as any);
      jest.spyOn(redisService, 'setJobContext').mockResolvedValue(undefined);

      await service.buildJobContext(jobRunId, jobRunConfig as any);

      expect(redisService.setJobContext).toHaveBeenCalledWith(
        jobRunId,
        expect.objectContaining({
          jobConfig: expect.objectContaining({
            options: expect.objectContaining({
              shouldScanADS: false,
            }),
          }),
        }),
      );
    });
  });

  describe('buildSpeedTestJobContext', () => {
    it('should build the job context for speed test job', async () => {
      const jobRunId = 'jobRunId';
      const jobRunConfig: JobRunConfig = {
        id: 'jobRunConfigId',
        jobType: JobType.SPEED_TEST,
        workers: ['worker1', 'worker2'],
        excludeFilePatterns: '*.txt',
        preserveAccessTime: true,
        preservePermissions: true,
        excludeOlderThan: new Date(),
        connection: {
          sourceCredential: {
            path: '/path/to/source',
            pathId: 'sourcePathId',
            protocol: Protocol.NFS,
            username: 'username',
            password: 'password',
            host: 'localhost',
            workingDirectory: '/mount/base/path',
            protocolVersion: 'v3',
            isValidPath: true,
            isDisabled: false,
          },
        },
      };

      const jobRun = { id: jobRunId, jobConfig: {} };
      const jobState = new JobState([], 0, 1, [], JobStatus.Pending, []);

      const mockRedisClient = {};
      const mockRedisProvider = {
        buildContext: jest.fn().mockResolvedValue({
          jobConfigId: 'jobConfigId',
          jobType: JobType.SPEED_TEST,
          jobState,
          options: {
            excludeFilePatterns: ['*.txt'],
            sourceWorkingDir: '/mount/base/path',
            targetWorkingDir: '/mount/base/path',
            preserveAccessTime: true,
            excludeOlderThan: 30,
          },
          workerMap: [
            { workerId: 'worker1', workerJobRunMapId: 'workerJobRunMapId1' },
            { workerId: 'worker2', workerJobRunMapId: 'workerJobRunMapId2' },
          ],
        }),
      } as unknown as SpeedTestJobContextProvider;

      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(jobRun as any);
      jest
        .spyOn(redisService, 'getClient')
        .mockResolvedValue(mockRedisClient as any);
      jest
        .spyOn(JobContextFactory, 'getSpeedTestProvider')
        .mockReturnValue(mockRedisProvider);
      jest.spyOn(redisService, 'setJobContext').mockResolvedValue(undefined);

      await service.buildSpeedTestJobContext(jobRunId, jobRunConfig);

      expect(jobRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobRunId },
        relations: ['jobConfig'],
      });
      expect(mockRedisProvider.buildContext).toHaveBeenCalledWith(
        jobRunId,
        expect.any(SpeedTestJobConfig),
        JobRunStatus.Ready,
        jobState,
      );
      expect(redisService.setJobContext).toHaveBeenCalledWith(
        jobRunId,
        expect.objectContaining({
          jobConfigId: 'jobConfigId',
          jobType: JobType.SPEED_TEST,
          jobState,
          options: expect.objectContaining({
            excludeFilePatterns: ['*.txt'],
            sourceWorkingDir: '/mount/base/path',
            targetWorkingDir: '/mount/base/path',
            preserveAccessTime: true,
            excludeOlderThan: 30,
          }),
          workerMap: [
            { workerId: 'worker1', workerJobRunMapId: 'workerJobRunMapId1' },
            { workerId: 'worker2', workerJobRunMapId: 'workerJobRunMapId2' },
          ],
        }),
      );
    });

    it('should throw an error if jobRun is not found', async () => {
      const jobRunId = 'invalidJobRunId';
      const jobRunConfig: JobRunConfig = {
        id: 'jobRunConfigId',
        jobType: JobType.SPEED_TEST,
        workers: [],
        excludeFilePatterns: '',
        preserveAccessTime: false,
        preservePermissions: true,
        excludeOlderThan: new Date(),
        connection: {
          sourceCredential: {
            path: '',
            pathId: '',
            protocol: Protocol.NFS,
            username: '',
            password: '',
            host: '',
            workingDirectory: '',
            protocolVersion: '',
            isValidPath: false,
            isDisabled: false,
          },
        },
      };

      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(null);

      await expect(
        service.buildSpeedTestJobContext(jobRunId, jobRunConfig),
      ).rejects.toThrow(`JobRun with id ${jobRunId} not found`);

      expect(jobRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobRunId },
        relations: ['jobConfig'],
      });
    });
  });
  describe('startStreamConsumer', () => {
    const jobRunId = 'jobRunId';
    const START_CONSUMER_URL = 'http://mock-start-consumer-url';

    beforeEach(() => {
      jest.clearAllMocks();
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'app.paths.startConsumer') {
          return START_CONSUMER_URL;
        }
        return null;
      });
    });

    it('should start the consumer successfully on the first attempt', async () => {
      const mockResponse = {
        status: 200,
        data: { message: 'Consumer started' },
      };
      jest.spyOn(axios, 'post').mockResolvedValueOnce(mockResponse);

      const result = await service.startStreamConsumer(jobRunId);

      expect(axios.post).toHaveBeenCalledWith(
        `${START_CONSUMER_URL}/api/v1/redis-consumer/start`,
        { jobRunId },
        { headers: { projectId: undefined, trackId: jobRunId } },
      );
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: false, message: 'Consumer started' });
    }, 10000);

    it('should handle api-handler-lib response format', async () => {
      const mockApiHandlerResponse = {
        status: 200,
        data: {
          statusCode: 200,
          message: 'Consumer started successfully.',
          data: {
            items: {
              success: true,
              message: 'Consumer started successfully.',
            },
          },
          timestamp: '2025-08-04T10:00:00.000Z',
          path: '/api/v1/redis-consumer/start',
          method: 'POST',
        },
      };
      jest.spyOn(axios, 'post').mockResolvedValueOnce(mockApiHandlerResponse);

      const result = await service.startStreamConsumer(jobRunId);

      expect(axios.post).toHaveBeenCalledWith(
        `${START_CONSUMER_URL}/api/v1/redis-consumer/start`,
        { jobRunId },
        { headers: { projectId: undefined, trackId: jobRunId } },
      );
      expect(result).toEqual({
        success: true,
        message: 'Consumer started successfully.',
      });
    }, 10000);

    it('should handle unexpected errors gracefully', async () => {
      const mockError = new Error('Unexpected error');
      jest.spyOn(axios, 'post').mockRejectedValue(mockError);

      await expect(service.startStreamConsumer(jobRunId)).rejects.toThrow(
        `Failed to start consumer for ${jobRunId}: Unexpected error`,
      );

      expect(axios.post).toHaveBeenCalledWith(
        `${START_CONSUMER_URL}/api/v1/redis-consumer/start`,
        { jobRunId },
        { headers: { projectId: undefined, trackId: jobRunId } },
      );
      // When there's a network error, only 1 call is made before going to catch block
      expect(axios.post).toHaveBeenCalledTimes(1);
    }, 10000);

    it('should retry on non-200 status codes and eventually fail', async () => {
      const mockResponse = {
        status: 500,
        data: { error: 'Internal Server Error' },
      };
      jest.spyOn(axios, 'post').mockResolvedValue(mockResponse);

      await expect(service.startStreamConsumer(jobRunId)).rejects.toThrow(
        'Failed to start consumer after retries. Status: 500',
      );

      expect(axios.post).toHaveBeenCalledWith(
        `${START_CONSUMER_URL}/api/v1/redis-consumer/start`,
        { jobRunId },
        { headers: { projectId: undefined, trackId: jobRunId } },
      );
      // Initial call + 3 retries = 4 total calls
      expect(axios.post).toHaveBeenCalledTimes(4);
    }, 20000);
  });

  describe('buildJobContext', () => {
    describe('createJobRun', () => {
      it('should throw NotFoundException if source or target path is invalid', async () => {
        const jobConfigId = 'jobConfigId';
        const currentTime = new Date();
        const details = {
          jobType: JobType.DISCOVER,
          workers: ['worker1'],
          connection: {
            sourceCredential: { isValidPath: false },
            targetCredential: { isValidPath: false },
          },
        } as any;

        jest.spyOn(service, 'getJobConfig').mockResolvedValue(details);
        const loggerWarnSpy = jest
          .spyOn(service['logger'], 'warn')
          .mockImplementation(() => {});

        await expect(
          service.createJobRun(jobConfigId, currentTime),
        ).rejects.toThrow(
          `Job Config ${jobConfigId} has invalid source or target path, skipping job run creation.`,
        );
      });

      it('should throw NotFoundException if source path is disabled', async () => {
        const jobConfigId = 'jobConfigId';
        const currentTime = new Date();
        const details = {
          jobType: JobType.DISCOVER,
          workers: ['worker1'],
          connection: {
            sourceCredential: { isValidPath: true, isDisabled: true },
            targetCredential: { isValidPath: true, isDisabled: false },
          },
        } as any;

        jest.spyOn(service, 'getJobConfig').mockResolvedValue(details);
        jest.spyOn(jobConfigRepo, 'update').mockResolvedValue({} as any);

        await expect(
          service.createJobRun(jobConfigId, currentTime),
        ).rejects.toThrow(
          `Job Config ${jobConfigId} has invalid source or target path, skipping job run creation.`,
        );

        expect(jobConfigRepo.update).toHaveBeenCalledWith(
          { id: jobConfigId },
          { scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED },
        );
      });

      it('should throw NotFoundException if target path is disabled', async () => {
        const jobConfigId = 'jobConfigId';
        const currentTime = new Date();
        const details = {
          jobType: JobType.DISCOVER,
          workers: ['worker1'],
          connection: {
            sourceCredential: { isValidPath: true, isDisabled: false },
            targetCredential: { isValidPath: true, isDisabled: true },
          },
        } as any;

        jest.spyOn(service, 'getJobConfig').mockResolvedValue(details);
        jest.spyOn(jobConfigRepo, 'update').mockResolvedValue({} as any);

        await expect(
          service.createJobRun(jobConfigId, currentTime),
        ).rejects.toThrow(
          `Job Config ${jobConfigId} has invalid source or target path, skipping job run creation.`,
        );

        expect(jobConfigRepo.update).toHaveBeenCalledWith(
          { id: jobConfigId },
          { scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED },
        );
      });

      it('should return undefined if no workers are present', async () => {
        const jobConfigId = 'jobConfigId';
        const currentTime = new Date();
        const details = {
          jobType: JobType.DISCOVER,
          workers: [],
          connection: {
            sourceCredential: { isValidPath: true },
            targetCredential: { isValidPath: true },
          },
        } as any;

        jest.spyOn(service, 'getJobConfig').mockResolvedValue(details);
        const loggerWarnSpy = jest
          .spyOn(service['logger'], 'warn')
          .mockImplementation(() => {});

        const result = await service.createJobRun(jobConfigId, currentTime);
        expect(result).toBeUndefined();
        expect(loggerWarnSpy).toHaveBeenCalledWith(
          `Unable to create Job Run for Job Config ${jobConfigId} does not has workers`,
        );
      });
    });

    describe('getJobConfig', () => {
      it('should call getJobConfigSpeedTest if jobType is SPEED_TEST', async () => {
        const jobConfigId = 'jobConfigId';
        const jobConfig = { jobType: JobType.SPEED_TEST } as any;
        jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(jobConfig);
        const getJobConfigSpeedTestSpy = jest
          .spyOn(service, 'getJobConfigSpeedTest')
          .mockResolvedValue({} as any);

        await service.getJobConfig(jobConfigId);
        expect(getJobConfigSpeedTestSpy).toHaveBeenCalledWith(jobConfigId);
      });

      it('should handle undefined protocolVersion correctly', async () => {
        const jobConfigId = 'jobConfigId';
        const healthStatsTimeout = 60;
        const sourceDirectoryPath = '/source/directory';
        const mockJobConfig = {
          id: jobConfigId,
          jobType: JobType.DISCOVER,
          preserveAccessTime: true,
          excludeFilePatterns: '*.tmp',
          excludeOlderThan: new Date(),
          sourceDirectoryPath,
          sourcePath: {
            id: 'sourcePathId',
            volumePath: '/source/path',
            fileServer: {
              protocol: Protocol.NFS,
              userName: 'user',
              password: 'pass',
              host: 'host',
              config: { configName: 'sourceConfig' },
              // protocolVersion is intentionally undefined
              workers: [
                {
                  workerId: 'worker1',
                  stats: {
                    healthStatus: 'Healthy',
                    updatedAt: new Date(),
                  },
                },
              ],
            },
          },
          targetPath: null,
        };

        jest
          .spyOn(configService, 'get')
          .mockReturnValue(healthStatsTimeout.toString());
        jest
          .spyOn(jobConfigRepo, 'findOne')
          .mockResolvedValue(mockJobConfig as any);

        const result = await service.getJobConfig(jobConfigId);

        expect(result).toBeDefined();
        expect(result.connection.sourceCredential).toBeDefined();
        expect(result.connection.sourceCredential.directoryPath).toBe(
          sourceDirectoryPath,
        );
        // Should not throw an error when protocolVersion is undefined
        expect(result.connection.sourceCredential.protocolVersion).toBe(
          undefined,
        );
      });

      it('should handle null sourcePath correctly', async () => {
        const jobConfigId = 'jobConfigId';
        const healthStatsTimeout = 60;
        const mockJobConfig = {
          id: jobConfigId,
          jobType: JobType.DISCOVER,
          preserveAccessTime: true,
          excludeFilePatterns: '*.tmp',
          excludeOlderThan: new Date(),
          sourcePath: null, // sourcePath is intentionally null
          targetPath: null,
        };

        jest
          .spyOn(configService, 'get')
          .mockReturnValue(healthStatsTimeout.toString());
        jest
          .spyOn(jobConfigRepo, 'findOne')
          .mockResolvedValue(mockJobConfig as any);

        const result = await service.getJobConfig(jobConfigId);

        expect(result).toBeDefined();
        expect(result.connection.sourceCredential).toBeDefined();
        // Should handle null sourcePath gracefully
        expect(result.workers).toEqual([]);
      });

      it('should handle null fileServer correctly', async () => {
        const jobConfigId = 'jobConfigId';
        const healthStatsTimeout = 60;
        const mockJobConfig = {
          id: jobConfigId,
          jobType: JobType.DISCOVER,
          preserveAccessTime: true,
          excludeFilePatterns: '*.tmp',
          excludeOlderThan: new Date(),
          sourcePath: {
            id: 'sourcePathId',
            volumePath: '/source/path',
            fileServer: null, // fileServer is intentionally null
          },
          targetPath: null,
        };

        jest
          .spyOn(configService, 'get')
          .mockReturnValue(healthStatsTimeout.toString());
        jest
          .spyOn(jobConfigRepo, 'findOne')
          .mockResolvedValue(mockJobConfig as any);

        const result = await service.getJobConfig(jobConfigId);

        expect(result).toBeDefined();
        expect(result.connection.sourceCredential).toBeDefined();
        // Should handle null fileServer gracefully
        expect(result.workers).toEqual([]);
      });

      it('should return empty workers array when there are no common workers between source and target', async () => {
        const jobConfigId = 'jobConfigId';
        const healthStatsTimeout = 60;
        const sourceDirectoryPath = '/migrate/source/dir';
        const targetDirectoryPath = '/migrate/target/dir';
        const mockJobConfig = {
          id: jobConfigId,
          jobType: JobType.MIGRATE,
          preserveAccessTime: true,
          excludeFilePatterns: '*.tmp',
          excludeOlderThan: new Date(),
          targetPathId: 'targetPathId',
          sourceDirectoryPath,
          targetDirectoryPath,
          sourcePath: {
            id: 'sourcePathId',
            volumePath: '/source/path',
            fileServer: {
              protocol: Protocol.NFS,
              userName: 'user',
              password: 'pass',
              host: 'host',
              config: { configName: 'sourceConfig' },
              workers: [
                {
                  workerId: 'worker1',
                  stats: {
                    healthStatus: 'Healthy',
                    updatedAt: new Date(),
                  },
                },
              ],
            },
          },
          targetPath: {
            id: 'targetPathId',
            volumePath: '/target/path',
            fileServer: {
              protocol: Protocol.NFS,
              userName: 'user',
              password: 'pass',
              host: 'host',
              config: { configName: 'targetConfig' },
              workers: [
                {
                  workerId: 'worker2', // Different worker ID than source
                  stats: {
                    healthStatus: 'Healthy',
                    updatedAt: new Date(),
                  },
                },
              ],
            },
          },
        };

        jest
          .spyOn(configService, 'get')
          .mockReturnValue(healthStatsTimeout.toString());
        jest
          .spyOn(jobConfigRepo, 'findOne')
          .mockResolvedValue(mockJobConfig as any);

        const result = await service.getJobConfig(jobConfigId);

        expect(result).toBeDefined();
        // Should have empty workers array when there are no common workers
        expect(result.workers).toEqual([]);
      });

      it('should filter out unhealthy workers', async () => {
        const jobConfigId = 'jobConfigId';
        const healthStatsTimeout = 60;
        const sourceDirectoryPath = '/discover/source/dir';
        const mockJobConfig = {
          id: jobConfigId,
          jobType: JobType.DISCOVER,
          preserveAccessTime: true,
          excludeFilePatterns: '*.tmp',
          excludeOlderThan: new Date(),
          sourceDirectoryPath,
          sourcePath: {
            id: 'sourcePathId',
            volumePath: '/source/path',
            fileServer: {
              protocol: Protocol.NFS,
              userName: 'user',
              password: 'pass',
              host: 'host',
              config: { configName: 'sourceConfig' },
              workers: [
                {
                  workerId: 'worker1',
                  stats: {
                    healthStatus: 'Healthy',
                    updatedAt: new Date(),
                  },
                },
                {
                  workerId: 'unhealthy-worker', // This worker will be filtered out
                  stats: {
                    healthStatus: 'Unhealthy',
                    updatedAt: new Date(),
                  },
                },
                {
                  workerId: 'outdated-worker', // This worker will be filtered out
                  stats: {
                    healthStatus: 'Healthy',
                    updatedAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour old
                  },
                },
              ],
            },
          },
          targetPath: null,
        };

        jest
          .spyOn(configService, 'get')
          .mockReturnValue(healthStatsTimeout.toString());
        jest
          .spyOn(jobConfigRepo, 'findOne')
          .mockResolvedValue(mockJobConfig as any);

        const result = await service.getJobConfig(jobConfigId);

        expect(result).toBeDefined();
        // Should only include healthy workers
        expect(result.workers).toEqual(['worker1']);
        expect(result.workers).not.toContain('unhealthy-worker');
        expect(result.workers).not.toContain('outdated-worker');
      });

      it('should return job config details for DISCOVER job type', async () => {
        const jobConfigId = 'jobConfigId';
        const healthStatsTimeout = 60;
        const mockJobConfig = {
          id: jobConfigId,
          jobType: JobType.DISCOVER,
          preserveAccessTime: true,
          excludeFilePatterns: '*.tmp',
          excludeOlderThan: new Date(),
          sourcePath: {
            id: 'sourcePathId',
            volumePath: '/source/path',
            fileServer: {
              protocol: Protocol.NFS,
              userName: 'user',
              password: 'pass',
              host: 'host',
              config: { configName: 'sourceConfig' },
              workers: [
                {
                  workerId: 'worker1',
                  stats: {
                    healthStatus: 'Healthy',
                    updatedAt: new Date(),
                  },
                },
              ],
            },
          },
          targetPath: null,
        };

        jest
          .spyOn(configService, 'get')
          .mockReturnValue(healthStatsTimeout.toString());
        jest
          .spyOn(jobConfigRepo, 'findOne')
          .mockResolvedValue(mockJobConfig as any);

        const result = await service.getJobConfig(jobConfigId);

        expect(result).toBeDefined();
        expect(result.jobType).toBe(JobType.DISCOVER);
        expect(result.preserveAccessTime).toBe(true);
        expect(result.excludeFilePatterns).toBe('*.tmp');
        expect(result.workers).toContain('worker1');
        expect(result.connection.sourceCredential).toBeDefined();
        expect(result.connection.sourceCredential.protocol).toBe(Protocol.NFS);
        expect(result.connection.targetCredential).toBeUndefined();
      });

      it('should return job config details for MIGRATE job type', async () => {
        const jobConfigId = 'jobConfigId';
        const healthStatsTimeout = 60;
        const sourceDirectoryPath = '/migrate/source/dir';
        const targetDirectoryPath = '/migrate/target/dir';
        const mockJobConfig = {
          id: jobConfigId,
          jobType: JobType.MIGRATE,
          preserveAccessTime: true,
          excludeFilePatterns: '*.tmp',
          excludeOlderThan: new Date(),
          targetPathId: 'targetPathId',
          sourceDirectoryPath,
          targetDirectoryPath,
          sourcePath: {
            id: 'sourcePathId',
            volumePath: '/source/path',
            fileServer: {
              protocol: Protocol.NFS,
              userName: 'user',
              password: 'pass',
              host: 'host',
              config: { configName: 'sourceConfig' },
              workers: [
                {
                  workerId: 'worker1',
                  stats: {
                    healthStatus: 'Healthy',
                    updatedAt: new Date(),
                  },
                },
              ],
            },
          },
          targetPath: {
            id: 'targetPathId',
            volumePath: '/target/path',
            fileServer: {
              protocol: Protocol.NFS,
              userName: 'user',
              password: 'pass',
              host: 'host',
              config: { configName: 'targetConfig' },
              workers: [
                {
                  workerId: 'worker1',
                  stats: {
                    healthStatus: 'Healthy',
                    updatedAt: new Date(),
                  },
                },
              ],
            },
          },
        };

        jest
          .spyOn(configService, 'get')
          .mockReturnValue(healthStatsTimeout.toString());
        jest
          .spyOn(jobConfigRepo, 'findOne')
          .mockResolvedValue(mockJobConfig as any);

        const result = await service.getJobConfig(jobConfigId);

        expect(result).toBeDefined();
        expect(result.jobType).toBe(JobType.MIGRATE);
        expect(result.preserveAccessTime).toBe(true);
        expect(result.excludeFilePatterns).toBe('*.tmp');
        expect(result.workers).toContain('worker1');
        expect(result.connection.sourceCredential).toBeDefined();
        expect(result.connection.sourceCredential.protocol).toBe(Protocol.NFS);
        expect(result.connection.sourceCredential.directoryPath).toBe(
          sourceDirectoryPath,
        );
        expect(result.connection.targetCredential).toBeDefined();
        expect(result.connection.targetCredential.protocol).toBe(Protocol.NFS);
        expect(result.connection.targetCredential.directoryPath).toBe(
          targetDirectoryPath,
        );
      });

      it('should return job config details for CUT_OVER job type', async () => {
        const jobConfigId = 'jobConfigId';
        const healthStatsTimeout = 60;
        const sourceDirectoryPath = '/cutover/source/dir';
        const targetDirectoryPath = '/cutover/target/dir';
        const mockJobConfig = {
          id: jobConfigId,
          jobType: JobType.CUT_OVER,
          preserveAccessTime: true,
          excludeFilePatterns: '*.tmp',
          excludeOlderThan: new Date(),
          targetPathId: 'targetPathId',
          sourceDirectoryPath,
          targetDirectoryPath,
          sourcePath: {
            id: 'sourcePathId',
            volumePath: '/source/path',
            fileServer: {
              protocol: Protocol.NFS,
              userName: 'user',
              password: 'pass',
              host: 'host',
              config: { configName: 'sourceConfig' },
              workers: [
                {
                  workerId: 'worker1',
                  stats: {
                    healthStatus: 'Healthy',
                    updatedAt: new Date(),
                  },
                },
              ],
            },
          },
          targetPath: {
            id: 'targetPathId',
            volumePath: '/target/path',
            fileServer: {
              protocol: Protocol.NFS,
              userName: 'user',
              password: 'pass',
              host: 'host',
              config: { configName: 'targetConfig' },
              workers: [
                {
                  workerId: 'worker1',
                  stats: {
                    healthStatus: 'Healthy',
                    updatedAt: new Date(),
                  },
                },
              ],
            },
          },
        };

        jest
          .spyOn(configService, 'get')
          .mockReturnValue(healthStatsTimeout.toString());
        jest
          .spyOn(jobConfigRepo, 'findOne')
          .mockResolvedValue(mockJobConfig as any);

        const result = await service.getJobConfig(jobConfigId);

        expect(result).toBeDefined();
        expect(result.jobType).toBe(JobType.CUT_OVER);
        expect(result.preserveAccessTime).toBe(true);
        expect(result.excludeFilePatterns).toBe('*.tmp');
        expect(result.workers).toContain('worker1');
        expect(result.connection.sourceCredential).toBeDefined();
        expect(result.connection.sourceCredential.protocol).toBe(Protocol.NFS);
        expect(result.connection.sourceCredential.directoryPath).toBe(
          sourceDirectoryPath,
        );
        expect(result.connection.targetCredential).toBeDefined();
        expect(result.connection.targetCredential.protocol).toBe(Protocol.NFS);
        expect(result.connection.targetCredential.directoryPath).toBe(
          targetDirectoryPath,
        );
      });

      /**
       * Test suite for shouldScanADS in job config
       *
       * shouldScanADS is an option for Discovery jobs that enables scanning of
       * Alternate Data Streams (Windows/NTFS feature).
       */
      describe('shouldScanADS handling', () => {
        it('should return shouldScanADS as true when enabled in job config', async () => {
          const jobConfigId = 'jobConfigId';
          const healthStatsTimeout = 60;
          const mockJobConfig = {
            id: jobConfigId,
            jobType: JobType.DISCOVER,
            preserveAccessTime: true,
            shouldScanADS: true,
            excludeFilePatterns: '*.tmp',
            excludeOlderThan: new Date(),
            sourcePath: {
              id: 'sourcePathId',
              volumePath: '\\\\server\\share',
              fileServer: {
                protocol: Protocol.SMB,
                userName: 'user',
                password: 'pass',
                host: 'server',
                config: { configName: 'sourceConfig' },
                workers: [
                  {
                    workerId: 'worker1',
                    stats: {
                      healthStatus: 'Healthy',
                      updatedAt: new Date(),
                    },
                  },
                ],
              },
            },
            targetPath: null,
          };

          jest
            .spyOn(configService, 'get')
            .mockReturnValue(healthStatsTimeout.toString());
          jest
            .spyOn(jobConfigRepo, 'findOne')
            .mockResolvedValue(mockJobConfig as any);

          const result = await service.getJobConfig(jobConfigId);

          expect(result).toBeDefined();
          expect(result.shouldScanADS).toBe(true);
          expect(result.jobType).toBe(JobType.DISCOVER);
        });

        it('should return shouldScanADS as false when not set in job config', async () => {
          const jobConfigId = 'jobConfigId';
          const healthStatsTimeout = 60;
          const mockJobConfig = {
            id: jobConfigId,
            jobType: JobType.DISCOVER,
            preserveAccessTime: true,
            // shouldScanADS is not set
            excludeFilePatterns: '*.tmp',
            excludeOlderThan: new Date(),
            sourcePath: {
              id: 'sourcePathId',
              volumePath: '/nfs/share',
              fileServer: {
                protocol: Protocol.NFS,
                userName: 'user',
                password: 'pass',
                host: 'host',
                config: { configName: 'sourceConfig' },
                workers: [
                  {
                    workerId: 'worker1',
                    stats: {
                      healthStatus: 'Healthy',
                      updatedAt: new Date(),
                    },
                  },
                ],
              },
            },
            targetPath: null,
          };

          jest
            .spyOn(configService, 'get')
            .mockReturnValue(healthStatsTimeout.toString());
          jest
            .spyOn(jobConfigRepo, 'findOne')
            .mockResolvedValue(mockJobConfig as any);

          const result = await service.getJobConfig(jobConfigId);

          expect(result).toBeDefined();
          expect(result.shouldScanADS).toBe(false);
        });

        it('should default shouldScanADS to false when undefined in job config', async () => {
          const jobConfigId = 'jobConfigId';
          const healthStatsTimeout = 60;
          const mockJobConfig = {
            id: jobConfigId,
            jobType: JobType.DISCOVER,
            preserveAccessTime: false,
            shouldScanADS: undefined,
            excludeFilePatterns: null,
            excludeOlderThan: null,
            sourcePath: {
              id: 'sourcePathId',
              volumePath: '/path',
              fileServer: {
                protocol: Protocol.NFS,
                userName: 'user',
                password: 'pass',
                host: 'host',
                config: { configName: 'sourceConfig' },
                workers: [],
              },
            },
            targetPath: null,
          };

          jest
            .spyOn(configService, 'get')
            .mockReturnValue(healthStatsTimeout.toString());
          jest
            .spyOn(jobConfigRepo, 'findOne')
            .mockResolvedValue(mockJobConfig as any);

          const result = await service.getJobConfig(jobConfigId);

          expect(result).toBeDefined();
          expect(result.shouldScanADS).toBe(false);
        });
      });
    });

    describe('getFileServerDetails', () => {
      it('should merge file server details correctly', async () => {
        const jobRunId = 'jobRunId';
        const jobRun = { jobConfigId: 'jobConfigId' };
        const speedTestJobConfig = [
          { fileServer: 'fs1', workerEntities: [], jobConfig: {} },
        ];
        const fileServers = [
          {
            id: 'fs1',
            host: 'host',
            userName: 'user',
            password: 'pass',
            protocol: Protocol.NFS,
            config: { configName: 'fsName' },
            volumes: ['vol1'],
            workingDirectory: '/dir',
            workers: [],
          },
        ];

        jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(jobRun as any);
        jest
          .spyOn(speedTestConfigRepo, 'find')
          .mockResolvedValue(speedTestJobConfig as any);
        jest
          .spyOn(fileServerRepo, 'find')
          .mockResolvedValue(fileServers as any);

        const result = await service.getFileServerDetails(jobRunId);
        expect(result[0].fileServerDetails.fileServerId).toBe('fs1');
        expect(result[0].fileServerDetails.fileServerName).toBe('fsName');
      });

      it('should merge file server details with null fileServer', async () => {
        const jobRunId = 'jobRunId';
        const jobRun = { jobConfigId: 'jobConfigId' };
        const speedTestJobConfig = [
          { fileServer: 'fs2', workerEntities: [], jobConfig: {} },
        ];
        const fileServers = [
          {
            id: 'fs1',
            host: 'host',
            userName: 'user',
            password: 'pass',
            protocol: Protocol.NFS,
            config: { configName: 'fsName' },
            volumes: ['vol1'],
            workingDirectory: '/dir',
            workers: [],
          },
        ];

        jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(jobRun as any);
        jest
          .spyOn(speedTestConfigRepo, 'find')
          .mockResolvedValue(speedTestJobConfig as any);
        jest
          .spyOn(fileServerRepo, 'find')
          .mockResolvedValue(fileServers as any);

        const result = await service.getFileServerDetails(jobRunId);
        expect(result[0].fileServerDetails).toBeNull();
      });

      it('should merge file server details with multiple speedTestJobConfig and fileServers', async () => {
        const jobRunId = 'jobRunId';
        const jobRun = { jobConfigId: 'jobConfigId' };
        const speedTestJobConfig = [
          { fileServer: 'fs1', workerEntities: [], jobConfig: {} },
          { fileServer: 'fs2', workerEntities: [], jobConfig: {} },
        ];
        const fileServers = [
          {
            id: 'fs1',
            host: 'host1',
            userName: 'user1',
            password: 'pass1',
            protocol: Protocol.NFS,
            config: { configName: 'fsName1' },
            volumes: ['vol1'],
            workingDirectory: '/dir1',
            workers: [],
          },
          {
            id: 'fs2',
            host: 'host2',
            userName: 'user2',
            password: 'pass2',
            protocol: Protocol.SMB,
            config: { configName: 'fsName2' },
            volumes: ['vol2'],
            workingDirectory: '/dir2',
            workers: [],
          },
        ];

        jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(jobRun as any);
        jest
          .spyOn(speedTestConfigRepo, 'find')
          .mockResolvedValue(speedTestJobConfig as any);
        jest
          .spyOn(fileServerRepo, 'find')
          .mockResolvedValue(fileServers as any);

        const result = (await service.getFileServerDetails(jobRunId)) as Record<
          string,
          any
        >[];

        expect(result.length).toBe(2);
        expect(result[0].fileServerDetails.fileServerId).toBe('fs1');
        expect(result[0].fileServerDetails.fileServerName).toBe('fsName1');
        expect(result[1].fileServerDetails.fileServerId).toBe('fs2');
        expect(result[1].fileServerDetails.fileServerName).toBe('fsName2');
      });
    });
  });
  describe('createJobRun', () => {
    it('should throw NotFoundException if source path is invalid', async () => {
      const jobConfigId = 'jobConfigId';
      const currentTime = new Date();
      const details = {
        connection: {
          sourceCredential: { isValidPath: false, isDisabled: false },
          targetCredential: { isValidPath: true, isDisabled: false },
        },
        workers: ['worker1'],
        jobType: JobType.DISCOVER,
      } as any;

      jest.spyOn(service, 'getJobConfig').mockResolvedValue(details);
      jest
        .spyOn(service['jobConfigRepo'], 'update')
        .mockResolvedValue({} as any);

      await expect(
        service.createJobRun(jobConfigId, currentTime),
      ).rejects.toThrow(NotFoundException);
      expect(service['jobConfigRepo'].update).toHaveBeenCalledWith(
        { id: jobConfigId },
        { scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED },
      );
    });

    it('should throw NotFoundException if target path is invalid', async () => {
      const jobConfigId = 'jobConfigId';
      const currentTime = new Date();
      const details = {
        connection: {
          sourceCredential: { isValidPath: true, isDisabled: false },
          targetCredential: { isValidPath: false, isDisabled: false },
        },
        workers: ['worker1'],
        jobType: JobType.MIGRATE,
      } as any;

      jest.spyOn(service, 'getJobConfig').mockResolvedValue(details);
      jest
        .spyOn(service['jobConfigRepo'], 'update')
        .mockResolvedValue({} as any);

      await expect(
        service.createJobRun(jobConfigId, currentTime),
      ).rejects.toThrow(NotFoundException);
      expect(service['jobConfigRepo'].update).toHaveBeenCalledWith(
        { id: jobConfigId },
        { scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED },
      );
    });

    it('should log warning and return if no workers are present', async () => {
      const jobConfigId = 'jobConfigId';
      const currentTime = new Date();
      const details = {
        connection: {
          sourceCredential: { isValidPath: true, isDisabled: false },
          targetCredential: { isValidPath: true, isDisabled: false },
        },
        workers: [],
        jobType: JobType.DISCOVER,
      } as any;

      jest.spyOn(service, 'getJobConfig').mockResolvedValue(details);
      const loggerWarnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation();

      const result = await service.createJobRun(jobConfigId, currentTime);
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        `Unable to create Job Run for Job Config ${jobConfigId} does not has workers`,
      );
      expect(result).toBeUndefined();
    });

    it('should handle errors and reset scheduler to SCHEDULING', async () => {
      const jobConfigId = 'jobConfigId';
      const currentTime = new Date();
      const details = {
        connection: {
          sourceCredential: { isValidPath: true, isDisabled: false },
          targetCredential: { isValidPath: true, isDisabled: false },
        },
        workers: ['worker1'],
        jobType: JobType.DISCOVER,
      } as any;

      jest.spyOn(service, 'getJobConfig').mockResolvedValue(details);
      jest
        .spyOn(service['workerJobRunMapRepo'], 'create')
        .mockImplementation((worker) => ({ ...worker }) as any);
      jest.spyOn(service['optionRepo'], 'create').mockReturnValue({} as any);
      jest.spyOn(service['jobRunRepo'], 'create').mockReturnValue({} as any);
      jest.spyOn(service, 'buildJobContext').mockImplementation(() => {
        throw new Error('Test error');
      });
      jest
        .spyOn(service['jobConfigRepo'], 'update')
        .mockResolvedValue({} as any);
      const loggerErrorSpy = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation();

      await service.createJobRun(jobConfigId, currentTime);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `Failed to create job run for ${jobConfigId}: Test error`,
        ),
      );
      expect(service['jobConfigRepo'].update).toHaveBeenCalledWith(
        { id: jobConfigId },
        { scheduler: ScheduleStatus.SCHEDULING },
      );
    });

    describe('JobRunInitService integration', () => {
      describe('scheduleAJob', () => {
        it('should skip jobs with migration conflicts', async () => {
          const currentTime = new Date();
          const jobs = [
            { id: 'job1', sourcePathId: 'src1', targetPathId: 'tgt1' },
            { id: 'job2', sourcePathId: 'src2', targetPathId: null },
          ];
          jest
            .spyOn(service['jobConfigRepo'], 'find')
            .mockResolvedValue(jobs as any);
          jest
            .spyOn(
              service['migrationConflictService'],
              'checkMigrationConflicts',
            )
            .mockResolvedValueOnce(['conflict'] as any) // job1 has conflict
            .mockResolvedValueOnce([]); // job2 no conflict
          jest.spyOn(service, 'createJobRun').mockResolvedValue(undefined);

          const result = await service.scheduleAJob();

          expect(result).toEqual([jobs[1]]);
          expect(service.createJobRun).toHaveBeenCalledWith(
            'job2',
            expect.any(Date),
            undefined,
          );
        });
      });

      describe('getJobConfigSpeedTest', () => {
        it('should handle missing speedTestConfigs gracefully', async () => {
          const jobConfigId = 'jobConfigId';
          const jobConfig = {
            id: jobConfigId,
            sourcePath: {},
            speedTestConfigs: undefined,
          };
          jest
            .spyOn(service['jobConfigRepo'], 'findOne')
            .mockResolvedValue(jobConfig as any);

          const result = await service.getJobConfigSpeedTest(jobConfigId);

          expect(result.workers).toEqual([]);
        });
      });

      describe('getJobConfig', () => {
        it('should call getJobConfigSpeedTest for SPEED_TEST jobType', async () => {
          const jobConfigId = 'jobConfigId';
          jest
            .spyOn(service['jobConfigRepo'], 'findOne')
            .mockResolvedValue({ jobType: JobType.SPEED_TEST } as any);
          const spy = jest
            .spyOn(service, 'getJobConfigSpeedTest')
            .mockResolvedValue({} as any);

          await service.getJobConfig(jobConfigId);

          expect(spy).toHaveBeenCalledWith(jobConfigId);
        });

        it('should handle missing workers and fileServer gracefully', async () => {
          const jobConfigId = 'jobConfigId';
          const jobConfig = {
            id: jobConfigId,
            jobType: JobType.DISCOVER,
            sourcePath: { fileServer: null },
          };
          jest
            .spyOn(service['jobConfigRepo'], 'findOne')
            .mockResolvedValue(jobConfig as any);
          jest.spyOn(configService, 'get').mockReturnValue('60');

          const result = await service.getJobConfig(jobConfigId);

          expect(result.workers).toEqual([]);
        });
      });
    });
  });
});
