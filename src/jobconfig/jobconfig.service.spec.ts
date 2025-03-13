import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobConfigService } from './jobconfig.service';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { Repository } from 'typeorm';
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
import * as winston from 'winston';
import * as uuid from 'uuid';
import { JobStatus, JobType } from 'src/constants/enums';
import { HttpException, HttpStatus } from '@nestjs/common';

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
});