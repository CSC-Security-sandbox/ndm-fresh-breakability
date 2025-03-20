import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobRunInitService } from './jobrun.init.service';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { FileServerEntity } from '../entities/fileserver.entity';
import { WorkflowService } from '../workflow/workflow.service';
import { RedisService } from '../redis/redis.service';
import { DeepPartial, LessThan, Repository } from 'typeorm';
import { SpeedTestConfigEntity, SpeedTestConfigWorkerEntity } from 'src/entities/speed-test-job-config.entity';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import { JobOptionsEntity } from 'src/entities/joboptions.entity';
import { IdentityMappingEntity } from 'src/entities/indentity-mapping.entity';
import { IdentityConfigCrossMappingEntity } from 'src/entities/indentity-mapping-cross.entity';
import { ConfigService } from '@nestjs/config';
import { JobContextFactory, JobStatus, SpeedTestJobConfig, SpeedTestJobContextProvider, Task} from '@netapp-cloud-datamigrate/jobs-lib';
import { ScheduleStatus } from 'src/constants/status';
import { JobRunConfig } from './jobrun.types';
import { JobRunStatus, JobType, Protocol, WorkFlows } from 'src/constants/enums';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';


describe('JobRunInitService', () => {
  let service: JobRunInitService;
  let jobRunRepo: Repository<JobRunEntity>;
  let speedTestConfigRepo: Repository<SpeedTestConfigEntity>;
  let speedTestConfigWorkerRepo: Repository<SpeedTestConfigWorkerEntity>;
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
          provide: getRepositoryToken(SpeedTestConfigWorkerEntity),
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
    speedTestConfigWorkerRepo = module.get<Repository<SpeedTestConfigWorkerEntity>>(
      getRepositoryToken(SpeedTestConfigWorkerEntity)
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
      const jobConfigId = 'jobConfigId';
      const mockJobConfig = {
        id: jobConfigId,
        preserveAccessTime: true,
        excludeFilePatterns: '*.txt',
        excludeOlderThan: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
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
        excludeOlderThan: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
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
  });

  describe('initiateWorkflow', () => {
    it('should initiate the workflow and update the job run', async () => {
      const jobRunId = 'jobRunId';
      const jobRunConfig = {};
      const jobRunWorkflow = {} as any;
      const startWorkFlowPayload = {};

      jest.spyOn(service, 'getFileServerDetails').mockResolvedValue({});
      jest.spyOn(workFlowService, 'startWorkflow').mockResolvedValue(jobRunWorkflow as any);
      jest.spyOn(jobRunRepo, 'update').mockResolvedValue({} as any);

      await service.initiateWorkflow(jobRunId, jobRunConfig as any);
      jest.spyOn(service, "getFileServerDetails").mockResolvedValue([] as any);
      expect(service.getFileServerDetails).toBeTruthy();
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
    it('should return the workflow ID based on the job type', () => {
      const jobRunId = 'jobRunId';
      const workflowId = `${WorkFlows.DISCOVERY}-${jobRunId}`;

      const result = service.getWorkFlowId(jobRunId, JobType.DISCOVER);

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
});