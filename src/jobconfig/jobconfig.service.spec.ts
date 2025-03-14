import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobConfigService } from './jobconfig.service';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { Repository, In } from 'typeorm';
import { FileServerEntity } from '../entities/fileserver.entity';
import { SpeedTestConfigEntity } from '../entities/speed-test-job-config.entity';
import { SpeedLogEntity } from '../entities/speed-test-result.entity';
import { NetworkPerformanceResultEntity } from '../entities/speed-test-result.entity';
import { SpeedTestResultEntity } from '../entities/speed-test-result.entity';
import { SpeedLogEntryEntity } from '../entities/speed-test-result.entity';
import { SpeedTestConfigWorkerEntity } from '../entities/speed-test-job-config.entity';
import { WorkerEntity } from '../entities/worker.entity';
import { InventoryEntity } from '../entities/inventory.entity';
import { JobRunEntity } from '../entities/jobrun.entity';
import { ProjectEntity } from '../entities/project.entity';
import { VolumeEntity } from '../entities/volume.entity';
import { WorkflowService } from '../workflow/workflow.service';
import { ConfigService } from '@nestjs/config';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { JobType, JobStatus, JobRunStatus, TemplateType } from 'src/constants/enums';
import * as winston from 'winston';
import * as uuid from 'uuid';
import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { ScheduleStatus } from 'src/constants/status';
import { JobConfigDto } from './dto/jobconfig.dto';
import { join } from 'path';
import { existsSync, createReadStream } from 'fs';
import { nextDate } from 'src/utils/mapper';

describe('JobConfigService', () => {
  let service: JobConfigService;
  let jobConfigRepo: Repository<JobConfigEntity>;
  let configService: jest.Mocked<ConfigService>;
  let loggerFactory: jest.Mocked<LoggerFactory>;
  let loggerService: jest.Mocked<LoggerService>;
  let speedTestConfigRepo: Repository<SpeedTestConfigEntity>;
  let fileServerRepo: Repository<FileServerEntity>;
  let speedTestConfigWorkerRepo: Repository<SpeedTestConfigWorkerEntity>;
  let speedLogRepo: Repository<SpeedLogEntity>;
  let speedLogEntryRepo: Repository<SpeedLogEntryEntity>;
  let networkPerformanceResultRepo: Repository<NetworkPerformanceResultEntity>;
  let speedTestResultRepo: Repository<SpeedTestResultEntity>;
  let fileServerEntityRepo: Repository<FileServerEntity>;
  let workerRepo: Repository<WorkerEntity>;
  let jobRunRepo: Repository<JobRunEntity>;
  let inventoryRepo: Repository<InventoryEntity>;
  let volumeRepo: Repository<VolumeEntity>;
  let projectRepo: Repository<ProjectEntity>;

  beforeEach(async () => {
    configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    loggerService = {
      log: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<LoggerService>;

    loggerFactory = {
      create: jest.fn().mockReturnValue(loggerService),
    } as unknown as jest.Mocked<LoggerFactory>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobConfigService,
        WorkflowService,
        { provide: ConfigService, useValue: configService },
        { provide: LoggerFactory, useValue: loggerFactory },
        { provide: LoggerService, useValue: loggerService },
        { provide: 'winston', useValue: winston },
        {
          provide: getRepositoryToken(JobConfigEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(FileServerEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SpeedTestConfigEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SpeedLogEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(NetworkPerformanceResultEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SpeedTestResultEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SpeedLogEntryEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SpeedTestConfigWorkerEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(WorkerEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
            findByIds: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(JobRunEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ProjectEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(VolumeEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<JobConfigService>(JobConfigService);
    jobConfigRepo = module.get<Repository<JobConfigEntity>>(getRepositoryToken(JobConfigEntity));
    speedTestConfigRepo = module.get<Repository<SpeedTestConfigEntity>>(getRepositoryToken(SpeedTestConfigEntity));
    speedTestConfigWorkerRepo = module.get<Repository<SpeedTestConfigWorkerEntity>>(getRepositoryToken(SpeedTestConfigWorkerEntity));
    speedLogRepo = module.get<Repository<SpeedLogEntity>>(getRepositoryToken(SpeedLogEntity));
    speedLogEntryRepo = module.get<Repository<SpeedLogEntryEntity>>(getRepositoryToken(SpeedLogEntryEntity));
    networkPerformanceResultRepo = module.get<Repository<NetworkPerformanceResultEntity>>(getRepositoryToken(NetworkPerformanceResultEntity));
    speedTestResultRepo = module.get<Repository<SpeedTestResultEntity>>(getRepositoryToken(SpeedTestResultEntity));
    fileServerEntityRepo = module.get<Repository<FileServerEntity>>(getRepositoryToken(FileServerEntity));
    fileServerRepo = module.get<Repository<FileServerEntity>>(getRepositoryToken(FileServerEntity));
    workerRepo = module.get<Repository<WorkerEntity>>(getRepositoryToken(WorkerEntity));
    jobRunRepo = module.get<Repository<JobRunEntity>>(getRepositoryToken(JobRunEntity));
    inventoryRepo = module.get<Repository<InventoryEntity>>(getRepositoryToken(InventoryEntity));
    volumeRepo = module.get<Repository<VolumeEntity>>(getRepositoryToken(VolumeEntity));
    projectRepo = module.get<Repository<ProjectEntity>>(getRepositoryToken(ProjectEntity));
   
  });

  it('should create a speed test job successfully', async () => {
    const mockSpeedTest = {
      createdBy: 'user1',
      speedTests: [
        {
          fileServer: 'fileServer1',
          protocol: 'protocol1',
          test: {
            readTest: true,
            writeTest: true,
            packetLossTest: true,
          },
          workers: ['worker1', 'worker2'],
        },
      ],
    };

    const mockJobConfig = {
      id: 'jobConfigId',
      ...mockSpeedTest,
    };

    const mockSpeedTestConfig = {
      id: 'speedTestConfigId',
      jobId: 'jobConfigId',
      fileServer: 'fileServer1',
      protocol: 'protocol1',
      readTest: true,
      writeTest: true,
      packetLossTest: true,
    };
    const loggerSpy = jest.spyOn(service["logger"], "log");

    jest.spyOn(jobConfigRepo, 'create').mockReturnValue(mockJobConfig as any);
    jest.spyOn(jobConfigRepo, 'save').mockResolvedValue(mockJobConfig as any);
    jest.spyOn(speedTestConfigRepo, 'create').mockReturnValue(mockSpeedTestConfig as any);
    jest.spyOn(speedTestConfigRepo, 'save').mockResolvedValue(mockSpeedTestConfig as any);
    jest.spyOn(speedTestConfigWorkerRepo, 'create').mockImplementation((data) => data as any);
    jest.spyOn(speedTestConfigWorkerRepo, 'save').mockResolvedValue([] as any);

    const result = await service.createSpeedTest(mockSpeedTest as any);

    expect(result).toEqual([mockSpeedTestConfig]);



    expect(loggerSpy).toHaveBeenCalledWith(
      `Speed Test job created successfully`
    );

  });

  it('should throw an error if creating a speed test job fails', async () => {
    const mockSpeedTest = {
      createdBy: 'user1',
      speedTests: [
        {
          fileServer: 'fileServer1',
          protocol: 'protocol1',
          test: {
            readTest: true,
            writeTest: true,
            packetLossTest: true,
          },
          workers: ['worker1', 'worker2'],
        },
      ],
    };
    const loggerSpy = jest.spyOn(service["logger"], "error");

    jest.spyOn(jobConfigRepo, 'create').mockImplementation(() => {
      throw new Error('Test error');
    });

    await expect(service.createSpeedTest(mockSpeedTest as any)).rejects.toThrow(HttpException);
    expect(loggerSpy).toHaveBeenCalledWith(
      `Failed to create Speed Test job`, expect.any(String)
    );
  });
  it('should return speed test details if no results are found', async () => {
    const mockId = 'test-id';

    jest.spyOn(speedTestResultRepo, 'find').mockResolvedValue([]);
    jest.spyOn(service, 'getSpeedTestDetails').mockResolvedValue('speedTestDetails');

    const result = await service.getSpeedTestById(mockId);

    expect(result).toBe('speedTestDetails');
    expect(service.getSpeedTestDetails).toHaveBeenCalledWith(mockId);
  });

  it('should return speed test results with job run details', async () => {
    const mockId = 'test-id';
    const mockSpeedTestResults = [
      {
        traceId: mockId,
        fileServerId: 'fileServer1',
        workerId: 'worker1',
        writeResult: { speedLogEntries: [{ timeStamp: new Date(), speed: 100 }] },
        readResult: { speedLogEntries: [{ timeStamp: new Date(), speed: 200 }] },
        networkPerformanceResult: { roundTripDelayAvg: 10, packetLoss: 0 },
      },
    ];
    const mockFileServers = [
      {
        id: 'fileServer1',
        config: { configName: 'FileServer1' },
        protocol: 'FTP',
      },
    ];
    const mockWorkers = [
      {
        workerId: 'worker1',
        workerName: 'Worker1',
      },
    ];
    const mockJobRunDetails = {
      id: mockId,
      startTime: new Date(),
      endTime: new Date(),
      status: 'Completed',
    };

    jest.spyOn(speedTestResultRepo, 'find').mockResolvedValue(mockSpeedTestResults as any);
    jest.spyOn(fileServerEntityRepo, 'find').mockResolvedValue(mockFileServers as any);
    jest.spyOn(workerRepo, 'findByIds').mockResolvedValue(mockWorkers as any);
    jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(mockJobRunDetails as any);

    const result = await service.getSpeedTestById(mockId);

    expect(result).toEqual({
      jobRunId: mockId,
      startTime: mockJobRunDetails.startTime,
      endTime: mockJobRunDetails.endTime,
      status: mockJobRunDetails.status,
      totalWorkers: 1,
      fileServers: [
        {
          fileServerId: 'fileServer1',
          fileServerName: 'FileServer1',
          fileServerProtocol: 'FTP',
          workers: [
            {
              workerName: 'Worker1',
              workerId: 'worker1',
              readSpeed: [{ timeStamp: expect.any(Date), speed: 200 }],
              writeSpeed: [{ timeStamp: expect.any(Date), speed: 100 }],
              rtd: 10,
              packetLoss: 0,
            },
          ],
        },
      ],
    });
  });

  it('should throw an error if job run details are not found', async () => {
    const mockId = 'test-id';
    const mockSpeedTestResults = [
      {
        traceId: mockId,
        fileServerId: 'fileServer1',
        workerId: 'worker1',
        writeResult: { speedLogEntries: [{ timeStamp: new Date(), speed: 100 }] },
        readResult: { speedLogEntries: [{ timeStamp: new Date(), speed: 200 }] },
        networkPerformanceResult: { roundTripDelayAvg: 10, packetLoss: 0 },
      },
    ];
    const loggerSpy = jest.spyOn(service["logger"], "error");

    jest.spyOn(speedTestResultRepo, 'find').mockResolvedValue(mockSpeedTestResults as any);
    jest.spyOn(fileServerEntityRepo, 'find').mockResolvedValue([]);
    jest.spyOn(workerRepo, 'findByIds').mockResolvedValue([]);
    jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(null);

    await expect(service.getSpeedTestById(mockId)).rejects.toThrow(HttpException);
    expect(loggerSpy).toHaveBeenCalledWith(`Failed to fetch speed test results`, expect.any(String));

  });

  it('should return speed test details', async () => {
    const mockJobRunId = 'jobRunId';
    const mockJobRun = {
      id: mockJobRunId,
      jobConfigId: 'jobConfigId',
      startTime: new Date(),
      endTime: new Date(),
      status: 'Completed',
    };
    const mockSpeedTestJobConfig = [
      {
        jobId: 'jobConfigId',
        fileServer: 'fileServer1',
        workerEntities: [{ workersId: 'worker1' }],
      },
    ];
    const mockFileServers = [
      {
        id: 'fileServer1',
        config: { configName: 'FileServer1' },
        protocol: 'FTP',
      },
    ];
    const mockWorkers = [
      {
        workerId: 'worker1',
        workerName: 'Worker1',
      },
    ];

    jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(mockJobRun as any);
    jest.spyOn(speedTestConfigRepo, 'find').mockResolvedValue(mockSpeedTestJobConfig as any);
    jest.spyOn(fileServerRepo, 'find').mockResolvedValue(mockFileServers as any);
    jest.spyOn(workerRepo, 'findByIds').mockResolvedValue(mockWorkers as any);

    const result = await service.getSpeedTestDetails(mockJobRunId);

    expect(result).toEqual({
      jobRunId: mockJobRunId,
      startTime: mockJobRun.startTime,
      endTime: mockJobRun.endTime,
      status: mockJobRun.status,
      totalWorkers: 1,
      fileServers: [
        {
          fileServerId: 'fileServer1',
          fileServerName: 'FileServer1',
          fileServerProtocol: 'FTP',
          workers: [
            {
              workerName: 'Worker1',
              workerId: 'worker1',
            },
          ],
        },
      ],
    });
  });

  it('should throw an error if job run is not found', async () => {
    const mockJobRunId = 'jobRunId';

    jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(null);

    await expect(service.getSpeedTestDetails(mockJobRunId)).rejects.toThrow(`JobRun with id ${mockJobRunId} not found`);
  });
  
  it('should store speed test result successfully', async () => {
    const mockSpeedTest = {
      traceId: 'traceId',
      workerId: 'workerId',
      fileServerID: 'fileServerID',
      writeResult: {
        totalTimeTaken: 100,
        fileSize: 1024,
        speedLogs: [{ timeStamp: new Date(), speed: 100 }],
      },
      readResult: {
        totalTimeTaken: 200,
        fileSize: 2048,
        speedLogs: [{ timeStamp: new Date(), speed: 200 }],
      },
      networkPerformanceResult: {
        packetLoss: 0,
        roundTripDelay: { min: 10, avg: 20, max: 30, mdev: 5 },
      },
    };

    const mockWriteLog = { id: 'writeLogId' };
    const mockReadLog = { id: 'readLogId' };
    const mockNetworkResult = { id: 'networkResultId' };
    const loggerSpy = jest.spyOn(service["logger"], "log");

    jest.spyOn(speedLogRepo, 'save').mockResolvedValueOnce(mockWriteLog as any);
    jest.spyOn(speedLogRepo, 'save').mockResolvedValueOnce(mockReadLog as any);
    jest.spyOn(speedLogEntryRepo, 'save').mockResolvedValue({} as any);
    jest.spyOn(networkPerformanceResultRepo, 'save').mockResolvedValue(mockNetworkResult as any);
    jest.spyOn(speedTestResultRepo, 'save').mockResolvedValue({} as any);

    await service.storeSpeedTestResult(mockSpeedTest as any);
    expect(loggerSpy).toHaveBeenCalledWith('Storing speed test result', expect.any(String));
    expect(loggerSpy).toHaveBeenCalledWith('Speed test result stored successfully');
  });

  it('should throw an error if storing speed test result fails', async () => {
    const mockSpeedTest = {
      traceId: 'traceId',
      workerId: 'workerId',
      fileServerID: 'fileServerID',
      writeResult: {
        totalTimeTaken: 100,
        fileSize: 1024,
        speedLogs: [{ timeStamp: new Date(), speed: 100 }],
      },
      readResult: {
        totalTimeTaken: 200,
        fileSize: 2048,
        speedLogs: [{ timeStamp: new Date(), speed: 200 }],
      },
      networkPerformanceResult: {
        packetLoss: 0,
        roundTripDelay: { min: 10, avg: 20, max: 30, mdev: 5 },
      },
    };
    const loggerSpy = jest.spyOn(service["logger"], "error");

    jest.spyOn(speedLogRepo, 'save').mockImplementation(() => {
      throw new Error('Test error');
    });

    await expect(service.storeSpeedTestResult(mockSpeedTest as any)).rejects.toThrow(HttpException);
    expect(loggerSpy).toHaveBeenCalledWith('Failed to store speed test result', expect.any(String));

  });

  it('should fetch all speed test job runs successfully', async () => {
    const mockJobConfigs = [
      {
        id: 'jobConfigId1',
        jobRuns: [
          {
            id: 'jobRunId1',
            startTime: new Date(),
            endTime: new Date(),
            status: 'Completed',
          },
        ],
        speedTestConfigs: [
          {
            workerEntities: [{ workersId: 'worker1' }, { workersId: 'worker2' }],
          },
        ],
      },
    ];

    jest.spyOn(jobConfigRepo, 'find').mockResolvedValue(mockJobConfigs as any);
    const loggerSpy = jest.spyOn(service["logger"], "log");

    const result = await service.getAllSpeedTestJobRuns();

    expect(result).toEqual([
      {
        jobRunId: 'jobRunId1',
        jobConfigId: 'jobConfigId1',
        startTime: mockJobConfigs[0].jobRuns[0].startTime,
        endTime: mockJobConfigs[0].jobRuns[0].endTime,
        fileServerCount: 1,
        workers: 2,
        status: 'Completed',
      },
    ]);
    expect(loggerSpy).toHaveBeenCalledWith('Fetched all speed test job runs successfully');
  });

  it('should throw an error if fetching speed test job runs fails', async () => {
    jest.spyOn(jobConfigRepo, 'find').mockImplementation(() => {
      throw new Error('Test error');
    });
    const loggerSpy = jest.spyOn(service["logger"], "error");


    await expect(service.getAllSpeedTestJobRuns()).rejects.toThrow(HttpException);
    expect(loggerSpy).toHaveBeenCalledWith('Failed to fetch speed test job runs', expect.any(String));

  });

  it('should create bulk discovery job configs successfully', async () => {
    const mockBulkDiscovery = {
      sourcePathIds: ['path1', 'path2'],
      excludeFilePatterns: '*.tmp',
      preserveAccessTime: true,
      excludeOlderThan: new Date(),
      firstRunAt: new Date(),
      createdBy: 'user1',
    };

    const mockExistingList = [
      { sourcePathId: 'path1', scheduler: ScheduleStatus.SCHEDULING },
    ];

    const mockJobConfigEntities = [
      {
        status: JobStatus.Active,
        excludeFilePatterns: '*.tmp',
        jobType: JobType.DISCOVER,
        preserveAccessTime: true,
        sourcePathId: 'path2',
        excludeOlderThan: new Date(),
        firstRunAt: new Date(),
        scheduler: ScheduleStatus.SCHEDULING,
        createdBy: 'user1',
      },
    ];

    jest.spyOn(jobConfigRepo, 'find').mockResolvedValue(mockExistingList as any);
    jest.spyOn(jobConfigRepo, 'update').mockResolvedValue({ affected: 1 } as any);
    jest.spyOn(jobConfigRepo, 'create').mockImplementation((data) => data as any);
    jest.spyOn(jobConfigRepo, 'save').mockResolvedValue(mockJobConfigEntities as any);

    const result = await service.createBulkDiscovery(mockBulkDiscovery as any);

    expect(result).toEqual(mockJobConfigEntities);
    expect(jobConfigRepo.find).toHaveBeenCalledWith({
      where: {
        jobType: JobType.DISCOVER,
        sourcePath: In(mockBulkDiscovery.sourcePathIds),
      },
      select: { sourcePathId: true, scheduler: true },
    });
    expect(jobConfigRepo.update).toHaveBeenCalledWith(
      {
        jobType: JobType.DISCOVER,
        sourcePathId: In(mockBulkDiscovery.sourcePathIds),
        scheduler: In([
          ScheduleStatus.READY_TO_BE_SCHEDULED,
          ScheduleStatus.SCHEDULING,
        ]),
      },
      {
        excludeFilePatterns: mockBulkDiscovery.excludeFilePatterns,
        preserveAccessTime: mockBulkDiscovery.preserveAccessTime,
        excludeOlderThan: mockBulkDiscovery.excludeOlderThan,
        firstRunAt: mockBulkDiscovery.firstRunAt,
        scheduler: ScheduleStatus.SCHEDULING,
      }
    );
    expect(jobConfigRepo.create).toHaveBeenCalledWith({
      status: JobStatus.Active,
      excludeFilePatterns: mockBulkDiscovery.excludeFilePatterns,
      jobType: JobType.DISCOVER,
      preserveAccessTime: mockBulkDiscovery.preserveAccessTime,
      sourcePathId: 'path2',
      excludeOlderThan: mockBulkDiscovery.excludeOlderThan,
      firstRunAt: mockBulkDiscovery.firstRunAt,
      scheduler: ScheduleStatus.SCHEDULING,
      createdBy: mockBulkDiscovery.createdBy,
    });
    expect(jobConfigRepo.save).toHaveBeenCalledWith(mockJobConfigEntities);
  });

  it('should handle empty sourcePathIds', async () => {
    const mockBulkDiscovery = {
      sourcePathIds: [],
      excludeFilePatterns: '*.tmp',
      preserveAccessTime: true,
      excludeOlderThan: new Date(),
      firstRunAt: new Date(),
      createdBy: 'user1',
    };

    jest.spyOn(jobConfigRepo, 'find').mockResolvedValue([]);
    jest.spyOn(jobConfigRepo, 'update').mockResolvedValue({ affected: 0 } as any);
    jest.spyOn(jobConfigRepo, 'create').mockImplementation((data) => data as any);
    jest.spyOn(jobConfigRepo, 'save').mockResolvedValue([] as any);

    const result = await service.createBulkDiscovery(mockBulkDiscovery as any);

    expect(result).toEqual([]);
    expect(jobConfigRepo.find).toHaveBeenCalledWith({
      where: {
        jobType: JobType.DISCOVER,
        sourcePath: In(mockBulkDiscovery.sourcePathIds),
      },
      select: { sourcePathId: true, scheduler: true },
    });
    expect(jobConfigRepo.update).toHaveBeenCalledWith(
      {
        jobType: JobType.DISCOVER,
        sourcePathId: In(mockBulkDiscovery.sourcePathIds),
        scheduler: In([
          ScheduleStatus.READY_TO_BE_SCHEDULED,
          ScheduleStatus.SCHEDULING,
        ]),
      },
      {
        excludeFilePatterns: mockBulkDiscovery.excludeFilePatterns,
        preserveAccessTime: mockBulkDiscovery.preserveAccessTime,
        excludeOlderThan: mockBulkDiscovery.excludeOlderThan,
        firstRunAt: mockBulkDiscovery.firstRunAt,
        scheduler: ScheduleStatus.SCHEDULING,
      }
    );
    expect(jobConfigRepo.create).not.toHaveBeenCalled();
    expect(jobConfigRepo.save).toHaveBeenCalledWith([]);
  });
  it('should create bulk migrate job configs successfully', async () => {
    const mockBulkMigrate = {
      migrateConfigs: [
        {
          sourcePathId: 'sourcePath1',
          destinationPathId: ['destinationPath1', 'destinationPath2'],
        },
      ],
      options: {
        excludeFilePatterns: '*.tmp',
        preserveAccessTime: true,
        excludeOlderThan: new Date(),
        skipFile: false,
      },
      firstRunAt: new Date(),
      futureRunSchedule: '0 0 * * *',
    };

    const mockExistingJobConfigs = [
      { sourcePathId: 'sourcePath1', targetPathId: 'destinationPath1', scheduler: ScheduleStatus.SCHEDULING },
    ];

    const mockJobConfigEntities = [
      {
        id: 'jobConfigId1',
        jobType: JobType.MIGRATE,
        sourcePathId: 'sourcePath1',
        targetPathId: 'destinationPath2',
        status: JobStatus.Active,
      },
    ];

    jest.spyOn(jobConfigRepo, 'find').mockResolvedValue(mockExistingJobConfigs as any);
    jest.spyOn(jobConfigRepo, 'update').mockResolvedValue({ affected: 1 } as any);
    jest.spyOn(jobConfigRepo, 'create').mockImplementation((data) => data as any);
    jest.spyOn(jobConfigRepo, 'save').mockResolvedValue(mockJobConfigEntities as any);

    const result = await service.createBulkMigrate(mockBulkMigrate as any);

    expect(result).toEqual([
      {
        id: 'jobConfigId1',
        jobType: JobType.MIGRATE,
        status: 'CREATED',
        sourcePathId: 'sourcePath1',
        targetPathId: 'destinationPath2',
      },
    ]);
    expect(jobConfigRepo.find).toHaveBeenCalledWith({
      where: {
        jobType: JobType.MIGRATE,
        sourcePathId: 'sourcePath1',
        targetPathId: 'destinationPath1',
      },
      select: { sourcePathId: true, targetPathId: true, scheduler: true },
    });
    expect(jobConfigRepo.update).toHaveBeenCalledWith(
      {
        jobType: JobType.MIGRATE,
        sourcePathId: 'sourcePath1',
        targetPathId: 'destinationPath1',
        scheduler: In([
          ScheduleStatus.READY_TO_BE_SCHEDULED,
          ScheduleStatus.SCHEDULING,
        ]),
      },
      {
        excludeFilePatterns: mockBulkMigrate.options.excludeFilePatterns,
        preserveAccessTime: mockBulkMigrate.options.preserveAccessTime,
        excludeOlderThan: mockBulkMigrate.options.excludeOlderThan,
        skipFile: mockBulkMigrate.options.skipFile,
        firstRunAt: mockBulkMigrate.firstRunAt,
        scheduler: ScheduleStatus.SCHEDULING,
      }
    );
    expect(jobConfigRepo.create).toHaveBeenCalledWith({
      status: JobStatus.Active,
      excludeFilePatterns: mockBulkMigrate.options.excludeFilePatterns,
      jobType: JobType.MIGRATE,
      preserveAccessTime: mockBulkMigrate.options.preserveAccessTime,
      sourcePathId: 'sourcePath1',
      targetPathId: 'destinationPath2',
      excludeOlderThan: mockBulkMigrate.options.excludeOlderThan,
      firstRunAt: mockBulkMigrate.firstRunAt,
      scheduler: ScheduleStatus.SCHEDULING,
      futureScheduleAt: mockBulkMigrate.futureRunSchedule,
      skipFile: mockBulkMigrate.options.skipFile,
    });
    expect(jobConfigRepo.save).toHaveBeenCalledWith([
      {
        status: JobStatus.Active,
        excludeFilePatterns: mockBulkMigrate.options.excludeFilePatterns,
        jobType: JobType.MIGRATE,
        preserveAccessTime: mockBulkMigrate.options.preserveAccessTime,
        sourcePathId: 'sourcePath1',
        targetPathId: 'destinationPath2',
        excludeOlderThan: mockBulkMigrate.options.excludeOlderThan,
        firstRunAt: mockBulkMigrate.firstRunAt,
        scheduler: ScheduleStatus.SCHEDULING,
        futureScheduleAt: mockBulkMigrate.futureRunSchedule,
        skipFile: mockBulkMigrate.options.skipFile,
      },
    ]);
  });

  it('should handle empty migrateConfigs', async () => {
    const mockBulkMigrate = {
      migrateConfigs: [],
      options: {
        excludeFilePatterns: '*.tmp',
        preserveAccessTime: true,
        excludeOlderThan: new Date(),
        skipFile: false,
      },
      firstRunAt: new Date(),
      futureRunSchedule: '0 0 * * *',
    };

    const result = await service.createBulkMigrate(mockBulkMigrate as any);

    expect(result).toEqual([]);
    expect(jobConfigRepo.find).not.toHaveBeenCalled();
    expect(jobConfigRepo.update).not.toHaveBeenCalled();
    expect(jobConfigRepo.create).not.toHaveBeenCalled();
    expect(jobConfigRepo.save).not.toHaveBeenCalled();
  });
  it('should create bulk cutover job configs successfully', async () => {
    const mockBulkCutover = {
      cutoverConfig: [
        {
          sourcePathId: 'sourcePath1',
          destinationPathId: ['destinationPath1', 'destinationPath2'],
        },
      ],
    };

    const mockJobConfigs = [
      {
        id: 'jobConfigId1',
        jobType: JobType.MIGRATE,
        sourcePathId: 'sourcePath1',
        targetPathId: 'destinationPath1',
        excludeFilePatterns: '*.tmp',
        scheduler: ScheduleStatus.SCHEDULING,
        futureScheduleAt: '0 0 * * *',
        status: JobStatus.Active,
        preserveAccessTime: true,
        firstRunAt: new Date(),
      },
    ];

    const mockJobRunStatuses = [
      {
        jobConfigId: 'jobConfigId1',
        status: JobRunStatus.Completed,
        endTime: new Date(),
      },
    ];

    const mockSavedJobs = [
      {
        id: 'newJobConfigId1',
        jobType: JobType.CUT_OVER,
        sourcePathId: 'sourcePath1',
        targetPathId: 'destinationPath2',
        excludeFilePatterns: '*.tmp',
        scheduler: ScheduleStatus.SCHEDULING,
        futureScheduleAt: '0 0 * * *',
        status: JobStatus.Active,
        preserveAccessTime: true,
        firstRunAt: new Date(),
      },
    ];

    jest.spyOn(service, 'flattenCutoverConfig').mockReturnValue([
      { sourcePathId: 'sourcePath1', destinationPathId: 'destinationPath1' },
      { sourcePathId: 'sourcePath1', destinationPathId: 'destinationPath2' },
    ]);
    jest.spyOn(service, 'findJobConfigs').mockResolvedValue(mockJobConfigs as any);
    jest.spyOn(jobRunRepo, 'find').mockResolvedValue(mockJobRunStatuses as any);
    jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(null);
    jest.spyOn(jobConfigRepo, 'create').mockImplementation((data) => data as any);
    jest.spyOn(jobConfigRepo, 'save').mockResolvedValue(mockSavedJobs as any);

    const result = await service.createBulkCutover(mockBulkCutover as any);

    expect(result).toEqual([
      {
        id: 'newJobConfigId1',
        firstRunAt: mockSavedJobs[0].firstRunAt,
        jobType: JobType.CUT_OVER,
        sourcePathId: 'sourcePath1',
        targetPathId: 'destinationPath2',
        status: JobStatus.Active,
      },
    ]);
    expect(service.flattenCutoverConfig).toHaveBeenCalledWith(mockBulkCutover.cutoverConfig);
    expect(service.findJobConfigs).toHaveBeenCalledWith([
      { sourcePathId: 'sourcePath1', destinationPathId: 'destinationPath1' },
      { sourcePathId: 'sourcePath1', destinationPathId: 'destinationPath2' },
    ]);
    expect(jobRunRepo.find).toHaveBeenCalledWith({
      where: { jobConfigId: In(['jobConfigId1']), status: In([JobRunStatus.Completed, JobRunStatus.Stopped]) },
      order: { endTime: 'DESC' },
    });
    expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
      where: {
        jobType: JobType.CUT_OVER,
        sourcePathId: 'sourcePath1',
        targetPathId: 'destinationPath1',
      },
    });
    expect(jobConfigRepo.create).toHaveBeenCalledWith({
      jobType: JobType.CUT_OVER,
      sourcePathId: 'sourcePath1',
      targetPathId: 'destinationPath1',
      excludeFilePatterns: '*.tmp',
      scheduler: ScheduleStatus.SCHEDULING,
      futureScheduleAt: '0 0 * * *',
      status: JobStatus.Active,
      preserveAccessTime: true,
      firstRunAt: expect.any(Date),
    });
    expect(jobConfigRepo.save).toHaveBeenCalledWith([
      {
        jobType: JobType.CUT_OVER,
        sourcePathId: 'sourcePath1',
        targetPathId: 'destinationPath1',
        excludeFilePatterns: '*.tmp',
        scheduler: ScheduleStatus.SCHEDULING,
        futureScheduleAt: '0 0 * * *',
        status: JobStatus.Active,
        preserveAccessTime: true,
        firstRunAt: expect.any(Date),
      },
    ]);
  });

  it('should throw an error if cutover already exists', async () => {
    const mockBulkCutover = {
      cutoverConfig: [
        {
          sourcePathId: 'sourcePath1',
          destinationPathId: ['destinationPath1'],
        },
      ],
    };

    const mockJobConfigs = [
      {
        id: 'jobConfigId1',
        jobType: JobType.MIGRATE,
        sourcePathId: 'sourcePath1',
        targetPathId: 'destinationPath1',
        excludeFilePatterns: '*.tmp',
        scheduler: ScheduleStatus.SCHEDULING,
        futureScheduleAt: '0 0 * * *',
        status: JobStatus.Active,
        preserveAccessTime: true,
        firstRunAt: new Date(),
      },
    ];

    const mockJobRunStatuses = [
      {
        jobConfigId: 'jobConfigId1',
        status: JobRunStatus.Completed,
        endTime: new Date(),
      },
    ];

    const mockExistingCutover = {
      id: 'existingCutoverId',
      jobType: JobType.CUT_OVER,
      sourcePathId: 'sourcePath1',
      targetPathId: 'destinationPath1',
      status: JobStatus.Active,
    };

    jest.spyOn(service, 'flattenCutoverConfig').mockReturnValue([
      { sourcePathId: 'sourcePath1', destinationPathId: 'destinationPath1' },
    ]);
    jest.spyOn(service, 'findJobConfigs').mockResolvedValue(mockJobConfigs as any);
    jest.spyOn(jobRunRepo, 'find').mockResolvedValue(mockJobRunStatuses as any);
    jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockExistingCutover as any);

    await expect(service.createBulkCutover(mockBulkCutover as any)).rejects.toThrow(HttpException);
    expect(service.flattenCutoverConfig).toHaveBeenCalledWith(mockBulkCutover.cutoverConfig);
    expect(service.findJobConfigs).toHaveBeenCalledWith([
      { sourcePathId: 'sourcePath1', destinationPathId: 'destinationPath1' },
    ]);
    expect(jobRunRepo.find).toHaveBeenCalledWith({
      where: { jobConfigId: In(['jobConfigId1']), status: In([JobRunStatus.Completed, JobRunStatus.Stopped]) },
      order: { endTime: 'DESC' },
    });
    expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
      where: {
        jobType: JobType.CUT_OVER,
        sourcePathId: 'sourcePath1',
        targetPathId: 'destinationPath1',
      },
    });
  });
  describe('updateJobConfig', () => {
    it('should update job config successfully', async () => {
      const mockJobConfigId = 'jobConfigId';
      const mockJobConfig = {
        id: mockJobConfigId,
        jobType: 'MIGRATE',
      };
      const mockData: Partial<JobConfigDto> = {
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobConfigRepo, 'save').mockResolvedValue({ ...mockJobConfig, ...mockData } as any);

      const result = await service.updateJobConfig(mockJobConfigId, mockData);

      expect(result).toEqual({ ...mockJobConfig, ...mockData });
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({ where: { id: mockJobConfigId } });
      expect(jobConfigRepo.save).toHaveBeenCalledWith({ ...mockJobConfig, ...mockData });
    });

    it('should throw an error if job config is not found', async () => {
      const mockJobConfigId = 'jobConfigId';
      const mockData: Partial<JobConfigDto> = {
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(null);

      await expect(service.updateJobConfig(mockJobConfigId, mockData)).rejects.toThrow(`Job with id ${mockJobConfigId} not found`);
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({ where: { id: mockJobConfigId } });
    });
  });

  describe('deleteJobConfig', () => {
    it('should delete job config successfully', async () => {
      const mockJobConfigId = 'jobConfigId';
      const mockJobConfig = {
        id: mockJobConfigId,
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobConfigRepo, 'remove').mockResolvedValue(undefined);

      const result = await service.deleteJobConfig(mockJobConfigId);

      expect(result).toEqual({ message: `Job with id ${mockJobConfigId} has been deleted` });
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({ where: { id: mockJobConfigId } });
      expect(jobConfigRepo.remove).toHaveBeenCalledWith(mockJobConfig);
    });

    it('should throw an error if job config is not found', async () => {
      const mockJobConfigId = 'jobConfigId';

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(null);

      await expect(service.deleteJobConfig(mockJobConfigId)).rejects.toThrow(`Job with id ${mockJobConfigId} not found`);
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({ where: { id: mockJobConfigId } });
    });
  });

  describe('getJobConfigById', () => {
    it('should return job config by id successfully', async () => {
      const mockJobConfigId = 'jobConfigId';
      const mockJobConfig = {
        id: mockJobConfigId,
        jobType: 'MIGRATE',
        jobRuns: [
          {
            id: 'jobRunId1',
            isReportReady: true,
            status: 'Completed',
            startTime: new Date(),
            endTime: new Date(),
          },
        ],
        sourcePath: {
          volumePath: '/source/path',
          fileServer: {
            protocol: 'NFS',
            config: {
              configName: 'SourceServer',
            },
          },
        },
        targetPath: {
          volumePath: '/target/path',
          fileServer: {
            protocol: 'NFS',
            config: {
              configName: 'TargetServer',
            },
          },
        },
        status: 'Active',
        createdAt: new Date(),
      };

      const mockInventoryCounts = {
        filecount: '10',
        directorycount: '5',
        totalsize: '1000',
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(inventoryRepo, 'createQueryBuilder').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue(mockInventoryCounts),
      } as any);

      const result = await service.getJobConfigById(mockJobConfigId);

      expect(result).toEqual({
        jobConfigId: mockJobConfigId,
        jobType: 'MIGRATE',
        sourceServer: {
          serverName: 'SourceServer',
          path: '/source/path',
          protocol: 'NFS',
        },
        destinationServer: {
          serverName: 'TargetServer',
          path: '/target/path',
          protocol: 'NFS',
        },
        status: 'Active',
        createdAt: mockJobConfig.createdAt,
        jobRuns: [
          {
            jobRunId: 'jobRunId1',
            isReportReady: true,
            status: 'Completed',
            startTime: mockJobConfig.jobRuns[0].startTime,
            endTime: mockJobConfig.jobRuns[0].endTime,
            jobType: 'MIGRATE',
            timeElapsed: mockJobConfig.jobRuns[0].endTime.getTime() - mockJobConfig.jobRuns[0].startTime.getTime(),
            scannedFilesCount: '10',
            scannedDirectoriesCount: '5',
            totalScannedSize: '1000 B',
            errors: [],
          },
        ],
        aggregateData: {
          timeElapsed: mockJobConfig.jobRuns[0].endTime.getTime() - mockJobConfig.jobRuns[0].startTime.getTime(),
          scannedFilesCount: '10',
          scannedDirectoriesCount: '5',
          totalScannedSize: 1000,
        },
        errors: [],
      });
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockJobConfigId },
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
      expect(inventoryRepo.createQueryBuilder).toHaveBeenCalled();
    });

    it('should throw an error if job config is not found', async () => {
      const mockJobConfigId = 'jobConfigId';

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(null);

      await expect(service.getJobConfigById(mockJobConfigId)).rejects.toThrow(`Job with id ${mockJobConfigId} not found`);
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockJobConfigId },
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
    });
  });
  describe('precheckValidation', () => {
    it('should perform precheck validation successfully', async () => {
      const mockPrecheckData = [
        {
          sourcePathId: 'sourcePath1',
          destinationPathId: ['destinationPath1'],
        },
      ];

      const mockVolumeEntities = [
        {
          id: 'sourcePath1',
          volumePath: '/source/path',
          fileServer: {
            id: 'fileServer1',
            host: 'source-host',
            userName: 'source-user',
            password: 'source-pass',
            protocol: 'NFS',
            protocolVersion: 'v4',
            serverType: 'source-server-type',
            workers: [{ workerId: 'worker1', status: 'Online' }],
          },
        },
        {
          id: 'destinationPath1',
          volumePath: '/destination/path',
          fileServer: {
            id: 'fileServer2',
            host: 'destination-host',
            userName: 'destination-user',
            password: 'destination-pass',
            protocol: 'NFS',
            protocolVersion: 'v4',
            serverType: 'destination-server-type',
            workers: [{ workerId: 'worker1', status: 'Online' }],
          },
        },
      ];

      jest.spyOn(volumeRepo, 'find').mockResolvedValue(mockVolumeEntities as any);
      const loggerSpy = jest.spyOn(service["logger"], "log");

      const result = await service.precheckValidation(mockPrecheckData as any);

      expect(result).toEqual([
        {
          sourcePathId: 'sourcePath1',
          destinations: [
            {
              destinationPathId: 'destinationPath1',
              status: 'success',
              commonWorkers: [{ workerId: 'worker1' }],
            },
          ],
          status: 'success',
        },
      ]);
      expect(volumeRepo.find).toHaveBeenCalledWith({
        where: { id: In(['sourcePath1', 'destinationPath1']) },
        relations: {
          fileServer: { workers: true },
        },
      });

    });

    it('should handle source path not found', async () => {
      const mockPrecheckData = [
        {
          sourcePathId: 'sourcePath1',
          destinationPathId: ['destinationPath1'],
        },
      ];

      const mockVolumeEntities = [];

      jest.spyOn(volumeRepo, 'find').mockResolvedValue(mockVolumeEntities as any);

      const result = await service.precheckValidation(mockPrecheckData as any);

      expect(result).toEqual([
        {
          sourcePathId: 'sourcePath1',
          destinations: [],
          status: 'failed',
          error: ['SOURCE_PATH_NOT_FOUND'],
          message: 'Source path sourcePath1 not found',
        },
      ]);
      expect(volumeRepo.find).toHaveBeenCalledWith({
        where: { id: In(['sourcePath1', 'destinationPath1']) },
        relations: {
          fileServer: { workers: true },
        },
      });
    });

    it('should handle destination path not found', async () => {
      const mockPrecheckData = [
        {
          sourcePathId: 'sourcePath1',
          destinationPathId: ['destinationPath1'],
        },
      ];

      const mockVolumeEntities = [
        {
          id: 'sourcePath1',
          volumePath: '/source/path',
          fileServer: {
            id: 'fileServer1',
            host: 'source-host',
            userName: 'source-user',
            password: 'source-pass',
            protocol: 'NFS',
            protocolVersion: 'v4',
            serverType: 'source-server-type',
            workers: [{ workerId: 'worker1', status: 'Online' }],
          },
        },
      ];

      jest.spyOn(volumeRepo, 'find').mockResolvedValue(mockVolumeEntities as any);

      const result = await service.precheckValidation(mockPrecheckData as any);

      expect(result).toEqual([
        {
          sourcePathId: 'sourcePath1',
          destinations: [
            {
              status: 'failed',
              errors: ['DESTINATION_PATH_NOT_FOUND'],
              message: `Destination path destinationPath1 not found`,
              destinationPathId: 'destinationPath1',
            },
          ],
          status: 'success',
        },
      ]);
      expect(volumeRepo.find).toHaveBeenCalledWith({
        where: { id: In(['sourcePath1', 'destinationPath1']) },
        relations: {
          fileServer: { workers: true },
        },
      });
    });

    it('should handle protocol version mismatch', async () => {
      const mockPrecheckData = [
        {
          sourcePathId: 'sourcePath1',
          destinationPathId: ['destinationPath1'],
        },
      ];

      const mockVolumeEntities = [
        {
          id: 'sourcePath1',
          volumePath: '/source/path',
          fileServer: {
            id: 'fileServer1',
            host: 'source-host',
            userName: 'source-user',
            password: 'source-pass',
            protocol: 'NFS',
            protocolVersion: 'v4',
            serverType: 'source-server-type',
            workers: [{ workerId: 'worker1', status: 'Online' }],
          },
        },
        {
          id: 'destinationPath1',
          volumePath: '/destination/path',
          fileServer: {
            id: 'fileServer2',
            host: 'destination-host',
            userName: 'destination-user',
            password: 'destination-pass',
            protocol: 'NFS',
            protocolVersion: 'v3',
            serverType: 'destination-server-type',
            workers: [{ workerId: 'worker1', status: 'Online' }],
          },
        },
      ];

      jest.spyOn(volumeRepo, 'find').mockResolvedValue(mockVolumeEntities as any);

      const result = await service.precheckValidation(mockPrecheckData as any);

      expect(result).toEqual([
        {
          sourcePathId: 'sourcePath1',
          destinations: [
            {
              status: 'failed',
              errors: ['PROTOCOL_VERSION_MISMATCH'],
              message: `Protocol version mismatch between source path sourcePath1 and destination path destinationPath1`,
              destinationPathId: 'destinationPath1',
            },
          ],
          status: 'success',
        },
      ]);
      expect(volumeRepo.find).toHaveBeenCalledWith({
        where: { id: In(['sourcePath1', 'destinationPath1']) },
        relations: {
          fileServer: { workers: true },
        },
      });
    });

    it('should handle no common workers found', async () => {
      const mockPrecheckData = [
        {
          sourcePathId: 'sourcePath1',
          destinationPathId: ['destinationPath1'],
        },
      ];

      const mockVolumeEntities = [
        {
          id: 'sourcePath1',
          volumePath: '/source/path',
          fileServer: {
            id: 'fileServer1',
            host: 'source-host',
            userName: 'source-user',
            password: 'source-pass',
            protocol: 'NFS',
            protocolVersion: 'v4',
            serverType: 'source-server-type',
            workers: [{ workerId: 'worker1', status: 'Online' }],
          },
        },
        {
          id: 'destinationPath1',
          volumePath: '/destination/path',
          fileServer: {
            id: 'fileServer2',
            host: 'destination-host',
            userName: 'destination-user',
            password: 'destination-pass',
            protocol: 'NFS',
            protocolVersion: 'v4',
            serverType: 'destination-server-type',
            workers: [{ workerId: 'worker2', status: 'Online' }],
          },
        },
      ];

      jest.spyOn(volumeRepo, 'find').mockResolvedValue(mockVolumeEntities as any);

      const result = await service.precheckValidation(mockPrecheckData as any);

      expect(result).toEqual([
        {
          sourcePathId: 'sourcePath1',
          destinations: [
            {
              status: 'failed',
              errors: ['NO_COMMON_WORKERS'],
              message: `No common workers found for source path sourcePath1 and destination path destinationPath1`,
              destinationPathId: 'destinationPath1',
            },
          ],
          status: 'success',
        },
      ]);
      expect(volumeRepo.find).toHaveBeenCalledWith({
        where: { id: In(['sourcePath1', 'destinationPath1']) },
        relations: {
          fileServer: { workers: true },
        },
      });
    });
  });
  describe('hasCommonWorkers', () => {
    it('should return true if common workers are found', () => {
      const mockData = [
        {
          fileServer: {
            workers: [
              { id: 'worker1', status: 'Online' },
              { id: 'worker2', status: 'Online' },
            ],
          },
        },
        {
          fileServer: {
            workers: [
              { id: 'worker2', status: 'Online' },
              { id: 'worker3', status: 'Online' },
            ],
          },
        },
      ];

      expect(service.hasCommonWorkers(mockData)).toBe(true);
    });

    it('should return false if no common workers are found', () => {
      const mockData = [
        {
          fileServer: {
            workers: [
              { id: 'worker1', status: 'Online' },
              { id: 'worker2', status: 'Online' },
            ],
          },
        },
        {
          fileServer: {
            workers: [
              { id: 'worker3', status: 'Online' },
              { id: 'worker4', status: 'Online' },
            ],
          },
        },
      ];

      expect(service.hasCommonWorkers(mockData)).toBe(false);
    });

    it('should return false if any file server has no workers', () => {
      const mockData = [
        {
          fileServer: {
            workers: [],
          },
        },
        {
          fileServer: {
            workers: [
              { id: 'worker1', status: 'Online' },
              { id: 'worker2', status: 'Online' },
            ],
          },
        },
      ];

      expect(service.hasCommonWorkers(mockData)).toBe(false);
    });
  });

  describe('findJobConfigs', () => {
    it('should find job configs based on conditions', async () => {
      const mockConditions = [
        { sourcePathId: 'sourcePath1', destinationPathId: 'destinationPath1' },
        { sourcePathId: 'sourcePath2', destinationPathId: 'destinationPath2' },
      ];

      const mockJobConfigs = [
        { id: 'jobConfig1', sourcePathId: 'sourcePath1', targetPathId: 'destinationPath1' },
        { id: 'jobConfig2', sourcePathId: 'sourcePath2', targetPathId: 'destinationPath2' },
      ];

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockJobConfigs),
      };

      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue(mockQueryBuilder as any);

      const result = await service.findJobConfigs(mockConditions);

      expect(result).toEqual(mockJobConfigs);
      expect(jobConfigRepo.createQueryBuilder).toHaveBeenCalledWith('jobConfig');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        `(jobConfig.sourcePathId = :sourcePathId_0 AND jobConfig.targetPathId = :destinationPathId_0) AND jobConfig.jobType = 'MIGRATE'`,
        { sourcePathId_0: 'sourcePath1', destinationPathId_0: 'destinationPath1' }
      );
      expect(mockQueryBuilder.orWhere).toHaveBeenCalledWith(
        `(jobConfig.sourcePathId = :sourcePathId_1 AND jobConfig.targetPathId = :destinationPathId_1)`,
        { sourcePathId_1: 'sourcePath2', destinationPathId_1: 'destinationPath2' }
      );
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });

    it('should return empty array if no conditions are provided', async () => {
      const result = await service.findJobConfigs([]);

      expect(result).toEqual([]);
      expect(jobConfigRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
  describe('covertBytes', () => {
     it('should convert bytes to appropriate units', () => {
      expect(service.covertBytes(500)).toBe('500 B');
      expect(service.covertBytes(1024)).toBe('1.00 KB');
      expect(service.covertBytes(1048576)).toBe('1.00 MB');
      expect(service.covertBytes(1073741824)).toBe('1.00 GB');
      expect(service.covertBytes(1099511627776)).toBe('1.00 TB');
      expect(service.covertBytes(1125899906842624)).toBe('1.00 PB');
    });

    it('should handle edge cases correctly', () => {
      expect(service.covertBytes(0)).toBe('0 B');
      expect(service.covertBytes(1023)).toBe('1023 B');
      expect(service.covertBytes(1024 * 1024 - 1)).toBe('1024.00 KB');
      expect(service.covertBytes(1024 * 1024 * 1024 - 1)).toBe('1024.00 MB');
      expect(service.covertBytes(1024 * 1024 * 1024 * 1024 - 1)).toBe('1024.00 GB');
      expect(service.covertBytes(1024 * 1024 * 1024 * 1024 * 1024 - 1)).toBe('1024.00 TB');
    });
  });
  describe('getTemplateFilename', () => {
    it('should return the correct template filename', () => {
      service['templates'] = {
        [TemplateType.GID]: 'template1.csv',
        [TemplateType.SID]: 'template2.csv',
        [TemplateType.UID]: 'template3.csv',
      };

      expect(service.getTemplateFilename(TemplateType.GID)).toBe('template1.csv');
      expect(service.getTemplateFilename(TemplateType.SID)).toBe('template2.csv');
    });
    it('should return undefined if an invalid TemplateType is passed', () => {
      service['templates'] = {
        [TemplateType.GID]: 'template1.csv',
        [TemplateType.SID]: 'template2.csv',
        [TemplateType.UID]: 'template3.csv',
      };
    
      expect(service.getTemplateFilename('INVALID_TYPE' as TemplateType)).toBeUndefined();
    });
  });


  describe('getAllJobConfig', () => {
    it('should return all job configs for the given project ID', async () => {
      const mockProjectId = 'projectId';
      const date = new Date()
      const mockAllJobsDetails = [
        {
          jobconfigid: 'jobConfigId1',
          jobtype: 'MIGRATE',
          jobconfigstatus: 'Active',
          firstrunat: date,
          sourcepath: 'sourcePath1',
          targetpath: 'targetPath1',
          futureschedule: '0 0 * * *',
          sourceservername: 'SourceServer1',
          targetservername: 'TargetServer1',
          sourceprotocol: 'NFS',
          targetprotocol: 'NFS',
          createdAt: date,
          totalRuns: 5,
        },
      ];

      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        leftJoin: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockAllJobsDetails),
      } as any);

      jest.spyOn(require('src/utils/mapper'), 'nextDate').mockReturnValue(new Date());

      const result = await service.getAllJobConfig(mockProjectId);

      expect(result).toEqual([
        {
          jobConfigId: 'jobConfigId1',
          jobType: 'MIGRATE',
          jobStatus: 'Active',
          nextScheduleDate: date,
          sourceServer: {
            serverName: 'SourceServer1',
            path: 'sourcePath1',
            protocol: 'NFS',
          },
          destinationServer: {
            serverName: 'TargetServer1',
            path: 'targetPath1',
            protocol: 'NFS',
          },
          errors: 0,
          totalRuns: 5,
          configName: undefined,
          createdAt: mockAllJobsDetails[0].createdAt,
        },
      ]);
      expect(jobConfigRepo.createQueryBuilder).toHaveBeenCalledWith('jobconfig');
      expect(nextDate).toHaveBeenCalledWith('MIGRATE', mockAllJobsDetails[0].firstrunat, mockAllJobsDetails[0].futureschedule);
    });

    it('should return an empty array if no job configs are found for the given project ID', async () => {
      const mockProjectId = 'projectId';
    
      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        leftJoin: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      } as any);
    
      const result = await service.getAllJobConfig(mockProjectId);
    
      expect(result).toEqual([]);
      expect(jobConfigRepo.createQueryBuilder).toHaveBeenCalledWith('jobconfig');
    });
  });
  it('should throw BadRequestException if projectId is not a valid UUID', async () => {
    const mockProjectId = 'invalid-uuid';
  
    jest.mock('class-validator', () => ({
      ...jest.requireActual('class-validator'),
      isUUID: jest.fn(() => false),
    }));
  
    await expect(service.getConfigsByProjectId(mockProjectId)).rejects.toThrow(BadRequestException);
  });

  it('should throw NotFoundException if no project is found for the given project ID', async () => {
    const mockProjectId = 'valid-uuid';
  
    jest.spyOn(require('class-validator'), 'isUUID').mockReturnValue(true);
    jest.spyOn(projectRepo, 'findOne').mockResolvedValue(null);
  
    await expect(service.getConfigsByProjectId(mockProjectId)).rejects.toThrow(BadRequestException);
  });
  it('should handle cases where targetPath is null in job configs', async () => {
    const mockProjectId = 'projectId';
    const date = new Date()
    const mockAllJobsDetails = [
      {
        jobconfigid: 'jobConfigId1',
        jobtype: 'MIGRATE',
        jobconfigstatus: 'Active',
        firstrunat: date,
        sourcepath: 'sourcePath1',
        targetpath: null,
        futureschedule: '0 0 * * *',
        sourceservername: 'SourceServer1',
        targetservername: null,
        sourceprotocol: 'NFS',
        targetprotocol: null,
        createdAt: date,
        totalRuns: 5,
      },
    ];
  
    jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(mockAllJobsDetails),
    } as any);
  
    jest.spyOn(require('src/utils/mapper'), 'nextDate').mockReturnValue(new Date());
  
    const result = await service.getAllJobConfig(mockProjectId);
  
    expect(result).toEqual([
      {
        jobConfigId: 'jobConfigId1',
        jobType: 'MIGRATE',
        jobStatus: 'Active',
        nextScheduleDate: new Date(),
        sourceServer: {
          serverName: 'SourceServer1',
          path: 'sourcePath1',
          protocol: 'NFS',
        },
        destinationServer: {},
        errors: 0,
        totalRuns: 5,
        configName: undefined,
        createdAt: mockAllJobsDetails[0].createdAt,
      },
    ]);
  });
  it('should return an empty array if no job configs are found', async () => {
    const mockProjectId = 'projectId';
  
    jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    } as any);
  
    const result = await service.getAllJobConfig(mockProjectId);
  
    expect(result).toEqual([]);
  });
  
  it('should throw BadRequestException if projectId is invalid', async () => {
    const mockProjectId = 'invalid-uuid';
  
    await expect(service.getConfigsByProjectId(mockProjectId)).rejects.toThrow(BadRequestException);
  });

  it('should throw NotFoundException if project is not found', async () => {
    const mockProjectId = 'valid-uuid';
  
    jest.spyOn(projectRepo, 'findOne').mockResolvedValue(null);
    const getConfigsByProjectIdSpy = jest.spyOn(service, 'getConfigsByProjectId');
  
    await expect(service.getConfigsByProjectId(mockProjectId)).rejects.toThrow(BadRequestException);
    expect(getConfigsByProjectIdSpy).toHaveBeenCalledWith(mockProjectId);
  });
});