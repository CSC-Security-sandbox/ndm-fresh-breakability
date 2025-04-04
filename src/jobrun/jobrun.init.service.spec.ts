import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobRunInitService } from './jobrun.init.service';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { FileServerEntity } from '../entities/fileserver.entity';
import { WorkflowService } from '../workflow/workflow.service';
import { RedisService } from '../redis/redis.service';
import { DeepPartial, In, LessThan, Repository } from 'typeorm';
import { SpeedTestConfigEntity } from 'src/entities/speed-test-job-config.entity';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import { JobOptionsEntity } from 'src/entities/joboptions.entity';
import { JobStatus as JS } from 'src/constants/enums';
import { IdentityMappingEntity } from 'src/entities/indentity-mapping.entity';
import { IdentityConfigCrossMappingEntity } from 'src/entities/indentity-mapping-cross.entity';
import { ConfigService } from '@nestjs/config';
import { IdentityTypes, JobContextFactory, JobStatus, SpeedTestJobConfig, SpeedTestJobContextProvider, Task} from '@netapp-cloud-datamigrate/jobs-lib';
import { ScheduleStatus } from 'src/constants/status';
import { JobRunConfig } from './jobrun.types';
import { JobRunStatus, JobType, Protocol, WorkFlows } from 'src/constants/enums';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import axios from 'axios';
import { Readable } from "stream";

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
          useValue:{
            create: jest.fn(),
          }
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
      ],
    }).compile();

    service = module.get<JobRunInitService>(JobRunInitService);
    jobRunRepo = module.get<Repository<JobRunEntity>>(
      getRepositoryToken(JobRunEntity)
    );
    speedTestConfigRepo = module.get<Repository<SpeedTestConfigEntity>>(
      getRepositoryToken(SpeedTestConfigEntity)
    );
    jobConfigRepo = module.get<Repository<JobConfigEntity>>(
      getRepositoryToken(JobConfigEntity)
    );
    fileServerRepo = module.get<Repository<FileServerEntity>>(
      getRepositoryToken(FileServerEntity)
    );
    workerJobRunMapRepo = module.get<Repository<WorkerJobRunMap>>(
      getRepositoryToken(WorkerJobRunMap)
    );
    optionRepo = module.get<Repository<JobOptionsEntity>>(
      getRepositoryToken(JobOptionsEntity)
    );
    identityMappingRepo = module.get<Repository<IdentityMappingEntity>>(
      getRepositoryToken(IdentityMappingEntity)
    );
    identityConfigCrossMappingRepo = module.get<Repository<IdentityConfigCrossMappingEntity>>(
      getRepositoryToken(IdentityConfigCrossMappingEntity)
    );
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
      const currentTime = new Date();
      const jobs: JobConfigEntity[] = [];
      jest.spyOn(jobConfigRepo, 'find').mockResolvedValue(jobs);

      const result = await service.scheduleAJob();

      expect(result).toEqual(jobs);
      expect(jobConfigRepo.find).toHaveBeenCalledWith({
        select: { id: true },
        where: {
          status: 'ACTIVE',
          scheduler: ScheduleStatus.SCHEDULING,
          firstRunAt: LessThan(currentTime),
        },
      });
    });
  });

  describe('createJobRun', () => {
    it('should create a job run and return it', async () => {
      const jobConfigId = 'jobConfigId';
      const currentTime = new Date();
      const details = {} as any;
      details.jobType = JobType.DISCOVER;
      details.workers = [];
      const jobRunRecord = {};
      const jobRun = {};

      jest.spyOn(service, 'getJobConfig').mockResolvedValue(details);
      jest.spyOn(workerJobRunMapRepo, 'create').mockReturnValue({} as any);
      jest.spyOn(optionRepo, 'create').mockReturnValue({} as any);
      jest.spyOn(jobRunRepo, 'create').mockReturnValue(jobRunRecord as any);
      jest.spyOn(jobRunRepo, 'save').mockResolvedValue(jobRun as any);
      jest.spyOn(jobConfigRepo, 'update').mockResolvedValue({} as any);

      const result = await service.createJobRun(jobConfigId, currentTime);

     
      expect(service.getJobConfig).toHaveBeenCalledWith(jobConfigId);
    });
  });


  describe('getJobConfigSpeedTest', () => {
    it('should return the job configuration for speed test', async () => {
      const excludeOlderThan  =  new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const jobConfigId = 'jobConfigId';
      const mockJobConfig = {
        id: jobConfigId,
        preserveAccessTime: true,
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
        preserveAccessTime: true,
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
            workingDirectory: undefined, // Assuming `mountBasePath` is defined in the service
            protocolVersion: '',
          },
        },
        workers: ['worker1', 'worker2'],
        jobType: JobType.SPEED_TEST,
      };
  
      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
  
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
  
      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(null);
  
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
      jest.spyOn(speedTestConfigRepo, 'find').mockResolvedValue(speedTestJobConfig);
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
        `JobRun with id ${jobRunId} not found`
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
    jest.spyOn(workFlowService, 'startWorkflow').mockResolvedValue(mockWorkflowHandle as any);
    jest.spyOn(jobRunRepo, 'update').mockResolvedValue(undefined);
    jest.spyOn(service, 'startStreamConsumer').mockResolvedValue(undefined);
    jest.spyOn(service, 'getFileServerDetails').mockResolvedValue({});
  });

  it('should start DISCOVER workflow and update jobRunRepo', async () => {
    const jobRunConfig = {
      jobType: JobType.DISCOVER,
      connection: {},
    };

    await service.initiateWorkflow(jobRunId, jobRunConfig as any);

    expect(workFlowService.startWorkflow).toHaveBeenCalledWith(
      WorkFlows.DISCOVERY,
      expect.objectContaining({
        workflowId: `${WorkFlows.DISCOVERY}-${jobRunId}`,
        taskQueue: 'ParentWorkflow-TaskQueue',
        args: [
          expect.objectContaining({
            traceId: jobRunId,
            payload: jobRunConfig,
          }),
        ],
      })
    );
    expect(jobRunRepo.update).toHaveBeenCalledWith(
      { id: jobRunId },
      { workFlowId: mockWorkflowHandle.workflowId }
    );
    expect(service.startStreamConsumer).toHaveBeenCalledWith(jobRunId);
  });

  it('should start SPEED_TEST workflow and update jobRunRepo', async () => {
    const jobRunConfig = {
      jobType: JobType.SPEED_TEST,
      connection: {},
    };

    const mockSpeedTestJobConfig = { someKey: 'someValue' };
    jest.spyOn(service, 'getFileServerDetails').mockResolvedValue(mockSpeedTestJobConfig);

    await service.initiateWorkflow(jobRunId, jobRunConfig as any);

    expect(service.getFileServerDetails).toHaveBeenCalledWith(jobRunId);
    expect(workFlowService.startWorkflow).toHaveBeenCalledWith(
      WorkFlows.SPEED_TEST,
      expect.objectContaining({
        workflowId: `${WorkFlows.SPEED_TEST}-${jobRunId}`,
        taskQueue: 'ParentWorkflow-TaskQueue',
        args: [
          expect.objectContaining({
            traceId: jobRunId,
            payload: mockSpeedTestJobConfig,
          }),
        ],
      })
    );
    expect(jobRunRepo.update).toHaveBeenCalledWith(
      { id: jobRunId },
      { workFlowId: mockWorkflowHandle.workflowId }
    );
    expect(service.startStreamConsumer).toHaveBeenCalledWith(jobRunId);
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
      })
    );
    expect(jobConfigRepo.update).toHaveBeenCalledWith(
      {
        sourcePathId: 'sourcePathId',
        targetPathId: 'targetPathId',
        jobType: JobType.MIGRATE,
      },
      { status: JS.InActive }
    );
    expect(jobRunRepo.update).toHaveBeenCalledWith(
      { id: jobRunId },
      { workFlowId: mockWorkflowHandle.workflowId }
    );
    expect(service.startStreamConsumer).toHaveBeenCalledWith(jobRunId);
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
      })
    );
    expect(jobRunRepo.update).toHaveBeenCalledWith(
      { id: jobRunId },
      { workFlowId: mockWorkflowHandle.workflowId }
    );
    expect(service.startStreamConsumer).toHaveBeenCalledWith(jobRunId);
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
      const jobRun = {};

      jest.spyOn(service, 'createInitialTask').mockResolvedValue(undefined);
      jest.spyOn(redisService, 'getClient').mockResolvedValue(undefined);
      jest.spyOn(redisService, 'setJobContext').mockResolvedValue(undefined);
      jest.spyOn(redisService,'getClient').mockResolvedValue({ exists: jest.fn() } as any);
      jest.spyOn(redisService,'getClient').mockResolvedValue({ exists: jest.fn(),
        xGroupCreate: jest.fn().mockImplementation(() => Promise.resolve()),
        set: jest.fn().mockResolvedValue('OK'),xAdd:jest.fn().mockImplementation(()=>Promise.resolve()) } as any); 
      await service.buildJobContext(jobRunId, jobRunConfig as any);
      expect(service.createInitialTask).toHaveBeenCalledWith(jobRunId, jobRunConfig);
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
    
      jest.spyOn(redisService, 'getClient').mockResolvedValue(redisClientMock as any);
      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(mockJobConfigId as any);
      jest.spyOn(identityConfigCrossMappingRepo, 'find').mockResolvedValue([]);
      jest.spyOn(identityMappingRepo, 'findBy').mockResolvedValue([]);
      jest.spyOn(redisService, 'getClient').mockResolvedValue(undefined);
      jest.spyOn(redisService, 'setJobContext').mockResolvedValue(undefined);
      jest.spyOn(redisService,'getClient').mockResolvedValue({ exists: jest.fn() } as any);
      jest.spyOn(redisService,'getClient').mockResolvedValue({ exists: jest.fn(),
        xGroupCreate: jest.fn().mockImplementation(() => Promise.resolve()),
        set: jest.fn().mockResolvedValue('OK'),xAdd:jest.fn().mockImplementation(()=>Promise.resolve()) } as any); 
      await service.buildJobContext(jobRunId, jobRunConfig as any);
      await service.buildJobContext(jobRunId, jobRunConfig as any);
    
      // Assertions
      expect(jobRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobRunId },
        select: { jobConfigId: true },
      });
      expect(identityConfigCrossMappingRepo.find).toHaveBeenCalledWith({
        where: { jobConfigId: mockJobConfigId.jobConfigId, isOrphan:false },
      });
      // expect(identityMappingRepo.findBy).toHaveBeenCalledWith({
      //   identityMap: [],
      // });
      expect(redisClientMock.hSet).not.toHaveBeenCalled();
      expect(redisService.setJobContext).toHaveBeenCalled();
    });
  });

describe('createInitialTask', () => {
    it('should create the initial task', async () => {
        const jobRunId = 'jobRunId';
        const jobRunConfig = {} as any;
        jobRunConfig.workers = [];
        jobRunConfig.connection = {
            sourceCredential: {
                workingDirectory: 'workingDirectory',
                pathId: 'pathId',
            },
            targetCredential: {
                workingDirectory: 'workingDirectory',
                pathId: 'pathId',
            },
        };
        

        const result = await service.createInitialTask(jobRunId, jobRunConfig as any);

        expect(result).toBeTruthy();
    });
});
  describe('getWorkFlowId', () => {
    it('should return the workflow ID based on the job type DISCOVER', () => {
      const jobRunId = 'jobRunId';
      const workflowId = `${WorkFlows.DISCOVERY}-${jobRunId}`;

      const result = service.getWorkFlowId(jobRunId, JobType.DISCOVER);

      expect(result).toEqual(workflowId);
    });
    it('should return the workflow ID based on the job type CUT_OVER', () => {
      const jobRunId = 'jobRunId';
      const workflowId = `${WorkFlows.CUT_OVER}-${jobRunId}`;

      const result = service.getWorkFlowId(jobRunId, JobType.CUT_OVER);

      expect(result).toEqual(workflowId);
    });
    it('should return the workflow ID based on the job type PRECHECK', () => {
      const jobRunId = 'jobRunId';
      const workflowId = `${WorkFlows.PRECHECK}-${jobRunId}`;

      const result = service.getWorkFlowId(jobRunId, JobType.PRECHECK);

      expect(result).toEqual(workflowId);
    });
    it('should return the workflow ID based on the job type MIGRATE', () => {
      const jobRunId = 'jobRunId';
      const workflowId = `${WorkFlows.MIGRATE}-${jobRunId}`;

      const result = service.getWorkFlowId(jobRunId, JobType.MIGRATE);

      expect(result).toEqual(workflowId);
    });
  });

  describe('buildSpeedTestJobContext', () => {
    it('should build the job context for speed test job', async () => {
      const jobRunId = 'jobRunId';
      const jobRunConfig: JobRunConfig = {
        jobType: JobType.SPEED_TEST,
        workers: ['worker1', 'worker2'],
        excludeFilePatterns: '*.txt',
        preserveAccessTime: true,
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
      jest.spyOn(redisService, 'getClient').mockResolvedValue(mockRedisClient as any);
      jest.spyOn(JobContextFactory, 'getSpeedTestProvider').mockReturnValue(mockRedisProvider);
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
        jobState
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
        })
      );
    });
  
    it('should throw an error if jobRun is not found', async () => {
      const jobRunId = 'invalidJobRunId';
      const jobRunConfig: JobRunConfig = {
        jobType: JobType.SPEED_TEST,
        workers: [],
        excludeFilePatterns: '',
        preserveAccessTime: false,
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
          },
        },
      };
  
      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(null);
  
      await expect(service.buildSpeedTestJobContext(jobRunId, jobRunConfig)).rejects.toThrow(
        `JobRun with id ${jobRunId} not found`
      );
  
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
    jest.spyOn(configService, 'get').mockImplementation((key: string) => {
      if (key === 'app.paths.startConsumer') {
        return START_CONSUMER_URL;
      }
      return null;
    });
  });

  it('should start the consumer successfully on the first attempt', async () => {
    const mockResponse = { status: 201, data: { message: 'Consumer started' } };
    jest.spyOn(axios, 'post').mockResolvedValueOnce(mockResponse);

    await service.startStreamConsumer(jobRunId);

    expect(axios.post).toHaveBeenCalledWith(
      `${START_CONSUMER_URL}/api/v1/redis-consumer/start`,
      { jobRunId }
    );
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('should handle unexpected errors gracefully', async () => {
    const mockError = new Error('Unexpected error');
    jest.spyOn(axios, 'post').mockRejectedValue(mockError);

    await expect(service.startStreamConsumer(jobRunId)).rejects.toThrow(
      `Failed to start consumer for ${jobRunId}: Unexpected error`
    );

    expect(axios.post).toHaveBeenCalledWith(
      `${START_CONSUMER_URL}/api/v1/redis-consumer/start`,
      { jobRunId }
    );
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
})


describe("buildJobContext", () => {
  it("should process identity cross mappings and store them in Redis", async () => {
    const jobRunId = "jobRunId";
    const jobRunConfig = {
      jobType: JobType.MIGRATE,
      workers: ["worker1"],
      connection: {
        sourceCredential: {
          protocol: Protocol.NFS,
          host: "sourceHost",
          username: "sourceUser  ",
          password: "sourcePass",
          pathId: "sourcePathId",
          path: "/source/path",
          workingDirectory: "/source/workingDir",
          protocolVersion: "v3",
        },
        targetCredential: {
          protocol: Protocol.SMB,
          host: "targetHost",
          username: "targetUser  ",
          password: "targetPass",
          pathId: "targetPathId",
          path: "/target/path",
          workingDirectory: "/target/workingDir",
          protocolVersion: "v2",
        },
      },
    };

    const jobConfigId = { jobConfigId: "jobConfigId1" };
    jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(jobConfigId as any);

    const identityCrossMappings: IdentityConfigCrossMappingEntity[] = [
      {
        id: "crossMappingId1",
        identityMappingId: "mappingId1",
        jobConfigId: "jobConfigId1",
        jobConfig: {} as any,
        isOrphan: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        identityMapping: new IdentityMappingEntity(),
        createdBy: "",
        updatedBy: "",
      },
      {
        id: "crossMappingId2",
        identityMappingId: "mappingId2",
        jobConfigId: "jobConfigId2",
        jobConfig: {} as any,
        isOrphan: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        identityMapping: new IdentityMappingEntity(),
        createdBy: "",
        updatedBy: "",
      },
    ];

    const identityMappings: IdentityMappingEntity[] = [
      {
        id: "identityMappingId1",
        identityMap: "identityMap1",
        sourceMapping: "source1",
        targetMapping: "target1",
        identityType: "SID",
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: "",
        updatedBy: "",
      },
      {
        id: "identityMappingId2",
        identityMap: "identityMap2",
        sourceMapping: "source2",
        targetMapping: "target2",
        identityType: "GID",
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: "",
        updatedBy: "",
      },
    ];

    const redisClientMock = {
      isOpen: true,
      connect: jest.fn(),
      hSet: jest.fn(),
      exists: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
      xGroupCreate: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue(1),
      xAdd: jest.fn().mockResolvedValue(1),
    };

    jest
      .spyOn(identityConfigCrossMappingRepo, "find")
      .mockResolvedValue(identityCrossMappings);
    jest
      .spyOn(identityMappingRepo, "findBy")
      .mockResolvedValue(identityMappings);
    jest
      .spyOn(redisService, "getClient")
      .mockResolvedValue(redisClientMock as any);

    // Mock the Readable stream to avoid testing it directly
    jest
      .spyOn(Readable.prototype, "on")
      .mockImplementation((event, callback) => {
        if (event === "data") {
          // Simulate the "data" event for each identity mapping
          identityMappings.forEach((mapping) => {
            callback(JSON.stringify(mapping));
          });
        } else if (event === "end") {
          // Simulate the "end" event
          callback();
        }
        return {} as any; // Return a mock object to allow chaining
      });

    await service.buildJobContext(jobRunId, jobRunConfig as any);

    // Ensure hSet was called for each identity mapping
    expect(redisClientMock.hSet).toHaveBeenCalledTimes(identityMappings.length);
    identityMappings.forEach((mapping) => {
      const mapType =
        mapping.identityType.toLowerCase() === "sid"
          ? IdentityTypes.SID
          : IdentityTypes.GID;
      expect(redisClientMock.hSet).toHaveBeenCalledWith(
        `${jobRunId}:mapping`,
        `${mapType}:${mapping.sourceMapping}`,
        mapping.targetMapping
      );
    });
  });
});
});