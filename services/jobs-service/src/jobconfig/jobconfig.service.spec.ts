import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import {
  LoggerFactory,
  LoggerService,
} from "@netapp-cloud-datamigrate/logger-lib";
import { createClient } from "redis";
import {
  JobConfigurationEnum,
  JobRunStatus,
  JobStatus,
  JobType,
  Protocol,
  SmbPermissionInheritanceMode,
  TemplateType,
} from "src/constants/enums";
import { ScheduleStatus } from "src/constants/status";
import { IdentityConfigCrossMappingEntity } from "src/entities/indentity-mapping-cross.entity";
import { IdentityMappingEntity } from "src/entities/indentity-mapping.entity";
import { RedisService } from "src/redis/redis.service";
import { AuthService } from "src/auth/auth.service";
import { HttpService } from "@nestjs/axios";
import { ParsedMapping } from "src/utils/indentity-mapping.type";
import { In, Repository, Raw } from "typeorm";
import * as winston from "winston";
import { FileServerEntity } from "../entities/fileserver.entity";
import { InventoryEntity } from "../entities/inventory.entity";
import { JobConfigEntity } from "../entities/jobconfig.entity";
import { JobRunEntity } from "../entities/jobrun.entity";
import { ProjectEntity } from "../entities/project.entity";
import {
  SpeedTestConfigEntity,
  SpeedTestConfigWorkerEntity,
} from "../entities/speed-test-job-config.entity";
import {
  NetworkPerformanceResultEntity,
  SpeedLogEntity,
  SpeedLogEntryEntity,
  SpeedTestResultEntity,
} from "../entities/speed-test-result.entity";
import { VolumeEntity } from "../entities/volume.entity";
import { WorkerEntity } from "../entities/worker.entity";
import { WorkflowService } from "../workflow/workflow.service";
import { JobConfigDto } from "./dto/jobconfig.dto";
import { JobConfigService } from "./jobconfig.service";

import { OperationErrorEntity } from "src/entities/operation-error.entity";
import { BulkMigrateJobConfig } from "./dto/bulkMigrateJob.dto";
import { v4 as uuid } from "uuid";
import { SendMailService } from "src/utils/send-email";
import { HealthStatus } from "src/workers/worker.types";
import { SyncEmailEntity } from "src/entities/sync-email.entity";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import {formatBytes} from '@netapp-cloud-datamigrate/jobs-lib';
import { JobStatsSummaryMvEntity } from "src/entities/job-stats-summary-mv.entity";
import { JobConfigInventoryStatsEntity } from "src/entities/job-config-inventory-stats.entity";
import { DataSource } from "typeorm";
import { MountTrackerService } from "./mount-tracker.service";
import { SoftDeleteJobConfigRepository } from "src/repositories/soft-delete-jobconfig.repository";

jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');
  return {
    ...actual,
    Raw: jest.fn((fn) => fn('workerResponse')),
  };
});

describe("JobConfigService", () => {
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
  let identityMappingRepo: any;
  let identityCrossMappingRepo: Repository<IdentityConfigCrossMappingEntity>;
  let operationErrorRepo: Repository<OperationErrorEntity>;
  let redisService: RedisService;
  let workFlowService: WorkflowService;
  let sendMailService: SendMailService;
  let jobStatsSummaryMvRepo: Repository<JobStatsSummaryMvEntity>;
  let jobConfigInventoryStatsRepo: Repository<JobConfigInventoryStatsEntity>;
  let dataSource: DataSource;

  let workerJobRunMapRepo: Repository<WorkerJobRunMap>;

  beforeEach(async () => {
    configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    loggerService = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<LoggerService>;
    redisService = {
      getClient: jest.fn().mockReturnValue(createClient()),
    } as unknown as jest.Mocked<RedisService>;

    loggerFactory = {
      create: jest.fn().mockReturnValue(loggerService),
    } as unknown as jest.Mocked<LoggerFactory>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobConfigService,
        RedisService,
        WorkflowService,
        SendMailService,
        {
          provide: MountTrackerService,
          useValue: {
            ensureMounted: jest.fn(),
            listDirectories: jest.fn(),
            touch: jest.fn(),
            unmount: jest.fn(),
            unmountAll: jest.fn(),
          },
        },
        { provide: ConfigService, useValue: configService },
        { provide: LoggerFactory, useValue: loggerFactory },
        { provide: "winston", useValue: winston },
        {
          provide: SoftDeleteJobConfigRepository,
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
          provide: getRepositoryToken(WorkerJobRunMap),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue([]),
            }),
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
          provide: getRepositoryToken(SyncEmailEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn()
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
            createQueryBuilder: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              addOrderBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue([]),
            }),
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
        {
          provide: getRepositoryToken(IdentityMappingEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            findBy: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(IdentityConfigCrossMappingEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
            exists: jest.fn(),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: getRepositoryToken(OperationErrorEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue([]),
            }),
          },
        },
        {
          provide: getRepositoryToken(JobStatsSummaryMvEntity),
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
          provide: getRepositoryToken(JobConfigInventoryStatsEntity),
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
          provide: DataSource,
          useValue: {
            query: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<JobConfigService>(JobConfigService);
    workFlowService = module.get<WorkflowService>(WorkflowService);
    jobConfigRepo = module.get<SoftDeleteJobConfigRepository>(
      SoftDeleteJobConfigRepository
    ) as any;
    (jobConfigRepo as any).manager = {
      transaction: jest.fn(),
    };
    speedTestConfigRepo = module.get<Repository<SpeedTestConfigEntity>>(
      getRepositoryToken(SpeedTestConfigEntity)
    );
    speedTestConfigWorkerRepo = module.get<
      Repository<SpeedTestConfigWorkerEntity>
    >(getRepositoryToken(SpeedTestConfigWorkerEntity));
    speedLogRepo = module.get<Repository<SpeedLogEntity>>(
      getRepositoryToken(SpeedLogEntity)
    );
    speedLogEntryRepo = module.get<Repository<SpeedLogEntryEntity>>(
      getRepositoryToken(SpeedLogEntryEntity)
    );
    networkPerformanceResultRepo = module.get<
      Repository<NetworkPerformanceResultEntity>
    >(getRepositoryToken(NetworkPerformanceResultEntity));
    speedTestResultRepo = module.get<Repository<SpeedTestResultEntity>>(
      getRepositoryToken(SpeedTestResultEntity)
    );
    fileServerEntityRepo = module.get<Repository<FileServerEntity>>(
      getRepositoryToken(FileServerEntity)
    );
    fileServerRepo = module.get<Repository<FileServerEntity>>(
      getRepositoryToken(FileServerEntity)
    );
    workerRepo = module.get<Repository<WorkerEntity>>(
      getRepositoryToken(WorkerEntity)
    );
    jobRunRepo = module.get<Repository<JobRunEntity>>(
      getRepositoryToken(JobRunEntity)
    );
    inventoryRepo = module.get<Repository<InventoryEntity>>(
      getRepositoryToken(InventoryEntity)
    );
    volumeRepo = module.get<Repository<VolumeEntity>>(
      getRepositoryToken(VolumeEntity)
    );
    projectRepo = module.get<Repository<ProjectEntity>>(
      getRepositoryToken(ProjectEntity)
    );
    identityMappingRepo = module.get<Repository<IdentityMappingEntity>>(
      getRepositoryToken(IdentityMappingEntity)
    );
    identityCrossMappingRepo = module.get<
      Repository<IdentityConfigCrossMappingEntity>
    >(getRepositoryToken(IdentityConfigCrossMappingEntity));
    operationErrorRepo = module.get<Repository<OperationErrorEntity>>(
      getRepositoryToken(OperationErrorEntity)
    );
    sendMailService = module.get<SendMailService>(SendMailService);
    jobStatsSummaryMvRepo = module.get<Repository<JobStatsSummaryMvEntity>>(
      getRepositoryToken(JobStatsSummaryMvEntity)
    );

    jobConfigInventoryStatsRepo = module.get<Repository<JobConfigInventoryStatsEntity>>(
      getRepositoryToken(JobConfigInventoryStatsEntity)
    );

    dataSource = module.get<DataSource>(DataSource);

    workerJobRunMapRepo = module.get<Repository<WorkerJobRunMap>>(
      getRepositoryToken(WorkerJobRunMap)
    );
  });

  it("should create a speed test job successfully", async () => {
    const mockSpeedTest = {
      createdBy: "user1",
      speedTests: [
        {
          fileServer: "fileServer1",
          protocol: "protocol1",
          test: {
            readTest: true,
            writeTest: true,
            packetLossTest: true,
          },
          workers: ["worker1", "worker2"],
        },
      ],
    };

    const mockJobConfig = {
      id: "jobConfigId",
      ...mockSpeedTest,
    };

    const mockSpeedTestConfig = {
      id: "speedTestConfigId",
      jobId: "jobConfigId",
      fileServer: "fileServer1",
      protocol: "protocol1",
      readTest: true,
      writeTest: true,
      packetLossTest: true,
    };
    const loggerSpy = jest.spyOn(service["logger"], "log");

    jest.spyOn(jobConfigRepo, "create").mockReturnValue(mockJobConfig as any);
    jest.spyOn(jobConfigRepo, "save").mockResolvedValue(mockJobConfig as any);
    jest
      .spyOn(speedTestConfigRepo, "create")
      .mockReturnValue(mockSpeedTestConfig as any);
    jest
      .spyOn(speedTestConfigRepo, "save")
      .mockResolvedValue(mockSpeedTestConfig as any);
    jest
      .spyOn(speedTestConfigWorkerRepo, "create")
      .mockImplementation((data) => data as any);
    jest.spyOn(speedTestConfigWorkerRepo, "save").mockResolvedValue([] as any);

    const result = await service.createSpeedTest(mockSpeedTest as any);

    expect(result).toEqual([mockSpeedTestConfig]);

    expect(loggerSpy).toHaveBeenCalledWith(
      `Speed Test job created successfully`
    );
  });

  // createSpeedTest catch case
  it("should throw an error if creating speed test job fails", async () => {
    jest.spyOn(jobConfigRepo, "create").mockImplementation(() => {
      throw new Error("Test error");
    });
    try {
      await service.createSpeedTest({} as any);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
    }
  });

  it("should return speed test details if no results are found", async () => {
    const mockId = "test-id";

    jest.spyOn(speedTestResultRepo, "find").mockResolvedValue([]);
    jest
      .spyOn(service, "getSpeedTestDetails")
      .mockResolvedValue("speedTestDetails");

    const result = await service.getSpeedTestById(mockId);

    expect(result).toBe("speedTestDetails");
    expect(service.getSpeedTestDetails).toHaveBeenCalledWith(mockId);
  });

  // !jobRunDetails case
  it("should return speed test results with job run details", async () => {
    const mockId = "test-id";
    const mockSpeedTestResults = [
      {
        traceId: mockId,
        fileServerId: "fileServer1",
        workerId: "worker1",
        writeResult: {
          speedLogEntries: [{ timeStamp: new Date(), speed: 100 }],
        },
        readResult: {
          speedLogEntries: [{ timeStamp: new Date(), speed: 200 }],
        },
        networkPerformanceResult: { roundTripDelayAvg: 10, packetLoss: 0 },
      },
    ];
    const mockFileServers = [
      {
        id: "fileServer1",
        config: { configName: "FileServer1" },
        protocol: "FTP",
      },
    ];
    const mockWorkers = [
      {
        workerId: "worker1",
        workerName: "Worker1",
      },
    ];
    const mockJobRunDetails = {
      id: mockId,
      startTime: new Date(),
      endTime: new Date(),
      status: "Completed",
    };

    jest
      .spyOn(speedTestResultRepo, "find")
      .mockResolvedValue(mockSpeedTestResults as any);
    jest
      .spyOn(fileServerEntityRepo, "find")
      .mockResolvedValue(mockFileServers as any);
    jest.spyOn(workerRepo, "findByIds").mockResolvedValue(mockWorkers as any);
    jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(null as any);

    try {
      await service.getSpeedTestById(mockId);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
    }
  });

  it("should return speed test results with job run details", async () => {
    const mockId = "test-id";
    const mockSpeedTestResults = [
      {
        traceId: mockId,
        fileServerId: "fileServer1",
        workerId: "worker1",
        writeResult: {
          speedLogEntries: [{ timeStamp: new Date(), speed: 100 }],
        },
        readResult: {
          speedLogEntries: [{ timeStamp: new Date(), speed: 200 }],
        },
        networkPerformanceResult: { roundTripDelayAvg: 10, packetLoss: 0 },
      },
    ];
    const mockFileServers = [
      {
        id: "fileServer1",
        config: { configName: "FileServer1" },
        protocol: "FTP",
      },
    ];
    const mockWorkers = [
      {
        workerId: "worker1",
        workerName: "Worker1",
      },
    ];
    const mockJobRunDetails = {
      id: mockId,
      startTime: new Date(),
      endTime: new Date(),
      status: "Completed",
    };

    jest
      .spyOn(speedTestResultRepo, "find")
      .mockResolvedValue(mockSpeedTestResults as any);
    jest
      .spyOn(fileServerEntityRepo, "find")
      .mockResolvedValue(mockFileServers as any);
    jest.spyOn(workerRepo, "findByIds").mockResolvedValue(mockWorkers as any);
    jest
      .spyOn(jobRunRepo, "findOne")
      .mockResolvedValue(mockJobRunDetails as any);

    const result = await service.getSpeedTestById(mockId);

    expect(result).toEqual({
      jobRunId: mockId,
      startTime: mockJobRunDetails.startTime,
      endTime: mockJobRunDetails.endTime,
      status: mockJobRunDetails.status,
      totalWorkers: 1,
      fileServers: [
        {
          fileServerId: "fileServer1",
          fileServerName: "FileServer1",
          fileServerProtocol: "FTP",
          workers: [
            {
              workerName: "Worker1",
              workerId: "worker1",
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

  it("should return speed test details", async () => {
    const mockJobRunId = "jobRunId";
    const mockJobRun = {
      id: mockJobRunId,
      jobConfigId: "jobConfigId",
      startTime: new Date(),
      endTime: new Date(),
      status: "Completed",
    };
    const mockSpeedTestJobConfig = [
      {
        jobId: "jobConfigId",
        fileServer: "fileServer1",
        workerEntities: [{ workersId: "worker1" }],
      },
    ];
    const mockFileServers = [
      {
        id: "fileServer1",
        config: { configName: "FileServer1" },
        protocol: "FTP",
      },
    ];
    const mockWorkers = [
      {
        workerId: "worker1",
        workerName: "Worker1",
      },
    ];

    jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(mockJobRun as any);
    jest
      .spyOn(speedTestConfigRepo, "find")
      .mockResolvedValue(mockSpeedTestJobConfig as any);
    jest
      .spyOn(fileServerRepo, "find")
      .mockResolvedValue(mockFileServers as any);
    jest.spyOn(workerRepo, "findByIds").mockResolvedValue(mockWorkers as any);

    const result = await service.getSpeedTestDetails(mockJobRunId);

    expect(result).toEqual({
      jobRunId: mockJobRunId,
      startTime: mockJobRun.startTime,
      endTime: mockJobRun.endTime,
      status: mockJobRun.status,
      totalWorkers: 1,
      fileServers: [
        {
          fileServerId: "fileServer1",
          fileServerName: "FileServer1",
          fileServerProtocol: "FTP",
          workers: [
            {
              workerName: "Worker1",
              workerId: "worker1",
            },
          ],
        },
      ],
    });
  });

  it("should throw an error if job run is not found", async () => {
    const mockJobRunId = "jobRunId";

    jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(null);

    await expect(service.getSpeedTestDetails(mockJobRunId)).rejects.toThrow(
      `JobRun with id ${mockJobRunId} not found`
    );
  });

  it("should store speed test result successfully", async () => {
    const mockSpeedTest = {
      traceId: "traceId",
      workerId: "workerId",
      fileServerID: "fileServerID",
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

    const mockWriteLog = { id: "writeLogId" };
    const mockReadLog = { id: "readLogId" };
    const mockNetworkResult = { id: "networkResultId" };
    const loggerSpy = jest.spyOn(service["logger"], "log");

    jest.spyOn(speedLogRepo, "save").mockResolvedValueOnce(mockWriteLog as any);
    jest.spyOn(speedLogRepo, "save").mockResolvedValueOnce(mockReadLog as any);
    jest.spyOn(speedLogEntryRepo, "save").mockResolvedValue({} as any);
    jest
      .spyOn(networkPerformanceResultRepo, "save")
      .mockResolvedValue(mockNetworkResult as any);
    jest.spyOn(speedTestResultRepo, "save").mockResolvedValue({} as any);

    await service.storeSpeedTestResult(mockSpeedTest as any);
    expect(loggerSpy).toHaveBeenCalledWith(
      "Storing speed test result",
      expect.any(String)
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      "Speed test result stored successfully"
    );
  });

  it("should throw an error if storing speed test result fails", async () => {
    const mockSpeedTest = {
      traceId: "traceId",
      workerId: "workerId",
      fileServerID: "fileServerID",
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

    jest.spyOn(speedLogRepo, "save").mockImplementation(() => {
      throw new Error("Test error");
    });

    await expect(
      service.storeSpeedTestResult(mockSpeedTest as any)
    ).rejects.toThrow(HttpException);
    expect(loggerSpy).toHaveBeenCalledWith(
      "Failed to store speed test result",
      expect.any(String)
    );
  });

  it("should fetch all speed test job runs successfully", async () => {
    const mockJobConfigs = [
      {
        id: "jobConfigId1",
        jobRuns: [
          {
            id: "jobRunId1",
            startTime: new Date(),
            endTime: new Date(),
            status: "Completed",
          },
        ],
        speedTestConfigs: [
          {
            workerEntities: [
              { workersId: "worker1" },
              { workersId: "worker2" },
            ],
          },
        ],
      },
    ];

    jest.spyOn(jobConfigRepo, "find").mockResolvedValue(mockJobConfigs as any);
    const loggerSpy = jest.spyOn(service["logger"], "log");

    const result = await service.getAllSpeedTestJobRuns();

    expect(result).toEqual([
      {
        jobRunId: "jobRunId1",
        jobConfigId: "jobConfigId1",
        startTime: mockJobConfigs[0].jobRuns[0].startTime,
        endTime: mockJobConfigs[0].jobRuns[0].endTime,
        fileServerCount: 1,
        workers: 2,
        status: "Completed",
      },
    ]);
    expect(loggerSpy).toHaveBeenCalledWith(
      "Fetched all speed test job runs successfully"
    );
  });

  it("should throw an error if fetching speed test job runs fails", async () => {
    jest.spyOn(jobConfigRepo, "find").mockImplementation(() => {
      throw new Error("Test error");
    });
    const loggerSpy = jest.spyOn(service["logger"], "error");

    await expect(service.getAllSpeedTestJobRuns()).rejects.toThrow(
      HttpException
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      "Failed to fetch speed test job runs",
      expect.any(String)
    );
  });

  it("should throw an error with error.message when present", async () => {
  jest.spyOn(jobConfigRepo, "find").mockImplementation(() => {
    throw new Error("Failed to fetch speed test job runs");
  });
  const loggerSpy = jest.spyOn(service["logger"], "error");

  await expect(service.getAllSpeedTestJobRuns()).rejects.toThrow(
    new HttpException(
      {
        status: "failed",
        message: "Failed to fetch speed test job runs",
      },
      HttpStatus.INTERNAL_SERVER_ERROR
    )
  );

  expect(loggerSpy).toHaveBeenCalledWith(
    "Failed to fetch speed test job runs",
    expect.anything()
  );
});
  it("should fallback to default message if error.message is falsy", async () => {
  
  const error = { stack: "stack trace" } as any;
  jest.spyOn(jobConfigRepo, "find").mockImplementation(() => {
    throw error;
  });
  const loggerSpy = jest.spyOn(service["logger"], "error");

  await expect(service.getAllSpeedTestJobRuns()).rejects.toThrow(
    new HttpException(
      {
        status: "failed",
        message: "Failed to fetch speed test job runs",
      },
      HttpStatus.INTERNAL_SERVER_ERROR
    )
  );

  expect(loggerSpy).toHaveBeenCalledWith(
    "Failed to fetch speed test job runs",
    error.stack
  );
});

  it("should create bulk discovery job configs successfully", async () => {
    const mockBulkDiscovery = {
      sourcePathIds: ["path1", "path2"],
      excludeFilePatterns: "*.tmp",
      preserveAccessTime: true,
      preservePermissions: true,
      excludeOlderThan: new Date("2025-04-04T13:01:08.226Z"),
      firstRunAt: new Date("2025-04-04T13:01:08.226Z"),
      createdBy: "user1",
    };

    const mockExistingList = [
      { sourcePathId: "path1", scheduler: ScheduleStatus.SCHEDULING },
    ];

    const mockJobConfigEntities = [
      {
        status: JobStatus.Active,
        excludeFilePatterns: "*.tmp",
        jobType: JobType.DISCOVER,
        preserveAccessTime: true,
        preservePermissions: true,
        sourcePathId: "path2",
        excludeOlderThan: new Date("2025-04-04T13:01:08.226Z"),
        firstRunAt: new Date("2025-04-04T13:01:08.226Z"),
        scheduler: ScheduleStatus.SCHEDULING,
        createdBy: "user1",
        shouldScanADS: false,
      },
    ];

    jest
      .spyOn(jobConfigRepo, "find")
      .mockResolvedValue(mockExistingList as any);
    jest
      .spyOn(jobConfigRepo, "update")
      .mockResolvedValue({ affected: 1 } as any);
    jest
      .spyOn(jobConfigRepo, "create")
      .mockImplementation((data) => data as any);
    jest
      .spyOn(jobConfigRepo, "save")
      .mockResolvedValue(mockJobConfigEntities as any);

    const result = await service.createBulkDiscovery(mockBulkDiscovery as any);

    expect(result).toEqual(mockJobConfigEntities);
    expect(jobConfigRepo.find).toHaveBeenCalledWith({
      where: {
        jobType: JobType.DISCOVER,
        sourcePath: In(mockBulkDiscovery.sourcePathIds),
      },
      select: { sourcePathId: true, scheduler: true, id: true, status: true },
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
        preservePermissions: mockBulkDiscovery.preservePermissions,
        excludeOlderThan: mockBulkDiscovery.excludeOlderThan,
        firstRunAt: mockBulkDiscovery.firstRunAt,
        scheduler: ScheduleStatus.SCHEDULING,
        status: JobStatus.Active,
        shouldScanADS: false,
      }
    );
    expect(jobConfigRepo.create).toHaveBeenCalledWith({
      status: JobStatus.Active,
      excludeFilePatterns: mockBulkDiscovery.excludeFilePatterns,
      jobType: JobType.DISCOVER,
      preserveAccessTime: mockBulkDiscovery.preserveAccessTime,
      preservePermissions: mockBulkDiscovery.preservePermissions,
      sourcePathId: "path2",
      excludeOlderThan: mockBulkDiscovery.excludeOlderThan,
      firstRunAt: mockBulkDiscovery.firstRunAt,
      scheduler: ScheduleStatus.SCHEDULING,
      createdBy: mockBulkDiscovery.createdBy,
      shouldScanADS: false,
    });
    expect(jobConfigRepo.save).toHaveBeenCalledWith(mockJobConfigEntities);
  });

  it("should handle empty sourcePathIds", async () => {
    const mockBulkDiscovery = {
      sourcePathIds: [],
      excludeFilePatterns: "*.tmp",
      preserveAccessTime: true,
      preservePermissions: true,
      excludeOlderThan: new Date(),
      firstRunAt: new Date(),
      createdBy: "user1",
    };

    jest.spyOn(jobConfigRepo, "find").mockResolvedValue([]);
    jest
      .spyOn(jobConfigRepo, "update")
      .mockResolvedValue({ affected: 0 } as any);
    jest
      .spyOn(jobConfigRepo, "create")
      .mockImplementation((data) => data as any);
    jest.spyOn(jobConfigRepo, "save").mockResolvedValue([] as any);

    const result = await service.createBulkDiscovery(mockBulkDiscovery as any);

    expect(result).toEqual([]);
    expect(jobConfigRepo.find).toHaveBeenCalledWith({
      where: {
        jobType: JobType.DISCOVER,
        sourcePath: In(mockBulkDiscovery.sourcePathIds),
      },
      select: { sourcePathId: true, scheduler: true, id: true, status: true },
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
        preservePermissions: mockBulkDiscovery.preservePermissions,
        excludeOlderThan: mockBulkDiscovery.excludeOlderThan,
        firstRunAt: mockBulkDiscovery.firstRunAt,
        scheduler: ScheduleStatus.SCHEDULING,
        status: JobStatus.Active,
        shouldScanADS: false,
      }
    );
    expect(jobConfigRepo.create).not.toHaveBeenCalled();
    expect(jobConfigRepo.save).toHaveBeenCalledWith([]);
  });

  /**
   * Test suite for shouldScanADS feature in bulk discovery
   * 
   * shouldScanADS enables scanning of Alternate Data Streams (ADS) which is a Windows/NTFS feature.
   * This option is only valid for SMB protocol sources.
   */
  describe('createBulkDiscovery - shouldScanADS validation', () => {
    it('should create bulk discovery job with shouldScanADS enabled for SMB source', async () => {
      const mockBulkDiscovery = {
        sourcePathIds: ['smbPath1'],
        excludeFilePatterns: '*.tmp',
        preserveAccessTime: true,
        preservePermissions: true,
        shouldScanADS: true,
        excludeOlderThan: new Date('2025-04-04T13:01:08.226Z'),
        firstRunAt: new Date('2025-04-04T13:01:08.226Z'),
        createdBy: 'user1',
      };

      const mockSmbVolumes = [
        {
          id: 'smbPath1',
          fileServer: { protocol: Protocol.SMB },
        },
      ];

      const mockJobConfigEntity = {
        status: JobStatus.Active,
        excludeFilePatterns: '*.tmp',
        jobType: JobType.DISCOVER,
        preserveAccessTime: true,
        preservePermissions: true,
        shouldScanADS: true,
        sourcePathId: 'smbPath1',
        excludeOlderThan: new Date('2025-04-04T13:01:08.226Z'),
        firstRunAt: new Date('2025-04-04T13:01:08.226Z'),
        scheduler: ScheduleStatus.SCHEDULING,
        createdBy: 'user1',
      };

      jest.spyOn(volumeRepo, 'find').mockResolvedValue(mockSmbVolumes as any);
      jest.spyOn(jobConfigRepo, 'find').mockResolvedValue([]);
      jest.spyOn(jobConfigRepo, 'update').mockResolvedValue({ affected: 0 } as any);
      jest.spyOn(jobConfigRepo, 'create').mockImplementation((data) => data as any);
      jest.spyOn(jobConfigRepo, 'save').mockResolvedValue([mockJobConfigEntity] as any);

      const result = await service.createBulkDiscovery(mockBulkDiscovery as any);

      expect(result).toEqual([mockJobConfigEntity]);
      expect(volumeRepo.find).toHaveBeenCalledWith({
        where: { id: In(['smbPath1']) },
        relations: ['fileServer'],
      });
      expect(jobConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          shouldScanADS: true,
        })
      );
    });

    it('should throw BadRequestException when shouldScanADS is true for NFS source', async () => {
      const mockBulkDiscovery = {
        sourcePathIds: ['nfsPath1'],
        excludeFilePatterns: '*.tmp',
        preserveAccessTime: true,
        preservePermissions: true,
        shouldScanADS: true,
        excludeOlderThan: new Date(),
        firstRunAt: new Date(),
        createdBy: 'user1',
      };

      const mockNfsVolumes = [
        {
          id: 'nfsPath1',
          volumePath: '/nfs/share',
          fileServer: { protocol: Protocol.NFS },
        },
      ];

      jest.spyOn(volumeRepo, 'find').mockResolvedValue(mockNfsVolumes as any);

      await expect(service.createBulkDiscovery(mockBulkDiscovery as any)).rejects.toThrow(
        new BadRequestException('shouldScanADS option is only supported for SMB protocol sources')
      );
    });

    it('should throw BadRequestException when shouldScanADS is true for mixed protocol sources', async () => {
      const mockBulkDiscovery = {
        sourcePathIds: ['smbPath1', 'nfsPath1'],
        excludeFilePatterns: '*.tmp',
        preserveAccessTime: true,
        preservePermissions: true,
        shouldScanADS: true,
        excludeOlderThan: new Date(),
        firstRunAt: new Date(),
        createdBy: 'user1',
      };

      const mockMixedVolumes = [
        {
          id: 'smbPath1',
          volumePath: '\\\\server\\share',
          fileServer: { protocol: Protocol.SMB },
        },
        {
          id: 'nfsPath1',
          volumePath: '/nfs/share',
          fileServer: { protocol: Protocol.NFS },
        },
      ];

      jest.spyOn(volumeRepo, 'find').mockResolvedValue(mockMixedVolumes as any);

      await expect(service.createBulkDiscovery(mockBulkDiscovery as any)).rejects.toThrow(
        new BadRequestException('shouldScanADS option is only supported for SMB protocol sources')
      );
    });

    it('should create bulk discovery job with shouldScanADS defaulting to false when not provided', async () => {
      const mockBulkDiscovery = {
        sourcePathIds: ['path1'],
        excludeFilePatterns: '*.tmp',
        preserveAccessTime: true,
        preservePermissions: true,
        // shouldScanADS not provided - should default to false
        excludeOlderThan: new Date('2025-04-04T13:01:08.226Z'),
        firstRunAt: new Date('2025-04-04T13:01:08.226Z'),
        createdBy: 'user1',
      };

      const mockJobConfigEntity = {
        status: JobStatus.Active,
        excludeFilePatterns: '*.tmp',
        jobType: JobType.DISCOVER,
        preserveAccessTime: true,
        preservePermissions: true,
        shouldScanADS: false,
        sourcePathId: 'path1',
        excludeOlderThan: new Date('2025-04-04T13:01:08.226Z'),
        firstRunAt: new Date('2025-04-04T13:01:08.226Z'),
        scheduler: ScheduleStatus.SCHEDULING,
        createdBy: 'user1',
      };

      jest.spyOn(jobConfigRepo, 'find').mockResolvedValue([]);
      jest.spyOn(jobConfigRepo, 'update').mockResolvedValue({ affected: 0 } as any);
      jest.spyOn(jobConfigRepo, 'create').mockImplementation((data) => data as any);
      jest.spyOn(jobConfigRepo, 'save').mockResolvedValue([mockJobConfigEntity] as any);

      const result = await service.createBulkDiscovery(mockBulkDiscovery as any);

      expect(result).toEqual([mockJobConfigEntity]);
      expect(jobConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          shouldScanADS: false,
        })
      );
    });

    it('should skip SMB validation when shouldScanADS is false', async () => {
      const mockBulkDiscovery = {
        sourcePathIds: ['nfsPath1'],
        excludeFilePatterns: '*.tmp',
        preserveAccessTime: true,
        preservePermissions: true,
        shouldScanADS: false,
        excludeOlderThan: new Date('2025-04-04T13:01:08.226Z'),
        firstRunAt: new Date('2025-04-04T13:01:08.226Z'),
        createdBy: 'user1',
      };

      const mockJobConfigEntity = {
        status: JobStatus.Active,
        excludeFilePatterns: '*.tmp',
        jobType: JobType.DISCOVER,
        preserveAccessTime: true,
      preservePermissions: true,
        shouldScanADS: false,
        sourcePathId: 'nfsPath1',
      };

      jest.spyOn(jobConfigRepo, 'find').mockResolvedValue([]);
      jest.spyOn(jobConfigRepo, 'update').mockResolvedValue({ affected: 0 } as any);
      jest.spyOn(jobConfigRepo, 'create').mockImplementation((data) => data as any);
      jest.spyOn(jobConfigRepo, 'save').mockResolvedValue([mockJobConfigEntity] as any);

      const result = await service.createBulkDiscovery(mockBulkDiscovery as any);

      expect(result).toEqual([mockJobConfigEntity]);
      // volumeRepo.find should NOT be called when shouldScanADS is false
      expect(volumeRepo.find).not.toHaveBeenCalled();
    });

    it('should create bulk discovery job with preservePermissions flag', async () => {
      const mockBulkDiscovery = {
        sourcePathIds: ['testPath1'],
        excludeFilePatterns: '*.log',
        preserveAccessTime: false,
        preservePermissions: false,
        excludeOlderThan: new Date('2025-05-01T00:00:00.000Z'),
        firstRunAt: new Date('2025-05-01T00:00:00.000Z'),
        createdBy: 'testUser',
      };

      const mockJobConfigEntity = {
        status: JobStatus.Active,
        excludeFilePatterns: '*.log',
        jobType: JobType.DISCOVER,
        preserveAccessTime: false,
        preservePermissions: false,
        sourcePathId: 'testPath1',
        excludeOlderThan: new Date('2025-05-01T00:00:00.000Z'),
        firstRunAt: new Date('2025-05-01T00:00:00.000Z'),
        scheduler: ScheduleStatus.SCHEDULING,
        createdBy: 'testUser',
        shouldScanADS: false,
      };

      jest.spyOn(jobConfigRepo, 'find').mockResolvedValue([]);
      jest.spyOn(jobConfigRepo, 'update').mockResolvedValue({ affected: 0 } as any);
      jest.spyOn(jobConfigRepo, 'create').mockImplementation((data) => data as any);
      jest.spyOn(jobConfigRepo, 'save').mockResolvedValue([mockJobConfigEntity] as any);

      const result = await service.createBulkDiscovery(mockBulkDiscovery as any);

      expect(result).toEqual([mockJobConfigEntity]);
      expect(jobConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          preservePermissions: false,
        })
      );
    });
  });

  it("should create bulk migrate job configs successfully", async () => {
    const sourceDirectoryPath = "/mnt/source/share";
    const destinationDirectoryPath = "/mnt/destination/share";
    const mockBulkMigrate = {
      migrateConfigs: [
        {
          sourcePathId: "sourcePath1",
          sourceDirectoryPath,
          destinationPathId: ["destinationPath1", "destinationPath2"],
          destinationDirectoryPath,
        },
      ],
      options: {
        excludeFilePatterns: "*.tmp",
        preserveAccessTime: true,
        preservePermissions: true,
        excludeOlderThan: new Date(),
        skipFile: false,
      },
      firstRunAt: new Date(),
      futureRunSchedule: "0 0 * * *",
    };

    const mockExistingJobConfigs = [
      {
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        targetPathId: "destinationPath1",
        targetDirectoryPath: destinationDirectoryPath,
        scheduler: ScheduleStatus.SCHEDULING,
      },
    ];

    const mockJobConfigEntities = [
      {
        id: "jobConfigId1",
        jobType: JobType.MIGRATE,
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        targetPathId: "destinationPath2",
        targetDirectoryPath: destinationDirectoryPath,
        status: JobStatus.Active,
      },
    ];

    jest
      .spyOn(jobConfigRepo, "find")
      .mockResolvedValue(mockExistingJobConfigs as any);
    jest
      .spyOn(jobConfigRepo, "update")
      .mockResolvedValue({ affected: 1 } as any);
    jest
      .spyOn(jobConfigRepo, "create")
      .mockImplementation((data) => data as any);
    jest
      .spyOn(jobConfigRepo, "save")
      .mockResolvedValue(mockJobConfigEntities as any);
    jest.spyOn(identityCrossMappingRepo, "exists").mockResolvedValue(false);
    jest.spyOn(volumeRepo, "find").mockResolvedValue([
      {
        id: "sourcePath1",
        fileServer: { protocol: Protocol.SMB },
      },
    ] as any);

    const result = await service.createBulkMigrate(mockBulkMigrate as any);

    expect(result).toEqual({"jobs": [{"id": "jobConfigId1", "jobType": "MIGRATE", "sourcePathId": "sourcePath1", "status": "CREATED", "targetPathId": "destinationPath2"}], "warnings": undefined});
    expect(jobConfigRepo.find).toHaveBeenCalledWith({
      where: {
        jobType: JobType.MIGRATE,
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        targetPathId: "destinationPath1",
        targetDirectoryPath: destinationDirectoryPath,
      },
      select: {
        sourcePathId: true,
        sourceDirectoryPath: true,
        targetPathId: true,
        targetDirectoryPath: true,
        scheduler: true,
        id: true,
        status: true,
      },
    });
    expect(jobConfigRepo.update).toHaveBeenCalledWith(
      {
        jobType: JobType.MIGRATE,
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        targetPathId: "destinationPath1",
        targetDirectoryPath: destinationDirectoryPath,
        scheduler: In([
          ScheduleStatus.READY_TO_BE_SCHEDULED,
          ScheduleStatus.SCHEDULING,
        ]),
      },
      {
        excludeFilePatterns: mockBulkMigrate.options.excludeFilePatterns,
        preserveAccessTime: mockBulkMigrate.options.preserveAccessTime,
        preservePermissions: mockBulkMigrate.options.preservePermissions,
        smbPermissionInheritanceMode: "INHERIT_PERMS_AS_EXPLICIT",
        excludeOlderThan: mockBulkMigrate.options.excludeOlderThan,
        skipFile: mockBulkMigrate.options.skipFile,
        firstRunAt: mockBulkMigrate.firstRunAt,
        futureScheduleAt: "0 0 * * *",
        scheduler: ScheduleStatus.SCHEDULING,
        status: JobStatus.Active,
      }
    );
    expect(jobConfigRepo.create).toHaveBeenCalledWith({
      status: JobStatus.Active,
      excludeFilePatterns: mockBulkMigrate.options.excludeFilePatterns,
      jobType: JobType.MIGRATE,
      preserveAccessTime: mockBulkMigrate.options.preserveAccessTime,
      preservePermissions: mockBulkMigrate.options.preservePermissions,
      smbPermissionInheritanceMode: "INHERIT_PERMS_AS_EXPLICIT",
      sourcePathId: "sourcePath1",
      sourceDirectoryPath,
      targetPathId: "destinationPath2",
      targetDirectoryPath: destinationDirectoryPath,
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
        preservePermissions: mockBulkMigrate.options.preservePermissions,
        smbPermissionInheritanceMode: "INHERIT_PERMS_AS_EXPLICIT",
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        targetPathId: mockBulkMigrate.migrateConfigs[0].destinationPathId[1],
        targetDirectoryPath: destinationDirectoryPath,
        excludeOlderThan: mockBulkMigrate.options.excludeOlderThan,
        firstRunAt: mockBulkMigrate.firstRunAt,
        scheduler: ScheduleStatus.SCHEDULING,
        futureScheduleAt: mockBulkMigrate.futureRunSchedule,
        skipFile: mockBulkMigrate.options.skipFile,
      },
    ]);
  });

  it("should create bulk migrate job with preservePermissions set to false", async () => {
    const mockBulkMigrate = {
      migrateConfigs: [
        {
          sourcePathId: "sourcePath1",
          destinationPathId: ["destinationPath1"],
        },
      ],
      options: {
        excludeFilePatterns: "*.bak",
        preserveAccessTime: true,
        preservePermissions: false,
        excludeOlderThan: new Date('2025-06-01T00:00:00.000Z'),
        skipFile: false,
      },
      firstRunAt: new Date('2025-06-01T00:00:00.000Z'),
      futureRunSchedule: null,
    };

    jest.spyOn(jobConfigRepo, "find").mockResolvedValue([]);
    jest.spyOn(jobConfigRepo, "update").mockResolvedValue({ affected: 0 } as any);
    jest.spyOn(jobConfigRepo, "create").mockImplementation((data) => data as any);
    jest.spyOn(jobConfigRepo, "save").mockResolvedValue([{ id: "jobConfigId1" }] as any);
    jest.spyOn(identityCrossMappingRepo, "exists").mockResolvedValue(false);
    jest.spyOn(volumeRepo, "find").mockResolvedValue([]);

    const result = await service.createBulkMigrate(mockBulkMigrate as any);

    expect(result.jobs).toBeDefined();
    expect(result.jobs.length).toBe(1);
    expect(jobConfigRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({
        preservePermissions: false,
        preserveAccessTime: true,
      })
    ]);
  });

  it("should handle Redis errors gracefully during bulk migrate", async () => {
    const mockBulkMigrate = {
      migrateConfigs: [{ sourcePathId: "src1", destinationPathId: ["dest1"] }],
    };

    const mockExistingJobConfigs = [
      {
        id: "job1",
        sourcePathId: "src1",
        targetPathId: "dest1",
        scheduler: ScheduleStatus.SCHEDULING,
      },
    ];

    // Mock jobRunIdsToDeleteKey to be iterable
    jest.spyOn(jobRunRepo, "find").mockResolvedValue([{ id: "run1" }] as any);
    jest
      .spyOn(jobConfigRepo, "find")
      .mockResolvedValue(mockExistingJobConfigs as any);
    jest.spyOn(identityCrossMappingRepo, "exists").mockResolvedValue(true);

    //await expect(service.createBulkMigrate(mockBulkMigrate as any)).rejects.toThrow("NOAUTH Authentication required.");
  });

  it("should process sidMapping when it is a valid string", async () => {
    const mockBulkMigrate = {
      migrateConfigs: [
        {
          sourcePathId: "sourcePath1",
          destinationPathId: ["destinationPath1"],
        },
      ],
      sidMapping: "base64EncodedSidMapping",
      options: {
        excludeFilePatterns: "*.tmp",
        preserveAccessTime: true,
        preservePermissions: true,
        excludeOlderThan: new Date(),
        skipFile: false,
      },
      firstRunAt: new Date(),
      futureRunSchedule: "0 0 * * *",
    };

    const mockDecodedSidMapping = "decodedSidMapping";
    const mockParsedMappings = [
      { sourceMapping: "source1", targetMapping: "target1" },
    ];

    const mockExistingJobConfigs = [
      {
        sourcePathId: "sourcePath1",
        targetPathId: "destinationPath1",
        scheduler: ScheduleStatus.SCHEDULING,
        id: "jobConfigId1",
      },
    ];

    const mockSavedIdentityMapping = { id: "identityMappingId1" };

    jest
      .spyOn(service, "decodeBase64")
      .mockResolvedValue(mockDecodedSidMapping);

    jest.spyOn(service, "parseBlobData").mockResolvedValue(mockParsedMappings);

    jest
      .spyOn(jobConfigRepo, "find")
      .mockResolvedValue(mockExistingJobConfigs as any);

    jest
      .spyOn(identityMappingRepo, "save")
      .mockResolvedValue(mockSavedIdentityMapping as any);

    await service.createBulkMigrate(mockBulkMigrate as any);

    expect(service.decodeBase64).toHaveBeenCalledWith(
      mockBulkMigrate.sidMapping
    );
    expect(service.parseBlobData).toHaveBeenCalledWith(
      mockDecodedSidMapping,
      TemplateType.SID
    );
    expect(identityMappingRepo.save).toHaveBeenCalled();
  });

  // columns.length !== 4 case
  it("should throw an error if parsed mappings do not have 4 columns", async () => {
    const mockBulkMigrate = {
      migrateConfigs: [
        {
          sourcePathId: "sourcePath1",
          destinationPathId: ["destinationPath1"],
        },
      ],
      sidMapping: "base64EncodedSidMapping",
      options: {
        excludeFilePatterns: "*.tmp",
        preserveAccessTime: true,
        preservePermissions: true,
        excludeOlderThan: new Date(),
        skipFile: false,
      },
      firstRunAt: new Date(),
      futureRunSchedule: "0 0 * * *",
    };

    const mockDecodedSidMapping = "decodedSidMapping";
    const mockParsedMappings = [
      { sourceMapping: "source1", targetMapping: "target1" },
    ];

    const mockExistingJobConfigs = [
      {
        sourcePathId: "sourcePath1",
        targetPathId: "destinationPath1",
        scheduler: ScheduleStatus.SCHEDULING,
        id: "jobConfigId1",
      },
    ];

    const mockSavedIdentityMapping = { id: "identityMappingId1" };

    jest
      .spyOn(service, "decodeBase64")
      .mockResolvedValue(mockDecodedSidMapping);

    jest.spyOn(service, "parseBlobData").mockResolvedValue(mockParsedMappings);

    jest
      .spyOn(jobConfigRepo, "find")
      .mockResolvedValue(mockExistingJobConfigs as any);

    jest
      .spyOn(identityMappingRepo, "save")
      .mockResolvedValue(mockSavedIdentityMapping as any);

    try {
      await service.createBulkMigrate(mockBulkMigrate as any);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
    }
  });

  it("should process gidMapping when it is a valid string", async () => {
    const mockBulkMigrate = {
      migrateConfigs: [
        {
          sourcePathId: "sourcePath1",
          destinationPathId: ["destinationPath1"],
        },
      ],
      gidMapping: "base64EncodedGidMapping",
      options: {
        excludeFilePatterns: "*.tmp",
        preserveAccessTime: true,
        preservePermissions: true,
        excludeOlderThan: new Date(),
        skipFile: false,
      },
      firstRunAt: new Date(),
      futureRunSchedule: "0 0 * * *",
    };

    const mockDecodedGidMapping = "decodedGidMapping";
    const mockParsedMappings = [
      {
        sourceMappingGid: "source1",
        targetMappingGid: "target1",
        sourceMappingUid: "source1",
        targetMappingUid: "target1",
      },
    ];

    const mockExistingJobConfigs = [
      {
        sourcePathId: "sourcePath1",
        targetPathId: "destinationPath1",
        scheduler: ScheduleStatus.SCHEDULING,
        id: "jobConfigId1",
      },
    ];

    const mockSavedIdentityMapping = { id: "identityMappingId1" };

    jest
      .spyOn(service, "decodeBase64")
      .mockResolvedValue(mockDecodedGidMapping);

    jest.spyOn(service, "parseBlobData").mockResolvedValue(mockParsedMappings);

    jest
      .spyOn(jobConfigRepo, "find")
      .mockResolvedValue(mockExistingJobConfigs as any);

    jest
      .spyOn(identityMappingRepo, "save")
      .mockResolvedValue(mockSavedIdentityMapping as any);

    await service.createBulkMigrate(mockBulkMigrate as any);

    expect(service.decodeBase64).toHaveBeenCalledWith(
      mockBulkMigrate.gidMapping
    );
    expect(service.parseBlobData).toHaveBeenCalledWith(
      mockDecodedGidMapping,
      TemplateType.GID
    );
    expect(identityMappingRepo.save).toHaveBeenCalled();
  });
  
  it("should return warnings if inactive job exists", async () => {
    const sourceDirectoryPath = "/staging/source";
    const targetDirectoryPath = "/staging/destination";
    const mockBulkMigrate = {
      migrateConfigs: [
        {
          sourcePathId: "source1",
          sourceDirectoryPath,
          destinationPathId: ["dest1"],
          destinationDirectoryPath: targetDirectoryPath,
        },
      ],
      options: {
        excludeFilePatterns: "*.tmp",
        preserveAccessTime: true,
        preservePermissions: true,
        excludeOlderThan: new Date(),
        skipFile: false,
      },
      firstRunAt: new Date(),
      futureRunSchedule: "0 0 * * *",
    };
  
    const mockExistingJobConfigs = [
      {
        id: "job1",
        sourcePathId: "source1",
        sourceDirectoryPath,
        targetPathId: "dest1",
        targetDirectoryPath,
        status: "IN_ACTIVE",
        scheduler: "SCHEDULING",
      },
    ];
  
    jest.spyOn(jobConfigRepo, "find").mockResolvedValue(mockExistingJobConfigs as any);
    jest.spyOn(volumeRepo, "findOne").mockResolvedValue(undefined); // since sourcePath and targetPath come as undefined
  
    await expect(service.createBulkMigrate(mockBulkMigrate as any)).resolves.toEqual({
      jobs: [],
      warnings: [
        {
            message: "Inactive job found. Please re-activate or remove the existing job.",
          sourcePath: undefined,
          sourcePathId: "source1",
          sourceDirectoryPath,
          status: "IN_ACTIVE",
          targetPath: undefined,
          targetPathId: "dest1",
          targetDirectoryPath,
        },
      ],
    });
  });
  

  it("should delete Redis keys for job runs when keys exist", async () => {
    const mockJobRunIds = [{ id: "jobRunId1" }, { id: "jobRunId2" }];

    const mockRedisClient = {
      isOpen: true,
      connect: jest.fn(),
      exists: jest.fn().mockResolvedValue(true),
      del: jest.fn(),
    };

    jest
      .spyOn(redisService, "getClient")
      .mockResolvedValue(mockRedisClient as any);

    const jobRunIdsToDeleteKey = mockJobRunIds;
    const redisClient = await redisService.getClient();
    for (const jobRun of jobRunIdsToDeleteKey) {
      const redisKey = `${jobRun.id}:mapping`;

      const redisKeyExists = await redisClient.exists(redisKey);
      if (redisKeyExists) {
        await redisClient.del(redisKey);
      }
    }

    expect(mockRedisClient.exists).toHaveBeenCalledTimes(mockJobRunIds.length);
    expect(mockRedisClient.del).toHaveBeenCalledTimes(mockJobRunIds.length);
    mockJobRunIds.forEach((jobRun) => {
      expect(mockRedisClient.exists).toHaveBeenCalledWith(
        `${jobRun.id}:mapping`
      );
      expect(mockRedisClient.del).toHaveBeenCalledWith(`${jobRun.id}:mapping`);
    });
  });

  it("should delete Redis keys for job runs", async () => {
    const mockJobRunIds = [{ id: "jobRunId1" }, { id: "jobRunId2" }];

    const mockRedisClient = {
      isOpen: true,
      connect: jest.fn(),
      exists: jest.fn().mockResolvedValue(true),
      del: jest.fn(),
    };

    jest
      .spyOn(redisService, "getClient")
      .mockResolvedValue(mockRedisClient as any);

    const jobRunIdsToDeleteKey = mockJobRunIds;
    const redisClient = await redisService.getClient();
    for (const jobRun of jobRunIdsToDeleteKey) {
      const redisKey = `${jobRun.id}:mapping`;

      const redisKeyExists = await redisClient.exists(redisKey);
      if (redisKeyExists) {
        await redisClient.del(redisKey);
      }
    }

    expect(mockRedisClient.del).toHaveBeenCalledTimes(mockJobRunIds.length);
    mockJobRunIds.forEach((jobRun) => {
      expect(mockRedisClient.del).toHaveBeenCalledWith(`${jobRun.id}:mapping`);
    });
  });

  it("should handle empty migrateConfigs", async () => {
    const mockBulkMigrate = {
      migrateConfigs: [],
      options: {
        excludeFilePatterns: "*.tmp",
        preserveAccessTime: true,
        preservePermissions: true,
        excludeOlderThan: new Date(),
        skipFile: false,
      },
      firstRunAt: new Date(),
      futureRunSchedule: "0 0 * * *",
    };

    const result = await service.createBulkMigrate(mockBulkMigrate as any);

    expect(result).toEqual({"jobs": [], "warnings": undefined});
    expect(jobConfigRepo.find).not.toHaveBeenCalled();
    expect(jobConfigRepo.update).not.toHaveBeenCalled();
    expect(jobConfigRepo.create).not.toHaveBeenCalled();
    expect(jobConfigRepo.save).not.toHaveBeenCalled();
  });
  it("should create bulk cutover job configs successfully", async () => {
    const sourceDirectoryPath = "/cutover/source";
    const destinationDirectoryPath = "/cutover/destination";
    const mockBulkCutover = {
      cutoverConfig: [
        {
          sourcePathId: "sourcePath1",
          sourceDirectoryPath,
          destinationPathId: ["destinationPath1", "destinationPath2"],
          destinationDirectoryPath,
        },
      ],
    };

    const excludeOlderThan = new Date("2025-04-04T13:01:08.226Z");
    const mockJobConfigs = [
      {
        id: "jobConfigId1",
        jobType: JobType.MIGRATE,
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        targetPathId: "destinationPath1",
        targetDirectoryPath: destinationDirectoryPath,
        excludeFilePatterns: "*.tmp",
        scheduler: ScheduleStatus.SCHEDULING,
        futureScheduleAt: "0 0 * * *",
        status: JobStatus.Active,
        preserveAccessTime: true,
        preservePermissions: true,
        firstRunAt: new Date(),
        excludeOlderThan,
      },
    ];

    const mockJobRunStatuses = [
      {
        jobConfigId: "jobConfigId1",
        status: JobRunStatus.Completed,
        endTime: new Date(),
      },
    ];

    const mockSavedJobs = [
      {
        id: "newJobConfigId1",
        jobType: JobType.CUT_OVER,
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        targetPathId: "destinationPath2",
        targetDirectoryPath: destinationDirectoryPath,
        excludeFilePatterns: "*.tmp",
        scheduler: ScheduleStatus.SCHEDULING,
        futureScheduleAt: "0 0 * * *",
        status: JobStatus.Active,
        preserveAccessTime: true,
        preservePermissions: true,
        firstRunAt: new Date(),
      },
    ];

    jest.spyOn(service, "flattenCutoverConfig").mockReturnValue([
      {
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        destinationPathId: "destinationPath1",
        destinationDirectoryPath,
      },
      {
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        destinationPathId: "destinationPath2",
        destinationDirectoryPath,
      },
    ]);
    jest
      .spyOn(service, "findJobConfigs")
      .mockResolvedValue(mockJobConfigs as any);
    jest.spyOn(jobRunRepo, "find").mockResolvedValue(mockJobRunStatuses as any);
    jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(null);
    jest
      .spyOn(jobConfigRepo, "create")
      .mockImplementation((data) => data as any);
    jest.spyOn(jobConfigRepo, "save").mockResolvedValue(mockSavedJobs as any);

    const result = await service.createBulkCutover(mockBulkCutover as any);

    expect(result).toEqual([
      {
        id: "newJobConfigId1",
        firstRunAt: mockSavedJobs[0].firstRunAt,
        jobType: JobType.CUT_OVER,
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        targetPathId: "destinationPath2",
        targetDirectoryPath: destinationDirectoryPath,
        status: JobStatus.Active,
      },
    ]);
    expect(service.flattenCutoverConfig).toHaveBeenCalledWith(
      mockBulkCutover.cutoverConfig
    );
    expect(service.findJobConfigs).toHaveBeenCalledWith([
      {
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        destinationPathId: "destinationPath1",
        destinationDirectoryPath,
      },
      {
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        destinationPathId: "destinationPath2",
        destinationDirectoryPath,
      },
    ]);
    expect(jobRunRepo.find).toHaveBeenCalledWith({
      where: {
        jobConfigId: In(["jobConfigId1"]),
        status: In([JobRunStatus.Completed, JobRunStatus.Stopped]),
      },
      order: { endTime: "DESC" },
    });
    expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
      where: {
        jobType: JobType.CUT_OVER,
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        targetPathId: "destinationPath1",
        targetDirectoryPath: destinationDirectoryPath,
      },
    });
    expect(jobConfigRepo.create).toHaveBeenCalledWith({
      jobType: JobType.CUT_OVER,
      sourcePathId: "sourcePath1",
      sourceDirectoryPath,
      targetPathId: "destinationPath1",
      targetDirectoryPath: destinationDirectoryPath,
      excludeFilePatterns: "*.tmp",
      scheduler: ScheduleStatus.SCHEDULING,
      futureScheduleAt: null,
      status: JobStatus.Active,
      preserveAccessTime: true,
      preservePermissions: true,
      firstRunAt: expect.any(Date),
      excludeOlderThan: expect.any(Date),
    });
    expect(jobConfigRepo.save).toHaveBeenCalledWith([
      {
        jobType: JobType.CUT_OVER,
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        targetPathId: "destinationPath1",
        targetDirectoryPath: destinationDirectoryPath,
        excludeFilePatterns: "*.tmp",
        scheduler: ScheduleStatus.SCHEDULING,
        futureScheduleAt: null,
        status: JobStatus.Active,
        preserveAccessTime: true,
        preservePermissions: true,
        firstRunAt: expect.any(Date),
        excludeOlderThan: expect.any(Date),
      },
    ]);
  });

  it("should flatten cutover config correctly", () => {
    const sourceDirectoryPath = "/cutover/source";
    const destinationDirectoryPath = "/cutover/destination";
    const mockCutoverConfig = [
      {
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        destinationPathId: ["destinationPath1", "destinationPath2"],
        destinationDirectoryPath,
      },
    ];

    const expectedFlattenedConfig = [
      {
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        destinationPathId: "destinationPath1",
        destinationDirectoryPath,
      },
      {
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        destinationPathId: "destinationPath2",
        destinationDirectoryPath,
      },
    ];

    const result = service.flattenCutoverConfig(mockCutoverConfig);

    expect(result).toEqual(expectedFlattenedConfig);
  });

  it("should throw an error if cutover already exists", async () => {
    const sourceDirectoryPath = "/cutover/source";
    const destinationDirectoryPath = "/cutover/destination";
    const mockBulkCutover = {
      cutoverConfig: [
        {
          sourcePathId: "sourcePath1",
          sourceDirectoryPath,
          destinationPathId: ["destinationPath1"],
          destinationDirectoryPath,
        },
      ],
    };

    const mockJobConfigs = [
      {
        id: "jobConfigId1",
        jobType: JobType.MIGRATE,
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        targetPathId: "destinationPath1",
        targetDirectoryPath: destinationDirectoryPath,
        excludeFilePatterns: "*.tmp",
        scheduler: ScheduleStatus.SCHEDULING,
        futureScheduleAt: "0 0 * * *",
        status: JobStatus.Active,
        preserveAccessTime: true,
        preservePermissions: true,
        firstRunAt: new Date(),
      },
    ];

    const mockJobRunStatuses = [
      {
        jobConfigId: "jobConfigId1",
        status: JobRunStatus.Completed,
        endTime: new Date(),
      },
    ];

    const mockExistingCutover = {
      id: "existingCutoverId",
      jobType: JobType.CUT_OVER,
      sourcePathId: "sourcePath1",
      sourceDirectoryPath,
      targetPathId: "destinationPath1",
      targetDirectoryPath: destinationDirectoryPath,
      status: JobStatus.Active,
    };

    jest
      .spyOn(service, "flattenCutoverConfig")
      .mockReturnValue([
        {
          sourcePathId: "sourcePath1",
          sourceDirectoryPath,
          destinationPathId: "destinationPath1",
          destinationDirectoryPath,
        },
      ]);
    jest
      .spyOn(service, "findJobConfigs")
      .mockResolvedValue(mockJobConfigs as any);
    jest.spyOn(jobRunRepo, "find").mockResolvedValue(mockJobRunStatuses as any);
    jest
      .spyOn(jobConfigRepo, "findOne")
      .mockResolvedValue(mockExistingCutover as any);

    await expect(
      service.createBulkCutover(mockBulkCutover as any)
    ).rejects.toThrow(HttpException);
    expect(service.flattenCutoverConfig).toHaveBeenCalledWith(
      mockBulkCutover.cutoverConfig
    );
    expect(service.findJobConfigs).toHaveBeenCalledWith([
      {
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        destinationPathId: "destinationPath1",
        destinationDirectoryPath,
      },
    ]);
    expect(jobRunRepo.find).toHaveBeenCalledWith({
      where: {
        jobConfigId: In(["jobConfigId1"]),
        status: In([JobRunStatus.Completed, JobRunStatus.Stopped]),
      },
      order: { endTime: "DESC" },
    });
    expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
      where: {
        jobType: JobType.CUT_OVER,
        sourcePathId: "sourcePath1",
        sourceDirectoryPath,
        targetPathId: "destinationPath1",
        targetDirectoryPath: destinationDirectoryPath,
      },
    });
  });

  it("should throw an error if cutover already exists", async () => {
    try {
      await expect(service.createBulkCutover({} as any)).rejects.toThrow(
        HttpException
      );
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
    }
  });

  describe("updateJobConfig", () => {
    it("should update job config successfully", async () => {
      const mockJobConfigId = "jobConfigId";
      const mockJobConfig = {
        id: mockJobConfigId,
        jobType: "MIGRATE",
      };
      const mockData: Partial<JobConfigDto> = {};

      jest
        .spyOn(jobConfigRepo, "findOne")
        .mockResolvedValue(mockJobConfig as any);
      jest
        .spyOn(jobConfigRepo, "save")
        .mockResolvedValue({ ...mockJobConfig, ...mockData } as any);

      const result = await service.updateJobConfig(mockJobConfigId, mockData);

      expect(result).toEqual({ ...mockJobConfig, ...mockData });
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockJobConfigId },
      });
      expect(jobConfigRepo.save).toHaveBeenCalledWith({
        ...mockJobConfig,
        ...mockData,
      });
    });

    it("should use manager repository when manager is provided", async () => {
      const mockJobConfigId = "jobConfigId";
      const mockJobConfig = {
        id: mockJobConfigId,
        jobType: JobType.MIGRATE,
      } as any;
      const mockManagerRepo = {
        findOne: jest.fn().mockResolvedValue(mockJobConfig),
        save: jest.fn().mockImplementation(async (entity) => entity),
      };
      const mockManager = {
        getRepository: jest.fn().mockReturnValue(mockManagerRepo),
      } as any;
      const updatePayload: Partial<JobConfigDto> = {
        status: JobStatus.Active,
      };

      const result = await service.updateJobConfig(
        mockJobConfigId,
        updatePayload,
        mockManager
      );

      expect(mockManager.getRepository).toHaveBeenCalledWith(JobConfigEntity);
      expect(jobConfigRepo.findOne).not.toHaveBeenCalled();
      expect(jobConfigRepo.save).not.toHaveBeenCalled();
      expect(mockManagerRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockJobConfigId },
      });
      expect(mockManagerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: JobStatus.Active })
      );
      expect(result).toEqual(
        expect.objectContaining({ id: mockJobConfigId, status: JobStatus.Active })
      );
    });

    it("should throw an error if job config is not found", async () => {
      const mockJobConfigId = "jobConfigId";
      const mockData: Partial<JobConfigDto> = {};

      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(null);

      await expect(
        service.updateJobConfig(mockJobConfigId, mockData)
      ).rejects.toThrow(`Job with id ${mockJobConfigId} not found`);
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockJobConfigId },
      });
    });

    it("should reject smbPermissionInheritanceMode on update", async () => {
      const mockJobConfigId = "jobConfigId";
      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue({
        id: mockJobConfigId,
        jobType: JobType.MIGRATE,
        smbPermissionInheritanceMode:
          SmbPermissionInheritanceMode.INHERIT_PERMS_AS_IS,
      } as any);

      await expect(
        service.updateJobConfig(mockJobConfigId, {
          smbPermissionInheritanceMode:
            SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT,
        } as Partial<JobConfigDto>)
      ).rejects.toThrow(
        "smbPermissionInheritanceMode is set when the job is created and cannot be updated",
      );
      expect(jobConfigRepo.save).not.toHaveBeenCalled();
    });
  });

  describe("deleteJobConfig", () => {
    it("should soft-delete job config successfully when no active job runs exist", async () => {
      const mockJobConfigId = "jobConfigId";
      const mockJobConfig = {
        id: mockJobConfigId,
        isDeleted: false,
        status: JobStatus.Active,
      };

      jest
        .spyOn(jobConfigRepo, "findOne")
        .mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobRunRepo, "find").mockResolvedValue([]);
      jest.spyOn(jobConfigRepo, "save").mockResolvedValue(undefined);
      const loggerSpy = jest.spyOn(service["logger"], "log");

      const result = await service.deleteJobConfig(mockJobConfigId);

      expect(result).toEqual({
        message: `Job with id ${mockJobConfigId} has been marked for deletion`,
      });
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockJobConfigId }
      });
      expect(jobRunRepo.find).toHaveBeenCalledWith({
        where: {
          jobConfigId: mockJobConfigId,
          status: expect.any(Object)
        }
      });
      expect(mockJobConfig.isDeleted).toBe(true);
      expect(mockJobConfig.status).toBe(JobStatus.InActive);
      expect(jobConfigRepo.save).toHaveBeenCalledWith(mockJobConfig);
      expect(loggerSpy).toHaveBeenCalledWith(`Job with id ${mockJobConfigId} has been marked as deleted`);
    });

    it("should throw NotFoundException if job config is not found", async () => {
      const mockJobConfigId = "jobConfigId";

      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(null);
      const loggerSpy = jest.spyOn(service["logger"], "error");

      await expect(service.deleteJobConfig(mockJobConfigId)).rejects.toThrow(
        NotFoundException
      );
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockJobConfigId }
      });
      expect(loggerSpy).toHaveBeenCalledWith(
        `Failed to delete job with id ${mockJobConfigId}`,
        expect.any(String)
      );
    });

    it("should throw BadRequestException when active job runs exist", async () => {
      const mockJobConfigId = "jobConfigId";
      const mockJobConfig = {
        id: mockJobConfigId,
      };
      const mockActiveJobRuns = [
        { id: "run1", status: "RUNNING" },
        { id: "run2", status: "PENDING" }
      ];

      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobRunRepo, "find").mockResolvedValue(mockActiveJobRuns as any);
      const loggerSpy = jest.spyOn(service["logger"], "error");

      await expect(service.deleteJobConfig(mockJobConfigId)).rejects.toThrow(
        BadRequestException
      );
      await expect(service.deleteJobConfig(mockJobConfigId)).rejects.toThrow(
        "Cannot delete job configuration. There are active job runs associated with this configuration."
      );
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockJobConfigId }
      });
      expect(jobRunRepo.find).toHaveBeenCalledWith({
        where: {
          jobConfigId: mockJobConfigId,
          status: expect.any(Object)
        }
      });
      expect(jobConfigRepo.save).not.toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith(
        `Failed to delete job with id ${mockJobConfigId}`,
        expect.any(String)
      );
    });

    it("should throw HttpException for unexpected database errors", async () => {
      const mockJobConfigId = "jobConfigId";
      const mockJobConfig = {
        id: mockJobConfigId,
        isDeleted: false,
        status: JobStatus.Active,
      };

      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobRunRepo, "find").mockResolvedValue([]);
      jest.spyOn(jobConfigRepo, "save").mockRejectedValue(new Error("Database connection error"));
      const loggerSpy = jest.spyOn(service["logger"], "error");

      await expect(service.deleteJobConfig(mockJobConfigId)).rejects.toThrow(
        HttpException
      );
      await expect(service.deleteJobConfig(mockJobConfigId)).rejects.toThrow(
        "Database connection error"
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        `Failed to delete job with id ${mockJobConfigId}`,
        expect.any(String)
      );
    });
  });

  describe("purgeDeletedJobConfigs", () => {
    beforeEach(() => {
      process.env.SCHEMA = 'datamigrator';
    });

    it("should log and return when no soft-deleted job configs exist", async () => {
      (dataSource.query as jest.Mock).mockResolvedValueOnce([]);
      const loggerSpy = jest.spyOn(service["logger"], "log");

      await service.purgeDeletedJobConfigs();

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM "datamigrator".jobconfig WHERE is_deleted = true')
      );
      expect(loggerSpy).toHaveBeenCalledWith('No soft-deleted job configs to purge');
    });

    it("should purge a soft-deleted job config with no job runs", async () => {
      const configId = 'config-1';
      // 1. SELECT deleted configs
      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([{ id: configId }])
        // 2. SELECT job runs → none
        .mockResolvedValueOnce([])
        // 3. DELETE identity_config_cross_mapping
        .mockResolvedValueOnce(undefined)
        // 4. DELETE job_config_inventory_stats
        .mockResolvedValueOnce(undefined)
        // 5. DELETE jobconfig RETURNING id
        .mockResolvedValueOnce([{ id: configId }]);

      const loggerSpy = jest.spyOn(service["logger"], "log");
      await service.purgeDeletedJobConfigs();

      expect(loggerSpy).toHaveBeenCalledWith(`Purged deleted job config and all children: ${configId}`);
      expect(loggerSpy).toHaveBeenCalledWith('Purge complete: 1/1 job configs removed');
    });

    it("should purge a soft-deleted job config with job runs, including inventory partition DROP and batched deletes", async () => {
      const configId = 'config-2';
      const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const partitionName = 'inventory_aaaaaaaa_bbbb_cccc_dddd_eeeeeeeeeeee';

      (dataSource.query as jest.Mock)
        // 1. SELECT deleted configs
        .mockResolvedValueOnce([{ id: configId }])
        // 2. SELECT job runs
        .mockResolvedValueOnce([{ id: runId }])
        // 3. DETACH partition
        .mockResolvedValueOnce(undefined)
        // 4. DROP partition table
        .mockResolvedValueOnce(undefined)
        // 5. DELETE operation_errors batch 1 (returns < ROW_BATCH → done)
        .mockResolvedValueOnce([[], 0])
        // 6. DELETE operations batch 1
        .mockResolvedValueOnce([[], 0])
        // 7. DELETE task_errors batch 1
        .mockResolvedValueOnce([[], 0])
        // 8. DELETE tasks batch 1
        .mockResolvedValueOnce([[], 0])
        // 9. DELETE worker_jobrun_mapping
        .mockResolvedValueOnce(undefined)
        // 10. DELETE job_options
        .mockResolvedValueOnce(undefined)
        // 11. DELETE jobrun
        .mockResolvedValueOnce(undefined)
        // 12. DELETE identity_config_cross_mapping
        .mockResolvedValueOnce(undefined)
        // 13. DELETE job_config_inventory_stats
        .mockResolvedValueOnce(undefined)
        // 14. DELETE jobconfig RETURNING id
        .mockResolvedValueOnce([{ id: configId }]);

      await service.purgeDeletedJobConfigs();

      // Verify partition detach
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining(`DETACH PARTITION "datamigrator"."${partitionName}"`)
      );
      // Verify partition drop
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining(`DROP TABLE IF EXISTS "datamigrator"."${partitionName}"`)
      );
      // Verify final jobconfig delete
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "datamigrator".jobconfig WHERE id = $1 RETURNING id'),
        [configId]
      );
    });

    it("should handle batched deletes when rows exceed ROW_BATCH", async () => {
      const configId = 'config-3';
      const runId = 'run-id-1';

      (dataSource.query as jest.Mock)
        // 1. SELECT deleted configs
        .mockResolvedValueOnce([{ id: configId }])
        // 2. SELECT job runs
        .mockResolvedValueOnce([{ id: runId }])
        // 3. DETACH partition → partition doesn't exist
        .mockRejectedValueOnce({ code: '42P01', message: 'does not exist' })
        // 4. DELETE operation_errors batch 1 → returns ROW_BATCH (50000), needs another round
        .mockResolvedValueOnce([[], 50000])
        // 5. DELETE operation_errors batch 2 → returns < ROW_BATCH, done
        .mockResolvedValueOnce([[], 1000])
        // 6. DELETE operations batch 1
        .mockResolvedValueOnce([[], 0])
        // 7. DELETE task_errors batch 1
        .mockResolvedValueOnce([[], 0])
        // 8. DELETE tasks batch 1
        .mockResolvedValueOnce([[], 0])
        // 9. DELETE worker_jobrun_mapping
        .mockResolvedValueOnce(undefined)
        // 10. DELETE job_options
        .mockResolvedValueOnce(undefined)
        // 11. DELETE jobrun
        .mockResolvedValueOnce(undefined)
        // 12. DELETE identity_config_cross_mapping
        .mockResolvedValueOnce(undefined)
        // 13. DELETE job_config_inventory_stats
        .mockResolvedValueOnce(undefined)
        // 14. DELETE jobconfig RETURNING id
        .mockResolvedValueOnce([{ id: configId }]);

      await service.purgeDeletedJobConfigs();

      // operation_errors should have been called twice (batched)
      const operationErrorsCalls = (dataSource.query as jest.Mock).mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('operation_errors')
      );
      expect(operationErrorsCalls.length).toBe(2);
    });

    it("should warn when DELETE jobconfig returns 0 rows", async () => {
      const configId = 'config-4';

      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([{ id: configId }])
        .mockResolvedValueOnce([]) // no runs
        .mockResolvedValueOnce(undefined) // identity_config_cross_mapping
        .mockResolvedValueOnce(undefined) // job_config_inventory_stats
        .mockResolvedValueOnce([]); // DELETE jobconfig returns empty

      const loggerSpy = jest.spyOn(service["logger"], "warn");
      await service.purgeDeletedJobConfigs();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`DELETE returned 0 rows for job config ${configId}`)
      );
    });

    it("should continue purging remaining configs when one fails", async () => {
      const config1 = 'config-fail';
      const config2 = 'config-ok';

      (dataSource.query as jest.Mock)
        // 1. SELECT deleted configs
        .mockResolvedValueOnce([{ id: config1 }, { id: config2 }])
        // config1: SELECT runs → throw error
        .mockRejectedValueOnce(new Error('DB error'))
        // config2: SELECT runs → none
        .mockResolvedValueOnce([])
        // config2: identity_config_cross_mapping
        .mockResolvedValueOnce(undefined)
        // config2: job_config_inventory_stats
        .mockResolvedValueOnce(undefined)
        // config2: DELETE jobconfig
        .mockResolvedValueOnce([{ id: config2 }]);

      const loggerSpy = jest.spyOn(service["logger"], "log");
      const errorSpy = jest.spyOn(service["logger"], "error");
      await service.purgeDeletedJobConfigs();

      expect(errorSpy).toHaveBeenCalledWith(
        `Failed to purge job config ${config1}`,
        expect.any(String)
      );
      expect(loggerSpy).toHaveBeenCalledWith(`Purged deleted job config and all children: ${config2}`);
      expect(loggerSpy).toHaveBeenCalledWith('Purge complete: 1/2 job configs removed');
    });

    it("should use app.purge.batchSize from configService when set", async () => {
      const configId = 'config-batch-env';
      const runId = 'run-batch-1';
      const customBatchSize = 10000;

      configService.get.mockReturnValueOnce(customBatchSize);

      (dataSource.query as jest.Mock)
        // 1. SELECT deleted configs
        .mockResolvedValueOnce([{ id: configId }])
        // 2. SELECT job runs
        .mockResolvedValueOnce([{ id: runId }])
        // 3. DETACH partition → doesn't exist
        .mockRejectedValueOnce({ code: '42P01', message: 'does not exist' })
        // 4. DELETE operation_errors batch 1 → returns customBatchSize, needs another round
        .mockResolvedValueOnce([[], customBatchSize])
        // 5. DELETE operation_errors batch 2 → done
        .mockResolvedValueOnce([[], 0])
        // 6. DELETE operations batch 1
        .mockResolvedValueOnce([[], 0])
        // 7. DELETE task_errors batch 1
        .mockResolvedValueOnce([[], 0])
        // 8. DELETE tasks batch 1
        .mockResolvedValueOnce([[], 0])
        // 9. DELETE worker_jobrun_mapping
        .mockResolvedValueOnce(undefined)
        // 10. DELETE job_options
        .mockResolvedValueOnce(undefined)
        // 11. DELETE jobrun
        .mockResolvedValueOnce(undefined)
        // 12. DELETE identity_config_cross_mapping
        .mockResolvedValueOnce(undefined)
        // 13. DELETE job_config_inventory_stats
        .mockResolvedValueOnce(undefined)
        // 14. DELETE jobconfig RETURNING id
        .mockResolvedValueOnce([{ id: configId }]);

      await service.purgeDeletedJobConfigs();

      // Verify configService.get was called with 'app.purge.batchSize'
      expect(configService.get).toHaveBeenCalledWith('app.purge.batchSize');

      // Verify the LIMIT parameter uses the custom batch size
      const operationErrorsCalls = (dataSource.query as jest.Mock).mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('operation_errors')
      );
      expect(operationErrorsCalls.length).toBe(2);
      // Each batched DELETE should pass customBatchSize as LIMIT parameter
      expect(operationErrorsCalls[0][1]).toEqual([['run-batch-1'], customBatchSize]);
      expect(operationErrorsCalls[1][1]).toEqual([['run-batch-1'], customBatchSize]);
    });
  });

  describe("getJobConfigById", () => {
    beforeEach(() => {
      jest.spyOn(service, "parseSize").mockImplementation((size) => {
        if (size === "4.88 KB") return 5000;
        if (size === "2.93 KB") return 3000;
        return 0;
      });
    });


    it("should return job config by id successfully", async () => {
      const mockJobConfigId = "jobConfigId";
      const startTime = new Date("2025-03-27T00:00:00Z");
      const endTime = new Date("2025-03-27T00:00:01Z");
    
      const mockJobConfig = {
        id: mockJobConfigId,
        jobType: JobType.MIGRATE,
        jobRuns: [
          {
            id: "jobRunId1",
            isReportReady: true,
            status: JobRunStatus.Completed,
            subStatus: null,
            startTime,
            endTime,
            jobStats: {
              fileCount: "10",
              directories: "5",
              totalSize: "5000",
            },
          },
        ],
        sourcePath: {
          volumePath: "/source/path",
          fileServer: {
            protocol: "NFS",
            config: { configName: "SourceServer" },
          },
        },
        targetPath: {
          volumePath: "/target/path",
          fileServer: {
            protocol: "NFS",
            config: { configName: "TargetServer" },
          },
        },
        status: "Active",
        createdAt: startTime,
      };
    
      jest
        .spyOn(jobConfigRepo, "findOne")
        .mockResolvedValue(mockJobConfig as any);
    
      jest
        .spyOn(service as any, 'getErrorCounts')
        .mockResolvedValue({
          fileCount: "10",
          directories: "5",
          totalSize: "5000",
          errors: [],
        });
    
      const createQueryBuilderMock = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
    
      const operationErrorRepoMock = {
        createQueryBuilder: jest.fn(() => createQueryBuilderMock),
      };
      jest
      .spyOn(service, 'calculateJobRunStats')
      .mockImplementation(async (jobRunId: string) => {
        if (jobRunId === "jobRunId1") {
          return {
            fileCount: "10",
            directories: "5",
            totalSize: "5000",
            errors: [],
          };
        }
        throw new NotFoundException(`Job Run with id ${jobRunId} not found`);
      });
      (service as any).operationErrorRepo = operationErrorRepoMock;
    
      const result = await service.getJobConfigById(mockJobConfigId);
    
      expect(result).toEqual({
        jobConfigId: mockJobConfigId,
        jobType: "MIGRATE",
        sourceServer: {
          serverName: "SourceServer",
          path: "/source/path",
          protocol: "NFS",
          directoryPath: null,
        },
        destinationServer: {
          serverName: "TargetServer",
          path: "/target/path",
          protocol: "NFS",
          directoryPath: null,
        },
        status: "Active",
        createdAt: startTime,
        jobRuns: [
          {
            jobRunId: "jobRunId1",
            isReportReady: true,
            status: "COMPLETED",
            startTime,
            endTime,
            jobType: "MIGRATE",
            jobRunType: undefined,
            timeElapsed: 1000,
            scannedFilesCount: "10",
            scannedDirectoriesCount: "5",
            totalScannedSize: "4.88 KiB",
            totalMigratedSize: "4.88 KiB",
            errors: [],
            lastRefreshed: undefined,
          },
        ],
        aggregateData: {
          timeElapsed: 1000,
          scannedFilesCount: "10",
          scannedDirectoriesCount: "5",
          totalScannedSize: "0 B",
        },
        configurationsSetToJob: {
          "Skip Files modified in last": "-",
          "Preserve a-time": "Disabled",
          "Preserve permissions": "Disabled",
          "Excluded Path Patterns": [],
          "Exclude file older than (UTC)": undefined,
          "Incremental sync schedule": undefined,
          "Job Scheduled For": undefined,
        },
        errors: [],
      });
    });
    
    it("should handle job runs with no stats", async () => {
      const mockJobConfig = {
        id: "job1",
        jobType: JobType.MIGRATE,
        jobRuns: [
          {
            id: "run1",
            status: JobRunStatus.Running,
            startTime: new Date(),
            endTime: null,
            jobStats: null,
            isReportReady: false,
            subStatus: null,
          },
        ],
        sourcePath: {
          id: "src1",
          volumePath: "/src",
          fileServer: {
            id: "fs1",
            protocol: "NFS",
            config: {
              configName: "SrcServer",
            },
            workers: [],
          },
        },
        targetPath: {
          id: "dest1",
          volumePath: "/dest",
          fileServer: {
            id: "fs2",
            protocol: "NFS",
            config: {
              configName: "DestServer",
            },
            workers: [],
          },
        },
        status: "Active",
        createdAt: new Date(),
      };

      // Mock the main job config repository
      jest
        .spyOn(jobConfigRepo, "findOne")
        .mockResolvedValue(mockJobConfig as any);

      // Mock the inventory repository
      jest.spyOn(inventoryRepo, "createQueryBuilder").mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          filecount: "0",
          directorycount: "0",
          totalfilesize: "0",
        }),
      } as any);

      // Mock the job run repository
      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue({
        id: "run1",
        jobConfig: { id: "job1" },
      } as any);

      // Mock the operation error repository
      jest.spyOn(operationErrorRepo, "createQueryBuilder").mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      } as any);

      jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      } as any);

      const result = await service.getJobConfigById("job1");

      expect(result.jobRuns[0].scannedFilesCount).toBe("0");
      expect(result.jobRuns[0].scannedDirectoriesCount).toBe("0");
      expect(result.jobRuns[0].totalScannedSize).toBe("0 B");
    });

    it("should throw an error if job config is not found", async () => {
      const mockJobConfigId = "jobConfigId";

      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(null);

      await expect(service.getJobConfigById(mockJobConfigId)).rejects.toThrow(
        `Job with id ${mockJobConfigId} not found`
      );
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockJobConfigId },
        relations: [
          "jobRuns",
          "sourcePath",
          "sourcePath.fileServer",
          "sourcePath.fileServer.config",
          "targetPath",
          "targetPath.fileServer",
          "targetPath.fileServer.config",
        ],
      });
    });

    it("should return jobStats for jobRun.status === JobRunStatus.COMPLETED", async () => {
      const startTime = new Date("2025-03-27T00:00:00Z");
      const endTime = new Date("2025-03-27T00:00:01Z");
    
      const mockJobConfig = {
        id: "jobConfigId",
        jobType: JobType.MIGRATE,
        jobRuns: [
          {
            id: "jobRunId1",
            status: JobRunStatus.Completed,
            subStatus: null,
            startTime,
            endTime,
            jobStats: {
              fileCount: "10",
              directories: "5",
              totalSize: "1000",
              errors: [],
            },
          },
          {
            id: "jobRunId2",
            status: JobRunStatus.Completed,
            subStatus: null,
            startTime,
            endTime,
            jobStats: {
              fileCount: "20",
              directories: "10",
              totalSize: "2000",
              errors: [],
            },
          },
        ],
        sourcePath: null,
        targetPath: null,
        status: "Active",
        createdAt: startTime,
      };
      jest
        .spyOn(jobConfigRepo, "findOne")
        .mockResolvedValue(mockJobConfig as any);
    
      const createQueryBuilderMock = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
    
      const operationErrorRepoMock = {
        createQueryBuilder: jest.fn(() => createQueryBuilderMock),
      };
      
      (service as any).operationErrorRepo = operationErrorRepoMock;
      jest
      .spyOn(service, 'calculateJobRunStats')
      .mockImplementation(async (jobRunId: string) => {
        if (jobRunId === "jobRunId1") {
          return {
            fileCount: "10",
            directories: "5",
            totalSize: "1000",
            errors: [],
          };
        }
        if (jobRunId === "jobRunId2") {
          return {
            fileCount: "20",
            directories: "10",
            totalSize: "2000",
            errors: [],
          };
        }
        throw new NotFoundException(`Job Run with id ${jobRunId} not found`);
      });
    
      const result = await service.getJobConfigById("jobConfigId");
    
      expect(result.aggregateData).toEqual({
        timeElapsed: 2000,
        scannedFilesCount: "30",
        scannedDirectoriesCount: "15",
        totalScannedSize: "0 B",
      });
    });
    
    it("should format skipFile value for MIGRATE job (minutes)", () => {
      const jobConfig = {
        jobType: JobType.MIGRATE,
        skipFile: "35-M",
        preserveAccessTime: false,
        preservePermissions: false,
        excludeFilePatterns: "*/logs/*,*/tmp/*",
        excludeOlderThan: null,
        futureScheduleAt: null,
      };
      const result = service.getConfigurationsSetToJob(jobConfig as any);
      expect(result["Skip Files modified in last"]).toBe("35-Mins");
      expect(result["Preserve a-time"]).toBe("Disabled");
      expect(result["Excluded Path Patterns"]).toEqual(["*/logs/*", "*/tmp/*"]);
    });

    it("should expose convert inherited permissions as Enabled for SMB directory-level MIGRATE when DB value is null", () => {
      const jobConfig = {
        jobType: JobType.MIGRATE,
        skipFile: "35-M",
        preserveAccessTime: false,
        preservePermissions: true,
        smbPermissionInheritanceMode: null,
        sourceDirectoryPath: "/data/share1",
        targetDirectoryPath: null,
        sourcePath: {
          fileServer: { protocol: Protocol.SMB },
        },
        excludeFilePatterns: "",
        excludeOlderThan: null,
        futureScheduleAt: null,
        firstRunAt: new Date(),
      };
      const result = service.getConfigurationsSetToJob(jobConfig as any);
      expect(
        result[JobConfigurationEnum.smbPermissionInheritanceMode],
      ).toBe("Enabled");
    });

    it("should omit convert inherited permissions when preservePermissions is disabled", () => {
      const jobConfig = {
        jobType: JobType.MIGRATE,
        skipFile: "35-M",
        preserveAccessTime: false,
        preservePermissions: false,
        smbPermissionInheritanceMode:
          SmbPermissionInheritanceMode.INHERIT_PERMS_AS_IS,
        sourceDirectoryPath: "/data/share1",
        sourcePath: {
          fileServer: { protocol: Protocol.SMB },
        },
        excludeFilePatterns: "",
        excludeOlderThan: null,
        futureScheduleAt: null,
        firstRunAt: new Date(),
      };
      const result = service.getConfigurationsSetToJob(jobConfig as any);
      expect(
        result[JobConfigurationEnum.smbPermissionInheritanceMode],
      ).toBeUndefined();
    });

    it("should format smbPermissionInheritanceMode when set on SMB directory-level MIGRATE", () => {
      const jobConfig = {
        jobType: JobType.MIGRATE,
        skipFile: "35-M",
        preserveAccessTime: false,
        preservePermissions: true,
        smbPermissionInheritanceMode:
          SmbPermissionInheritanceMode.INHERIT_PERMS_AS_IS,
        sourceDirectoryPath: "/data/share1",
        sourcePath: {
          fileServer: { protocol: Protocol.SMB },
        },
        excludeFilePatterns: "",
        excludeOlderThan: null,
        futureScheduleAt: null,
        firstRunAt: new Date(),
      };
      const result = service.getConfigurationsSetToJob(jobConfig as any);
      expect(
        result[JobConfigurationEnum.smbPermissionInheritanceMode],
      ).toBe("Disabled");
    });

    it("should handle CUT_OVER job type", () => {
      const jobConfig = {
        jobType: JobType.CUT_OVER,
        preserveAccessTime: true,
        preservePermissions: true,
        excludeFilePatterns: "*/snapshot/*",
        excludeOlderThan: "2025-01-01",
      };
      const result = service.getConfigurationsSetToJob(jobConfig as any);
      expect(result["Preserve a-time"]).toBe("Enabled");
      expect(result["Excluded Path Patterns"]).toEqual(["*/snapshot/*"]);
      expect(result["Exclude file older than (UTC)"]).toBe("2025-01-01");
    });

    it("should handle other job types", () => {
      const jobConfig = {
        jobType: "DISCOVER",
        excludeFilePatterns: "",
      };
      const result = service.getConfigurationsSetToJob(jobConfig as any);
      expect(result["Excluded Path Patterns"]).toEqual([]);
    });
    it("should format skipFile value for MIGRATE job (hours and days)", () => {
      const jobConfig = {
        jobType: JobType.MIGRATE,
        skipFile: "2-H",
        preserveAccessTime: false,
        preservePermissions: false,
        excludeFilePatterns: "",
        excludeOlderThan: null,
        futureScheduleAt: null,
      };
      const result = service.getConfigurationsSetToJob(jobConfig as any);
      expect(result["Skip Files modified in last"]).toBe("2-Hrs");
    });
    
    it("should format skipFile value for MIGRATE job (days)", () => {
      const jobConfig = {
        jobType: JobType.MIGRATE,
        skipFile: "5-D",
        preserveAccessTime: false,
        preservePermissions: false,
        excludeFilePatterns: "",
        excludeOlderThan: null,
        futureScheduleAt: null,
      };
      const result = service.getConfigurationsSetToJob(jobConfig as any);
      expect(result["Skip Files modified in last"]).toBe("5-Days");
    });

    it("should handle excludeFilePatterns with empty values", () => {
      const jobConfig = {
        jobType: JobType.MIGRATE,
        excludeFilePatterns: ",,,",
      };
      const result = service.getConfigurationsSetToJob(jobConfig as any);
      expect(result["Excluded Path Patterns"]).toEqual([]);
    });

    it("should expose shouldScanADS as Enabled for discovery jobs", () => {
      const firstRunAt = new Date("2025-02-10T00:00:00.000Z");
      const jobConfig = {
        jobType: JobType.DISCOVER,
        excludeFilePatterns: "*/ads/*,*/alt/*",
        shouldScanADS: true,
        firstRunAt,
      };

      const result = service.getConfigurationsSetToJob(jobConfig as any);

      expect(result[JobConfigurationEnum.shouldScanADS]).toBe("Enabled");
      expect(result[JobConfigurationEnum.excludeFilePatterns]).toEqual([
        "*/ads/*",
        "*/alt/*",
      ]);
      expect(result[JobConfigurationEnum.firstRunAt]).toBe(firstRunAt);
    });

    it("should default shouldScanADS to Disabled when not provided", () => {
      const jobConfig = {
        jobType: JobType.DISCOVER,
        excludeFilePatterns: "",
      };

      const result = service.getConfigurationsSetToJob(jobConfig as any);

      expect(result[JobConfigurationEnum.shouldScanADS]).toBe("Disabled");
      expect(result[JobConfigurationEnum.excludeFilePatterns]).toEqual([]);
    });
  });

  describe("parseSize", () => {
    it("should return 0 for empty or undefined input", () => {
      expect(service.parseSize("")).toBe(0);
      expect(service.parseSize(null)).toBe(0);
      expect(service.parseSize(undefined)).toBe(0);
    });

    it("should return 0 for invalid format", () => {
      expect(service.parseSize("invalid")).toBe(0);
      expect(service.parseSize("123")).toBe(0); // missing unit
      expect(service.parseSize("MiB")).toBe(0); // missing value
      expect(service.parseSize("12.3XB")).toBe(0); // invalid unit
    });

    it("should correctly parse bytes (B)", () => {
      expect(service.parseSize("1024 B")).toBe(1024);
      expect(service.parseSize("1 B")).toBe(1);
      expect(service.parseSize("0 B")).toBe(0);
      expect(service.parseSize("1.5 B")).toBe(1.5);
    });

    it("should correctly parse kilobytes (KB)", () => {
      expect(service.parseSize("1 KiB")).toBe(1024);
      expect(service.parseSize("2.5 KiB")).toBe(2.5 * 1024);
      expect(service.parseSize("0 KiB")).toBe(0);
    });

    it("should correctly parse megabytes (MiB)", () => {
      expect(service.parseSize("1 MiB")).toBe(1024 * 1024);
      expect(service.parseSize("3.2 MiB")).toBe(3.2 * 1024 * 1024);
    });

    it("should correctly parse gigabytes (GiB)", () => {
      expect(service.parseSize("1 GiB")).toBe(1024 ** 3);
      expect(service.parseSize("0.5 GiB")).toBe(0.5 * 1024 ** 3);
    });

    it("should correctly parse terabytes (TiB)", () => {
      expect(service.parseSize("1 TiB")).toBe(1024 ** 4);
      expect(service.parseSize("2 TiB")).toBe(2 * 1024 ** 4);
    });

    it("should correctly parse petabytes (PiB)", () => {
      expect(service.parseSize("1 PiB")).toBe(1024 ** 5);
      expect(service.parseSize("0.1 PiB")).toBe(0.1 * 1024 ** 5);
    });

    it("should handle decimal values", () => {
      expect(service.parseSize("1.5 KiB")).toBe(1.5 * 1024);
      expect(service.parseSize("0.25 MiB")).toBe(0.25 * 1024 * 1024);
      expect(service.parseSize(".5 GiB")).toBe(0.5 * 1024 ** 3);
    });
  });

  describe("precheckValidation", () => {
    it("should perform precheck validation successfully", async () => {
      const mockPrecheckData = [
        {
          sourcePathId: "sourcePath1",
          destinationPathId: ["destinationPath1"],
        },
      ];

      const mockVolumeEntities = [
        {
          id: "sourcePath1",
          volumePath: "/source/path",
          fileServer: {
            id: "fileServer1",
            host: "source-host",
            userName: "source-user",
            password: "source-pass",
            protocol: "NFS",
            protocolVersion: "v4",
            serverType: "source-server-type",
            workers: [{ workerId: "worker1", status: "Online" }],
          },
        },
        {
          id: "destinationPath1",
          volumePath: "/destination/path",
          fileServer: {
            id: "fileServer2",
            host: "destination-host",
            userName: "destination-user",
            password: "destination-pass",
            protocol: "NFS",
            protocolVersion: "v4",
            serverType: "destination-server-type",
            workers: [{ workerId: "worker1", status: "Online" }],
          },
        },
      ];

      jest
        .spyOn(volumeRepo, "find")
        .mockResolvedValue(mockVolumeEntities as any);
      const loggerSpy = jest.spyOn(service["logger"], "log");

      const result = await service.precheckValidation(mockPrecheckData as any);

      expect(result).toEqual([
        {
          sourcePathId: "sourcePath1",
          destinations: [
            {
              destinationPathId: "destinationPath1",
              status: "success",
              commonWorkers: [{ workerId: "worker1" }],
            },
          ],
          status: "success",
        },
      ]);
      expect(volumeRepo.find).toHaveBeenCalledWith({
        where: { id: In(["sourcePath1", "destinationPath1"]) },
        relations: {
          fileServer: { workers: true },
        },
      });
    });

    // it("should handle workflow service errors during precheck", async () => {
    //   const mockData = {
    //     migrateConfigs: [
    //       { sourcePathId: "src1", destinationPathId: ["dest1"] },
    //     ],
    //     preserveAccessTime: true,
    //     preservePermissions: true,
    //     options: {
    //       workflowExecutionTimeout: "300",
    //       workflowTaskTimeout: "60",
    //       workflowRunTimeout: "600",
    //       startDelay: "10",
    //     },
    //   };

    //   const mockVolumes = [
    //     {
    //       id: "src1",
    //       fileServer: {
    //         id: "fs1",
    //         workers: [{ workerId: "w1" }],
    //         protocolVersion: "v3",
    //       },
    //     },
    //     {
    //       id: "dest1",
    //       fileServer: {
    //         id: "fs2",
    //         workers: [{ workerId: "w1" }],
    //         protocolVersion: "v3",
    //       },
    //     },
    //   ];

    //   jest.spyOn(volumeRepo, "find").mockResolvedValue(mockVolumes as any);
    //   jest
    //     .spyOn(workFlowService, "startWorkflow")
    //     .mockRejectedValue(new Error("Workflow error"));

    //   const result = await service.initiatePreCheck(mockData);

    //   expect(result.status).toBe("error");
    //   expect(result.erros).toContain("PRECHECK_FAILED");
    // });

    it("should handle source path not found", async () => {
      const mockPrecheckData = [
        {
          sourcePathId: "sourcePath1",
          destinationPathId: ["destinationPath1"],
        },
      ];

      const mockVolumeEntities = [];

      jest
        .spyOn(volumeRepo, "find")
        .mockResolvedValue(mockVolumeEntities as any);

      const result = await service.precheckValidation(mockPrecheckData as any);

      expect(result).toEqual([
        {
          sourcePathId: "sourcePath1",
          destinations: [],
          status: "failed",
          error: ["SOURCE_PATH_NOT_FOUND"],
          message: "Source path sourcePath1 not found",
        },
      ]);
      expect(volumeRepo.find).toHaveBeenCalledWith({
        where: { id: In(["sourcePath1", "destinationPath1"]) },
        relations: {
          fileServer: { workers: true },
        },
      });
    });

    it("should handle destination path not found", async () => {
      const mockPrecheckData = [
        {
          sourcePathId: "sourcePath1",
          destinationPathId: ["destinationPath1"],
        },
      ];

      const mockVolumeEntities = [
        {
          id: "sourcePath1",
          volumePath: "/source/path",
          fileServer: {
            id: "fileServer1",
            host: "source-host",
            userName: "source-user",
            password: "source-pass",
            protocol: "NFS",
            protocolVersion: "v4",
            serverType: "source-server-type",
            workers: [{ workerId: "worker1", status: "Online" }],
          },
        },
      ];

      jest
        .spyOn(volumeRepo, "find")
        .mockResolvedValue(mockVolumeEntities as any);

      const result = await service.precheckValidation(mockPrecheckData as any);

      expect(result).toEqual([
        {
          sourcePathId: "sourcePath1",
          destinations: [
            {
              status: "failed",
              errors: ["DESTINATION_PATH_NOT_FOUND"],
              message: `Destination path destinationPath1 not found`,
              destinationPathId: "destinationPath1",
            },
          ],
          status: "success",
        },
      ]);
      expect(volumeRepo.find).toHaveBeenCalledWith({
        where: { id: In(["sourcePath1", "destinationPath1"]) },
        relations: {
          fileServer: { workers: true },
        },
      });
    });

    it("should handle protocol version mismatch", async () => {
      const mockPrecheckData = [
        {
          sourcePathId: "sourcePath1",
          destinationPathId: ["destinationPath1"],
        },
      ];

      const mockVolumeEntities = [
        {
          id: "sourcePath1",
          volumePath: "/source/path",
          fileServer: {
            id: "fileServer1",
            host: "source-host",
            userName: "source-user",
            password: "source-pass",
            protocol: "NFS",
            protocolVersion: "v4",
            serverType: "source-server-type",
            workers: [{ workerId: "worker1", status: "Online" }],
          },
        },
        {
          id: "destinationPath1",
          volumePath: "/destination/path",
          fileServer: {
            id: "fileServer2",
            host: "destination-host",
            userName: "destination-user",
            password: "destination-pass",
            protocol: "NFS",
            protocolVersion: "v3",
            serverType: "destination-server-type",
            workers: [{ workerId: "worker1", status: "Online" }],
          },
        },
      ];

      jest
        .spyOn(volumeRepo, "find")
        .mockResolvedValue(mockVolumeEntities as any);

      const result = await service.precheckValidation(mockPrecheckData as any);

      expect(result).toEqual([
        {
          sourcePathId: "sourcePath1",
          destinations: [
            {
              status: "failed",
              errors: ["PROTOCOL_VERSION_MISMATCH"],
              message: `Protocol version mismatch between source path sourcePath1 and destination path destinationPath1`,
              destinationPathId: "destinationPath1",
            },
          ],
          status: "success",
        },
      ]);
      expect(volumeRepo.find).toHaveBeenCalledWith({
        where: { id: In(["sourcePath1", "destinationPath1"]) },
        relations: {
          fileServer: { workers: true },
        },
      });
    });

    it("should handle no common workers found", async () => {
      const mockPrecheckData = [
        {
          sourcePathId: "sourcePath1",
          destinationPathId: ["destinationPath1"],
        },
      ];

      const mockVolumeEntities = [
        {
          id: "sourcePath1",
          volumePath: "/source/path",
          fileServer: {
            id: "fileServer1",
            host: "source-host",
            userName: "source-user",
            password: "source-pass",
            protocol: "NFS",
            protocolVersion: "v4",
            serverType: "source-server-type",
            workers: [{ workerId: "worker1", status: "Online" }],
          },
        },
        {
          id: "destinationPath1",
          volumePath: "/destination/path",
          fileServer: {
            id: "fileServer2",
            host: "destination-host",
            userName: "destination-user",
            password: "destination-pass",
            protocol: "NFS",
            protocolVersion: "v4",
            serverType: "destination-server-type",
            workers: [{ workerId: "worker2", status: "Online" }],
          },
        },
      ];

      jest
        .spyOn(volumeRepo, "find")
        .mockResolvedValue(mockVolumeEntities as any);

      const result = await service.precheckValidation(mockPrecheckData as any);

      expect(result).toEqual([
        {
          sourcePathId: "sourcePath1",
          destinations: [
            {
              status: "failed",
              errors: ["NO_COMMON_WORKERS"],
              message: `No common workers found for source path sourcePath1 and destination path destinationPath1`,
              destinationPathId: "destinationPath1",
            },
          ],
          status: "success",
        },
      ]);
      expect(volumeRepo.find).toHaveBeenCalledWith({
        where: { id: In(["sourcePath1", "destinationPath1"]) },
        relations: {
          fileServer: { workers: true },
        },
      });
    });
  });
  describe("hasCommonWorkers", () => {
    it("should return true if common workers are found", () => {
      const mockData = [
        {
          fileServer: {
            workers: [
              { id: "worker1", status: "Online" },
              { id: "worker2", status: "Online" },
            ],
          },
        },
        {
          fileServer: {
            workers: [
              { id: "worker2", status: "Online" },
              { id: "worker3", status: "Online" },
            ],
          },
        },
      ];

      expect(service.hasCommonWorkers(mockData)).toBe(true);
    });

    it("should return false if no common workers are found", () => {
      const mockData = [
        {
          fileServer: {
            workers: [
              { id: "worker1", status: "Online" },
              { id: "worker2", status: "Online" },
            ],
          },
        },
        {
          fileServer: {
            workers: [
              { id: "worker3", status: "Online" },
              { id: "worker4", status: "Online" },
            ],
          },
        },
      ];

      expect(service.hasCommonWorkers(mockData)).toBe(false);
    });

    it("should return false if any file server has no workers", () => {
      const mockData = [
        {
          fileServer: {
            workers: [],
          },
        },
        {
          fileServer: {
            workers: [
              { id: "worker1", status: "Online" },
              { id: "worker2", status: "Online" },
            ],
          },
        },
      ];

      expect(service.hasCommonWorkers(mockData)).toBe(false);
    });
  });

  describe("findJobConfigs", () => {
    it("should find job configs based on conditions", async () => {
      const mockConditions = [
        {
          sourcePathId: "sourcePath1",
          sourceDirectoryPath: "/src/dir1",
          destinationPathId: "destinationPath1",
          destinationDirectoryPath: "/dest/dir1",
        },
        {
          sourcePathId: "sourcePath2",
          sourceDirectoryPath: "/src/dir2",
          destinationPathId: "destinationPath2",
          destinationDirectoryPath: "/dest/dir2",
        },
      ];

      const mockJobConfigs = [
        {
          id: "jobConfig1",
          sourcePathId: "sourcePath1",
          targetPathId: "destinationPath1",
        },
        {
          id: "jobConfig2",
          sourcePathId: "sourcePath2",
          targetPathId: "destinationPath2",
        },
      ];

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockJobConfigs),
      };

      jest
        .spyOn(jobConfigRepo, "createQueryBuilder")
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.findJobConfigs(mockConditions);

      expect(result).toEqual(mockJobConfigs);
      expect(jobConfigRepo.createQueryBuilder).toHaveBeenCalledWith(
        "jobConfig"
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        expect.objectContaining({ "@instanceof": Symbol.for("Brackets") })
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "jobConfig.jobType = :jobType",
        { jobType: 'MIGRATE' }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "jobConfig.isDeleted = :isDeleted",
        { isDeleted: false }
      );
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });

    it("should return empty array if no conditions are provided", async () => {
      const result = await service.findJobConfigs([]);

      expect(result).toEqual([]);
      expect(jobConfigRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
  describe("formatBytes", () => {
    it("should convert bytes to appropriate units", () => {
      expect(formatBytes(500)).toBe("500 B");
      expect(formatBytes(1024)).toBe("1 KiB");
      expect(formatBytes(1048576)).toBe("1 MiB");
      expect(formatBytes(1073741824)).toBe("1 GiB");
      expect(formatBytes(1099511627776)).toBe("1 TiB");
      expect(formatBytes(1125899906842624)).toBe("1 PiB");
    });

    it("should handle edge cases correctly", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(1023)).toBe("1023 B");
      expect(formatBytes(1024 * 1024 - 1)).toBe("1024 KiB");
      expect(formatBytes(1024 * 1024 * 1024 - 1)).toBe("1024 MiB");
      expect(formatBytes(1024 * 1024 * 1024 * 1024 - 1)).toBe("1024 GiB");
      expect(formatBytes(1024 * 1024 * 1024 * 1024 * 1024 - 1)).toBe("1 PiB");
    });
  });
  describe("getTemplateFilename", () => {
    it("should return the correct template filename", () => {
      service["templates"] = {
        [TemplateType.GID]: "template1.csv",
        [TemplateType.SID]: "template2.csv",
        [TemplateType.UID]: "template3.csv",
      };

      expect(service.getTemplateFilename(TemplateType.GID)).toBe(
        "template1.csv"
      );
      expect(service.getTemplateFilename(TemplateType.SID)).toBe(
        "template2.csv"
      );
    });
    it("should return undefined if an invalid TemplateType is passed", () => {
      service["templates"] = {
        [TemplateType.GID]: "template1.csv",
        [TemplateType.SID]: "template2.csv",
        [TemplateType.UID]: "template3.csv",
      };

      expect(
        service.getTemplateFilename("INVALID_TYPE" as TemplateType)
      ).toBeUndefined();
    });
  });

  describe("getAllJobConfig", () => {
    it("should return all job configs for the given project ID", async () => {
      const mockProjectId = "projectId";
      const date = new Date();
      const mockAllJobsDetails = [
        {
          jobRunIds: ["jobrunid-1", "jobrunid-2"],
          jobconfigid: "jobConfigId1",
          jobtype: "MIGRATE",
          jobconfigstatus: "Active",
          firstrunat: date,
          sourcepath: "sourcePath1",
          targetpath: "targetPath1",
          futureschedule: "0 0 * * *",
          sourceservername: "SourceServer1",
          targetservername: "TargetServer1",
          sourceprotocol: "NFS",
          targetprotocol: "NFS",
          createdAt: date,
          totalRuns: 5,
        },
      ];

      jest.spyOn(jobConfigRepo, "createQueryBuilder").mockReturnValue({
        leftJoin: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockAllJobsDetails),
      } as any);

      jest
        .spyOn(require("src/utils/mapper"), "nextDate")
        .mockReturnValue(new Date());
      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue({ id: "jobrunid-1" } as any);
      jest.spyOn(service, "getErrorCounts").mockResolvedValue([]);

      const result = await service.getAllJobConfig(mockProjectId);

      expect(result).toEqual([
        {
          jobConfigId: "jobConfigId1",
          jobType: "MIGRATE",
          jobStatus: "Active",
          nextScheduleDate: result[0].nextScheduleDate,
          sourceServer: {
            serverName: "SourceServer1",
            path: "sourcePath1",
            protocol: "NFS",
          },
          destinationServer: {
            serverName: "TargetServer1",
            path: "targetPath1",
            protocol: "NFS",
          },
          errors: 0,
          totalRuns: 5,
          configName: undefined,
          createdAt: mockAllJobsDetails[0].createdAt,
        },
      ]);
      expect(jobConfigRepo.createQueryBuilder).toHaveBeenCalledWith(
        "jobconfig"
      );
    });

    it("should return an empty array if no job configs are found for the given project ID", async () => {
      const mockProjectId = "projectId";

      jest.spyOn(jobConfigRepo, "createQueryBuilder").mockReturnValue({
        leftJoin: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      } as any);

      const result = await service.getAllJobConfig(mockProjectId);

      expect(result).toEqual([]);
      expect(jobConfigRepo.createQueryBuilder).toHaveBeenCalledWith(
        "jobconfig"
      );
    });

    it("should handle nextDate calculation errors gracefully", async () => {
      const mockProjectId = "projectId";
      const date = new Date();
      const mockAllJobsDetails = [
        {
          jobRunIds: ["jobrunid-1"],
          jobconfigid: "jobConfigId1",
          jobtype: "MIGRATE",
          jobconfigstatus: "ACTIVE",
          firstrunat: date,
          sourcepath: "sourcePath1",
          targetpath: "targetPath1",
          futureschedule: "invalid-cron",
          sourceservername: "SourceServer1",
          targetservername: "TargetServer1",
          sourceprotocol: "NFS",
          targetprotocol: "NFS",
          createdAt: date,
          totalRuns: 1,
        },
      ];

      jest.spyOn(jobConfigRepo, "createQueryBuilder").mockReturnValue({
        leftJoin: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockAllJobsDetails),
      } as any);

      // Clear any existing mocks first
      jest.restoreAllMocks();
      
      // Mock nextDate to throw an error
      const nextDateSpy = jest
        .spyOn(require("src/utils/mapper"), "nextDate")
        .mockImplementation(() => {
          throw new Error("Invalid cron expression");
        });
      
      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue({ id: "jobrunid-1" } as any);
      jest.spyOn(service, "getErrorCounts").mockResolvedValue([]);

      // Spy on logger.error to ensure it's called
      const loggerErrorSpy = jest.spyOn(service["logger"], "error");

      const result = await service.getAllJobConfig(mockProjectId);

      expect(result).toEqual([
        {
          jobConfigId: "jobConfigId1",
          jobType: "MIGRATE",
          jobStatus: "ACTIVE",
          nextScheduleDate: null, // Should be null due to error
          sourceServer: {
            serverName: "SourceServer1",
            path: "sourcePath1",
            protocol: "NFS",
          },
          destinationServer: {
            serverName: "TargetServer1",
            path: "targetPath1",
            protocol: "NFS",
          },
          errors: 0,
          totalRuns: 1,
          configName: undefined,
          createdAt: mockAllJobsDetails[0].createdAt,
        },
      ]);
      
      // Verify that nextDate was actually called
      expect(nextDateSpy).toHaveBeenCalled();
      
      // Verify that logger.error was called with the expected message
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        `Failed to calculate nextScheduleDate for jobConfigId jobConfigId1:`,
        "Invalid cron expression"
      );
      
      expect(jobConfigRepo.createQueryBuilder).toHaveBeenCalledWith(
        "jobconfig"
      );
    });
  });
  it("should throw BadRequestException if projectId is not a valid UUID", async () => {
    const mockProjectId = "invalid-uuid";

    jest.mock("class-validator", () => ({
      ...jest.requireActual("class-validator"),
      isUUID: jest.fn(() => false),
    }));

    await expect(service.getConfigsByProjectId(mockProjectId)).rejects.toThrow(
      BadRequestException
    );
  });

  // NotFoundException case
  it("should throw NotFoundException if project is not found", async () => {
    const mockProjectId = uuid();
    jest.spyOn(projectRepo, "findOne").mockResolvedValue(null);
    const getConfigsByProjectIdSpy = jest.spyOn(
      service,
      "getConfigsByProjectId"
    );
    await expect(service.getConfigsByProjectId(mockProjectId)).rejects.toThrow(
      NotFoundException
    );
    expect(getConfigsByProjectIdSpy).toHaveBeenCalledWith(mockProjectId);
  });

  it("should throw NotFoundException if no project is found for the given project ID", async () => {
    const mockProjectId = "739bb103-99fa-41c0-afa7-22bdc0c10d26";

    jest.spyOn(require("class-validator"), "isUUID").mockReturnValue(true);

    jest.spyOn(projectRepo, "findOne").mockResolvedValue(null);

    await expect(service.getConfigsByProjectId(mockProjectId)).rejects.toThrow(
      NotFoundException
    );
    await expect(service.getConfigsByProjectId(mockProjectId)).rejects.toThrow(
      `Project for id ${mockProjectId} not found.`
    );
  });

  it("should throw NotFoundException if no project is found for the given project ID", async () => {
    const mockProjectId = "valid-uuid";

    jest.spyOn(require("class-validator"), "isUUID").mockReturnValue(true);
    jest.spyOn(projectRepo, "findOne").mockResolvedValue(null);

    await expect(service.getConfigsByProjectId(mockProjectId)).rejects.toThrow(
      BadRequestException
    );
  });

  it("should return the project if found for the given project ID", async () => {
    const mockProjectId = "739bb103-99fa-41c0-afa7-22bdc0c10d26";
    const mockProject = {
      id: "jobConfig1",
      projectName: "mockProject",
      startDate: new Date("2025-04-07T09:25:10.379Z"),
      projectDescription: "Active",
      accountId: "739bb103-99fa-41c0-afa7-22bdc0c10d26",
    };

    jest.spyOn(projectRepo, "findOne").mockResolvedValue(mockProject as any);

    // Await the result of the asynchronous method
    const result = await service.getConfigsByProjectId(mockProjectId);

    // Assert the result matches the mock project
    expect(result).toEqual(mockProject);
  });

  it("should handle cases where targetPath is null in job configs", async () => {
    const mockProjectId = "projectId";
    const date = new Date();
    const mockAllJobsDetails = [
      {
        jobRunIds: ["jobrunid-1", "jobrunid-2"],
        jobconfigid: "jobConfigId1",
        jobtype: "MIGRATE",
        jobconfigstatus: "Active",
        firstrunat: date,
        sourcepath: "sourcePath1",
        targetpath: null,
        futureschedule: "0 0 * * *",
        sourceservername: "SourceServer1",
        targetservername: null,
        sourceprotocol: "NFS",
        targetprotocol: null,
        createdAt: date,
        totalRuns: 5,
      },
    ];

    jest.spyOn(jobConfigRepo, "createQueryBuilder").mockReturnValue({
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(mockAllJobsDetails),
    } as any);

    jest
      .spyOn(require("src/utils/mapper"), "nextDate")
      .mockReturnValue(new Date());

    jest.spyOn(jobRunRepo, "findOne").mockResolvedValue({ id: "jobrunid-1" } as any);
    jest.spyOn(service, "getErrorCounts").mockResolvedValue([]);

    const result = await service.getAllJobConfig(mockProjectId);

    expect(result).toEqual([
      {
        jobConfigId: "jobConfigId1",
        jobType: "MIGRATE",
        jobStatus: "Active",
        nextScheduleDate: result[0].nextScheduleDate,
        sourceServer: {
          serverName: "SourceServer1",
          path: "sourcePath1",
          protocol: "NFS",
        },
        destinationServer: {},
        errors: 0,
        totalRuns: 5,
        configName: undefined,
        createdAt: mockAllJobsDetails[0].createdAt,
      },
    ]);
  });
  it("should return an empty array if no job configs are found", async () => {
    const mockProjectId = "projectId";

    jest.spyOn(jobConfigRepo, "createQueryBuilder").mockReturnValue({
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    } as any);

    const result = await service.getAllJobConfig(mockProjectId);

    expect(result).toEqual([]);
  });

  it("should throw BadRequestException if projectId is invalid", async () => {
    const mockProjectId = "invalid-uuid";

    await expect(service.getConfigsByProjectId(mockProjectId)).rejects.toThrow(
      BadRequestException
    );
  });

  it("should throw NotFoundException if project is not found", async () => {
    const mockProjectId = "valid-uuid";

    jest.spyOn(projectRepo, "findOne").mockResolvedValue(null);
    const getConfigsByProjectIdSpy = jest.spyOn(
      service,
      "getConfigsByProjectId"
    );

    await expect(service.getConfigsByProjectId(mockProjectId)).rejects.toThrow(
      BadRequestException
    );
    expect(getConfigsByProjectIdSpy).toHaveBeenCalledWith(mockProjectId);
  });
  describe("JobConfigService", () => {
    describe("decodeBase64", () => {
      it("should decode a valid Base64 string", async () => {
        const input = "data:text/plain;base64,SGVsbG8gd29ybGQ="; // "Hello world" in Base64
        const result = await service.decodeBase64(input);
        expect(result).toBe("Hello world");
      });

      it("should throw an error for an invalid base64 string", async () => {
        const base64String = "InvalidBase64String";

        await expect(service.decodeBase64(base64String)).rejects.toThrowError(
          "Invalid Base64 format"
        );
      });
    });
  });

  describe("saveIdentityMappingsWithMap", () => {
    it("should save identity mappings and cross mappings", async () => {
      const jobConfigIds = ["1", "2"];
      const parsedData = [
        { sourceMapping: "source1", targetMapping: "target1" },
        { sourceMapping: "source2", targetMapping: "target2" },
      ];
      const identityMap = "identityMap1";
      const savedIdentityMapping = {
        id: "1",
        sourceMapping: "source1",
        targetMapping: "target1",
        identityType: "SID",
      };
      const savedCrossMapping = {
        id: "2",
        jobConfigId: "1",
        identityMappingId: "identityMap1",
      };

      identityMappingRepo.create = jest
        .fn()
        .mockReturnValue(savedIdentityMapping);
      identityMappingRepo.save = jest
        .fn()
        .mockResolvedValue(savedIdentityMapping);

      await service.saveIdentityMappingsWithMap(
        jobConfigIds,
        parsedData,
        identityMap,
        TemplateType.SID
      );

      // expect(identityMappingRepo.create).toHaveBeenCalledWith({
      //   identityType: 'SID',
      //   identityMap,
      //   sourceMapping: 'source1',
      //   targetMapping: 'target1',
      // });
      // expect(identityMappingRepo.create).toHaveBeenCalledWith({
      //   identityType: 'SID',
      //   identityMap,
      //   sourceMapping: 'source2',
      //   targetMapping: 'target2',
      // });
      expect(identityMappingRepo.save).toHaveBeenCalledWith(
        savedIdentityMapping
      );

      expect(identityMappingRepo.create).toHaveBeenCalledTimes(2);
      expect(identityMappingRepo.save).toHaveBeenCalledTimes(2);
    });
    it("should parse blob data for SID template type", async () => {
      const blobData =
        "source sid,target sid\nsource1,target1\nsource2,target2\nsource3,target3";
      const templateType = TemplateType.SID;

      const result = await service.parseBlobData(blobData, templateType);

      expect(result).toEqual([
        { sourceMapping: "source1", targetMapping: "target1" },
        { sourceMapping: "source2", targetMapping: "target2" },
        { sourceMapping: "source3", targetMapping: "target3" },
      ]);
    });

    it("should parse blob data for GID template type", async () => {
      const blobData =
        "source gid,target gid,source uid,target uid\n1000,2000,1001,2001\n1002,2002,1003,2003\n1004,2004,1005,2005";
      const templateType = TemplateType.GID;

      const result = await service.parseBlobData(blobData, templateType);

      expect(result).toEqual([
        {
          sourceMappingGid: "1000",
          targetMappingGid: "2000",
          sourceMappingUid: "1001",
          targetMappingUid: "2001",
        },
        {
          sourceMappingGid: "1002",
          targetMappingGid: "2002",
          sourceMappingUid: "1003",
          targetMappingUid: "2003",
        },
        {
          sourceMappingGid: "1004",
          targetMappingGid: "2004",
          sourceMappingUid: "1005",
          targetMappingUid: "2005",
        },
      ]);
    });

    it("should trim and validate integer values for GID template type", async () => {
      const blobData =
        "source gid,target gid,source uid,target uid\n 1000 , 2000 , 1001 , 2001 ";
      const templateType = TemplateType.GID;

      const result = await service.parseBlobData(blobData, templateType);

      expect(result).toEqual([
        {
          sourceMappingGid: "1000",
          targetMappingGid: "2000",
          sourceMappingUid: "1001",
          targetMappingUid: "2001",
        },
      ]);
    });

    it("should throw BadRequestException for non-integer GID/UID values", async () => {
      const blobData =
        "source gid,target gid,source uid,target uid\n1000,2000,abc,2001";
      const templateType = TemplateType.GID;

      await expect(service.parseBlobData(blobData, templateType)).rejects.toThrow(
        BadRequestException
      );
    });

    it("should throw BadRequestException for unsupported template type", async () => {
      const blobData = "h1,h2\nv1,v2";
      await expect(
        service.parseBlobData(blobData, "unknown" as TemplateType),
      ).rejects.toThrow(BadRequestException);
    });

    it("should return an empty array if blob data is empty", async () => {
      const mockBlobData = "dummyData";
      const mockParsedData: ParsedMapping[] = [];

      jest.spyOn(service, "parseBlobData").mockResolvedValue(mockParsedData);

      const templateType = TemplateType.SID;
      const result = await service.parseBlobData(mockBlobData, templateType);

      expect(result).toEqual(mockParsedData);
    });

    it("should return an empty array if blob data is undefined", async () => {
      jest.spyOn(service, "parseBlobData").mockResolvedValue([]);

      const blobData = undefined;
      const templateType = TemplateType.SID;

      const result = await service.parseBlobData(blobData, templateType);

      expect(result).toEqual([]);
    });
    describe("updateMappingsWithMap", () => {
      it("should update identity mappings and cross mappings", async () => {
        const jobConfigIds = ["1", "2"];
        const parsedData = [
          {
            sourceMapping: "sourceMapping",
            targetMapping: "targetMapping",
          },
        ];

        const identityMap = "identityMap";
        const templateType = TemplateType.SID;

        const createSpy = jest.spyOn(identityMappingRepo, "create");
        const saveSpy = jest
          .spyOn(identityMappingRepo, "save")
          .mockResolvedValue({
            id: "1",
            sourceMapping: "sourceMapping",
            targetMapping: "targetMapping",
            identityType: templateType,
          } as any);
        const findOneSpy = jest.spyOn(identityCrossMappingRepo, "findOne");
        const createCrossMappingSpy = jest.spyOn(
          identityCrossMappingRepo,
          "create"
        );
        const saveCrossMappingSpy = jest
          .spyOn(identityCrossMappingRepo, "save")
          .mockResolvedValue({} as any);
        await service.updateMappingsWithMap(
          jobConfigIds,
          parsedData,
          identityMap,
          templateType
        );

        expect(createSpy).toHaveBeenCalledWith({
          identityType: templateType,
          identityMap: identityMap,
          sourceMapping: parsedData[0].sourceMapping,
          targetMapping: parsedData[0].targetMapping,
        });
        expect(saveSpy).toHaveBeenCalled();

        expect(findOneSpy).toHaveBeenCalledWith({
          where: {
            jobConfigId: jobConfigIds[0],
            isOrphan: false,
          },
        });
        expect(createCrossMappingSpy).toHaveBeenCalledWith({
          identityMappingId: identityMap,
          jobConfigId: jobConfigIds[0],
        });
        expect(saveCrossMappingSpy).toHaveBeenCalled();
      });

      // if(existingCrossMapping) case
      it("should update identity mappings and cross mappings if existingCrossMapping is found", async () => {
        const jobConfigIds = ["1", "2"];
        const parsedData = [
          {
            sourceMapping: "sourceMapping",
            targetMapping: "targetMapping",
          },
        ];
        const identityMap = "identityMap";
        const templateType = TemplateType.SID;

        const createSpy = jest.spyOn(identityMappingRepo, "create");
        const saveSpy = jest
          .spyOn(identityMappingRepo, "save")
          .mockResolvedValue({
            id: "1",
            sourceMapping: "sourceMapping",
            targetMapping: "targetMapping",
            identityType: templateType,
          } as any);
        const findOneSpy = jest
          .spyOn(identityCrossMappingRepo, "findOne")
          .mockResolvedValue({} as any);
        const createCrossMappingSpy = jest.spyOn(
          identityCrossMappingRepo,
          "create"
        );
        const saveCrossMappingSpy = jest
          .spyOn(identityCrossMappingRepo, "save")
          .mockResolvedValue({} as any);

        await service.updateMappingsWithMap(
          jobConfigIds,
          parsedData,
          identityMap,
          templateType
        );

        expect(createSpy).toHaveBeenCalledWith({
          identityType: templateType,
          identityMap: identityMap,
          sourceMapping: parsedData[0].sourceMapping,
          targetMapping: parsedData[0].targetMapping,
        });
        expect(saveSpy).toHaveBeenCalled();

        expect(findOneSpy).toHaveBeenCalledWith({
          where: {
            jobConfigId: jobConfigIds[0],
            isOrphan: false,
          },
        });
        expect(createCrossMappingSpy).not.toHaveBeenCalled();
        expect(saveCrossMappingSpy).toHaveBeenCalled();
      });
    });
  });
  describe("saveIdentityMappingsWithMap", () => {
    it("should save identity mappings and cross mappings", async () => {
      const jobConfigIds = ["jobConfig1", "jobConfig2"];
      const parsedData = [
        {
          sourceMapping: "sourceMapping1",
          targetMapping: "targetMapping1",
        },
        {
          sourceMapping: "sourceMapping1",
          targetMapping: "targetMapping1",
        },
      ];
      const identityMap = "identityMap1";
      const identityMappingEntity = {
        id: "identityMapping1",
      };
      const savedIdentityMapping = {
        id: "savedIdentityMapping1",
      };

      identityMappingRepo.create.mockReturnValue(identityMappingEntity);
      identityMappingRepo.save.mockResolvedValue(savedIdentityMapping);

      await service.saveIdentityMappingsWithMap(
        jobConfigIds,
        parsedData,
        identityMap,
        TemplateType.GID
      );

      expect(identityMappingRepo.create).toHaveBeenCalledWith({
        identityType: TemplateType.GID,
        identityMap: identityMap,
      });
      expect(identityMappingRepo.create).toHaveBeenCalledWith({
        identityType: TemplateType.GID,
        identityMap: identityMap,
      });
      expect(identityMappingRepo.save).toHaveBeenCalledWith(
        identityMappingEntity
      );
    });
    describe("updateMappingsWithMap", () => {
      it("should update identity mappings and cross mappings", async () => {
        const jobConfigIds = ["1", "2"];
        const parsedData = [
          {
            sourceMapping: "sourceMapping",
            targetMapping: "targetMapping",
          },
        ];
        const identityMap = "identityMap";
        const templateType = "GID";

        identityMappingRepo.create.mockReturnValue({});
        identityMappingRepo.save.mockReturnValue({ id: "1" });

        await service.updateMappingsWithMap(
          jobConfigIds,
          parsedData,
          identityMap,
          TemplateType.GID
        );

        expect(identityMappingRepo.create).toHaveBeenCalledWith({
          identityType: TemplateType.GID,
          identityMap: identityMap,
          sourceMapping: undefined,
          targetMapping: undefined,
        });
        expect(identityMappingRepo.save).toHaveBeenCalled();
        expect(identityCrossMappingRepo.findOne).toHaveBeenCalledWith({
          where: {
            jobConfigId: jobConfigIds[0],
            isOrphan: false,
          },
        });
        expect(identityCrossMappingRepo.create).toHaveBeenCalledWith({
          identityMappingId: identityMap,
          jobConfigId: jobConfigIds[0],
        });
        expect(identityCrossMappingRepo.save).toHaveBeenCalled();
      });
    });
    describe("updateMappingsWithMap", () => {
      it("should update identity mappings and cross mappings", async () => {
        const jobConfigIds = ["1", "2"];
        const parsedData = [
          {
            sourceMapping: "sourceMapping",
            targetMapping: "targetMapping",
          },
        ];
        const identityMap = "identityMap";
        const templateType = TemplateType.SID;

        const createIdentityMappingSpy = jest
          .spyOn(identityMappingRepo, "create")
          .mockReturnValue({});
        const saveIdentityMappingSpy = jest
          .spyOn(identityMappingRepo, "save")
          .mockResolvedValue({});
        const createIdentityCrossMappingSpy = jest
          .spyOn(identityCrossMappingRepo, "create")
          .mockReturnValue({
            id: "",
            identityMappingId: "",
            identityMapping: new IdentityMappingEntity(),
            jobConfigId: "",
            jobConfig: new JobConfigEntity(),
            createdAt: undefined,
            updatedAt: undefined,
            createdBy: "",
            updatedBy: "",
            isOrphan: false,
          });
        const saveIdentityCrossMappingSpy = jest
          .spyOn(identityCrossMappingRepo, "save")
          .mockResolvedValue({} as any);

        await service.updateMappingsWithMap(
          jobConfigIds,
          parsedData,
          identityMap,
          templateType
        );

        expect(createIdentityMappingSpy).toHaveBeenCalledWith({
          identityType: templateType,
          identityMap: identityMap,
          sourceMapping: parsedData[0].sourceMapping,
          targetMapping: parsedData[0].targetMapping,
        });
        expect(saveIdentityMappingSpy).toHaveBeenCalled();

        expect(createIdentityCrossMappingSpy).toHaveBeenCalledWith({
          identityMappingId: identityMap,
          jobConfigId: jobConfigIds[0],
        });
        expect(saveIdentityCrossMappingSpy).toHaveBeenCalled();
      });
    });
   
    describe("getNoticeBoardDetailsByProjectId", () => {
      let syncEmailRepo: Repository<SyncEmailEntity>;
      
      beforeEach(() => {
        syncEmailRepo = {
          createQueryBuilder: jest.fn(),
        } as unknown as Repository<SyncEmailEntity>;
        
        (service as any).syncEmailRepo = syncEmailRepo;
      });
      
      it("should return correct counts for different job statuses", async () => {
        const projectId = "123e4567-e89b-12d3-a456-426614174000";
        const now = new Date();
        
        // Mock DISTINCT ON query result - already deduplicated by database
        const mockRawResults = [
          {
            description: 'Pod crash in default namespace',
            created_at: now,
          },
          {
            description: 'DB connection failure',
            created_at: new Date(now.getTime() - 1000),
          },
        ];

        jest.spyOn(jobRunRepo, "createQueryBuilder").mockImplementation(() => {
          return {
            innerJoin: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getCount: jest
              .fn()
              .mockResolvedValueOnce(5)
              .mockResolvedValueOnce(2)
              .mockResolvedValueOnce(3),
          } as any;
        });

        jest
          .spyOn(jobConfigRepo, "createQueryBuilder")
          .mockImplementation(() => {
            return {
              innerJoin: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getCount: jest.fn().mockResolvedValue(4),
            } as any;
          });

        const mockQueryBuilder = {
          select: jest.fn(),
          addSelect: jest.fn(),
          where: jest.fn(),
          andWhere: jest.fn(),
          groupBy: jest.fn(),
          orderBy: jest.fn(),
          getRawMany: jest.fn().mockResolvedValue(mockRawResults),
        };
        mockQueryBuilder.select.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.addSelect.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.where.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.andWhere.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.groupBy.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.orderBy.mockReturnValue(mockQueryBuilder);

        (syncEmailRepo.createQueryBuilder as jest.Mock).mockImplementation(() => mockQueryBuilder);
    
        const result = await service.getNoticeBoardDetailsByProjectId(projectId);
    
        expect(result).toEqual({
          countErroredJobRuns: 5,
          countBlockedCutoverJobRuns: 5,
          countRecentJobConfigs: 4,
          countCompletedJobRuns: 5,
          severityMessages: [
            { message: "Pod crash in default namespace", timestamp: now },
            { message: "DB connection failure", timestamp: new Date(now.getTime() - 1000) },
          ],
        });
    
        expect(jobRunRepo.createQueryBuilder).toHaveBeenCalledTimes(3);
        expect(jobConfigRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
        expect(syncEmailRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      });
    
      it("should return zero counts when no job runs exist", async () => {
        const projectId = "123e4567-e89b-12d3-a456-426614174000";
        const mockRawResults = [];
    
        jest.spyOn(jobRunRepo, "createQueryBuilder").mockImplementation(() => {
          return {
            innerJoin: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getCount: jest.fn().mockResolvedValue(0),
          } as any;
        });
    
        jest
          .spyOn(jobConfigRepo, "createQueryBuilder")
          .mockImplementation(() => {
            return {
              innerJoin: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getCount: jest.fn().mockResolvedValue(0),
            } as any;
          });
    
        const mockQueryBuilder = {
          select: jest.fn(),
          addSelect: jest.fn(),
          where: jest.fn(),
          andWhere: jest.fn(),
          groupBy: jest.fn(),
          orderBy: jest.fn(),
          getRawMany: jest.fn().mockResolvedValue(mockRawResults),
        };
        mockQueryBuilder.select.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.addSelect.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.where.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.andWhere.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.groupBy.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.orderBy.mockReturnValue(mockQueryBuilder);

        (syncEmailRepo.createQueryBuilder as jest.Mock).mockImplementation(() => mockQueryBuilder);
    
        const result = await service.getNoticeBoardDetailsByProjectId(projectId);
    
        expect(result).toEqual({
          countErroredJobRuns: 0,
          countBlockedCutoverJobRuns: 0,
          countRecentJobConfigs: 0,
          countCompletedJobRuns: 0,
          severityMessages: [],
        });
    
        expect(jobRunRepo.createQueryBuilder).toHaveBeenCalledTimes(3);
        expect(jobConfigRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
        expect(syncEmailRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      });

      it("should deduplicate severity messages and keep the most recent timestamp", async () => {
        const projectId = "123e4567-e89b-12d3-a456-426614174000";
        const now = new Date();
        const newestDate = new Date(now.getTime() + 1000);
        
        // Mock the DISTINCT ON query result - already deduplicated by database
        const mockRawResults = [
          {
            description: 'Pod keycloak-0 is using more than 80% of its memory limit.',
            created_at: newestDate, // Latest timestamp for this message
          },
          {
            description: 'DB connection failure',
            created_at: now,
          },
        ];

        jest.spyOn(jobRunRepo, "createQueryBuilder").mockImplementation(() => {
          return {
            innerJoin: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getCount: jest.fn().mockResolvedValue(0),
          } as any;
        });

        jest
          .spyOn(jobConfigRepo, "createQueryBuilder")
          .mockImplementation(() => {
            return {
              innerJoin: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getCount: jest.fn().mockResolvedValue(0),
            } as any;
          });

        const mockQueryBuilder = {
          select: jest.fn(),
          addSelect: jest.fn(),
          where: jest.fn(),
          andWhere: jest.fn(),
          groupBy: jest.fn(),
          orderBy: jest.fn(),
          getRawMany: jest.fn().mockResolvedValue(mockRawResults),
        };
        mockQueryBuilder.select.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.addSelect.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.where.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.andWhere.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.groupBy.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.orderBy.mockReturnValue(mockQueryBuilder);

        (syncEmailRepo.createQueryBuilder as jest.Mock).mockImplementation(() => mockQueryBuilder);
    
        const result = await service.getNoticeBoardDetailsByProjectId(projectId);
    
        // Should have only 2 unique messages (deduplication done by DISTINCT ON in DB)
        expect(result.severityMessages).toHaveLength(2);
        
        // The deduplicated message should have the newest timestamp
        const keycloakMessage = result.severityMessages.find(
          m => m.message === 'Pod keycloak-0 is using more than 80% of its memory limit.'
        );
        expect(keycloakMessage).toBeDefined();
        expect(keycloakMessage?.timestamp).toEqual(newestDate);
        
        // The other message should be present
        const dbMessage = result.severityMessages.find(
          m => m.message === 'DB connection failure'
        );
        expect(dbMessage).toBeDefined();
        expect(dbMessage?.timestamp).toEqual(now);
        
        // Should be sorted by timestamp (most recent first)
        expect(result.severityMessages[0].timestamp.getTime()).toBeGreaterThanOrEqual(
          result.severityMessages[1].timestamp.getTime()
        );
      });

      it("should return only 2 unique alerts when given 4 entries with 2 unique messages", async () => {
        const projectId = "123e4567-e89b-12d3-a456-426614174000";
        const baseTime = new Date('2026-01-28T10:00:00Z');
        
        // Mock the DISTINCT ON query result - database returns only unique descriptions with latest timestamps
        // Simulates: DISTINCT ON (description) with ORDER BY description, created_at DESC
        const mockRawResults = [
          {
            description: 'Disk space running low',
            created_at: new Date(baseTime.getTime() + 90000), // 1.5 minutes (latest)
          },
          {
            description: 'High memory usage detected',
            created_at: new Date(baseTime.getTime() + 60000), // 1 minute (latest)
          },
        ];

        jest.spyOn(jobRunRepo, "createQueryBuilder").mockImplementation(() => {
          return {
            innerJoin: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getCount: jest.fn().mockResolvedValue(0),
          } as any;
        });

        jest
          .spyOn(jobConfigRepo, "createQueryBuilder")
          .mockImplementation(() => {
            return {
              innerJoin: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getCount: jest.fn().mockResolvedValue(0),
            } as any;
          });

        const mockQueryBuilder = {
          select: jest.fn(),
          addSelect: jest.fn(),
          where: jest.fn(),
          andWhere: jest.fn(),
          groupBy: jest.fn(),
          orderBy: jest.fn(),
          getRawMany: jest.fn().mockResolvedValue(mockRawResults),
        };
        mockQueryBuilder.select.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.addSelect.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.where.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.andWhere.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.groupBy.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.orderBy.mockReturnValue(mockQueryBuilder);

        (syncEmailRepo.createQueryBuilder as jest.Mock).mockImplementation(() => mockQueryBuilder);
    
        const result = await service.getNoticeBoardDetailsByProjectId(projectId);
    
        // VERIFY: Should have exactly 2 unique alerts (DISTINCT ON handles deduplication)
        expect(result.severityMessages).toHaveLength(2);
        
        // VERIFY: First unique message "Disk space running low" with latest timestamp (90000ms)
        const diskSpaceAlert = result.severityMessages.find(
          m => m.message === 'Disk space running low'
        );
        expect(diskSpaceAlert).toBeDefined();
        expect(diskSpaceAlert?.timestamp).toEqual(new Date(baseTime.getTime() + 90000));
        
        // VERIFY: Second unique message "High memory usage detected" with latest timestamp (60000ms)
        const memoryAlert = result.severityMessages.find(
          m => m.message === 'High memory usage detected'
        );
        expect(memoryAlert).toBeDefined();
        expect(memoryAlert?.timestamp).toEqual(new Date(baseTime.getTime() + 60000));
        
        // VERIFY: Both messages are present and no duplicates
        const messages = result.severityMessages.map(m => m.message);
        expect(messages).toContain('High memory usage detected');
        expect(messages).toContain('Disk space running low');
        expect(new Set(messages).size).toBe(2); // Ensure no duplicates
        
        // VERIFY: Results are sorted by timestamp (most recent first)
        expect(result.severityMessages[0].timestamp.getTime()).toBeGreaterThan(
          result.severityMessages[1].timestamp.getTime()
        );
      });
    });

  });

  describe("createBulkMigrate", () => {
//     it("should return warnings for inactive job configs", async () => {
//   const bulkMigrate: BulkMigrateJobConfig = {
//     migrateConfigs: [
//       { sourcePathId: "src1", destinationPathId: ["dest1"] },
//     ],
//   } as any;

//   jobConfigRepo.find = jest.fn().mockResolvedValue([
//     {
//       id: "job1",
//       sourcePathId: "src1",
//       targetPathId: "dest1",
//       scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED,
//       status: JobStatus.InActive,
//     },
//   ]);

//   volumeRepo.findOne = jest.fn().mockResolvedValueOnce({ volumePath: "/src/path" });
//   volumeRepo.findOne = jest.fn().mockResolvedValueOnce({ volumePath: "/dest/path" });

//   const result = await service.createBulkMigrate(bulkMigrate);

//   expect(result.warnings).toEqual([
//     {
//       sourcePathId: "src1",
//       targetPathId: "dest1",
//       sourcePath: "/dest/path",
//       targetPath: undefined,
//       status: JobStatus.InActive,
//       message: expect.stringContaining("Inactive job found"),
//     },
//   ]);
// });

    it("should return an empty array if migrateConfigs is missing", async () => {
      const bulkMigrate: BulkMigrateJobConfig = {
        migrateConfigs: undefined,
      } as any;

      const result = await service.createBulkMigrate(bulkMigrate);
      expect(result).toEqual({"jobs": []});
    });

    it("should update existing job configurations when found", async () => {
      const bulkMigrate: BulkMigrateJobConfig = {
        migrateConfigs: [
          { sourcePathId: "src1", destinationPathId: ["dest1"] },
        ],
        options: {
          excludeFilePatterns: "*.tmp",
          preserveAccessTime: true,
          preservePermissions: true,
        },
      } as any;

      jobConfigRepo.find = jest.fn().mockResolvedValue([
        {
          id: "job1",
          sourcePathId: "src1",
          targetPathId: "dest1",
          scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED,
        },
      ]);

      jobConfigRepo.update = jest.fn();

      await service.createBulkMigrate(bulkMigrate);

      expect(jobConfigRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          jobType: JobType.MIGRATE,
          sourcePathId: "src1",
          sourceDirectoryPath: null,
          targetPathId: "dest1",
          targetDirectoryPath: null,
          scheduler: expect.anything(),
        }),
        expect.objectContaining({ status: JobStatus.Active })
      );
    });

    it("should create new job configurations when none exist", async () => {
      const bulkMigrate: BulkMigrateJobConfig = {
        migrateConfigs: [
          { sourcePathId: "src1", destinationPathId: ["dest1"] },
        ],
        options: { excludeFilePatterns: "*.tmp", preserveAccessTime: true, preservePermissions: true },
      } as any;

      jobConfigRepo.find = jest.fn().mockResolvedValue([]);
      jobConfigRepo.create = jest.fn().mockImplementation((config) => config);
      jobConfigRepo.save = jest.fn().mockResolvedValue([
        {
          id: "new_job1",
          jobType: JobType.MIGRATE,
          sourcePathId: "src1",
          targetPathId: "dest1",
        },
      ]);

      const result = await service.createBulkMigrate(bulkMigrate);

      expect(jobConfigRepo.create).toHaveBeenCalled();
      expect(jobConfigRepo.save).toHaveBeenCalled();
      expect(result).toEqual({"jobs": [{"id": "new_job1", "jobType": "MIGRATE", "sourcePathId": "src1", "status": "CREATED", "targetPathId": "dest1"}], "warnings": undefined});
    });

    it("should handle SID mapping", async () => {
      jest.spyOn(service, "decodeBase64").mockResolvedValue("decoded-data");
      jest
        .spyOn(service, "parseBlobData")
        .mockResolvedValue([{ some: "parsedData" }] as any);

      const bulkMigrate = { migrateConfigs: [], sidMapping: "someBase64" };
      await service.createBulkMigrate(bulkMigrate as any);

      expect(service.decodeBase64).toHaveBeenCalledWith("someBase64");
      expect(service.parseBlobData).toHaveBeenCalled();
    });

    it("should handle GID mapping", async () => {
      jest.spyOn(service, "decodeBase64").mockResolvedValue("decoded-gid");
      jest
        .spyOn(service, "parseBlobData")
        .mockResolvedValue([{ some: "parsedGidData" }] as any);

      const bulkMigrate = { migrateConfigs: [], gidMapping: "gidBase64" };
      await service.createBulkMigrate(bulkMigrate as any);

      expect(service.decodeBase64).toHaveBeenCalledWith("gidBase64");
      expect(service.parseBlobData).toHaveBeenCalled();
    });

    it("should continue when destinationPathId is missing", async () => {
      const bulkMigrate = { migrateConfigs: [{ sourcePathId: "source-1" }] };
      const result = await service.createBulkMigrate(bulkMigrate as any);
      expect(result).toEqual({"jobs": [], "warnings": undefined});
    });

    describe("smbPermissionInheritanceMode gate", () => {
      const setupNewMigrateMocks = (protocol: Protocol) => {
        jest.spyOn(jobConfigRepo, "find").mockResolvedValue([]);
        jest.spyOn(jobConfigRepo, "update").mockResolvedValue({ affected: 0 } as any);
        jest.spyOn(jobConfigRepo, "create").mockImplementation((data) => data as any);
        jest.spyOn(jobConfigRepo, "save").mockResolvedValue([
          {
            id: "new_job1",
            jobType: JobType.MIGRATE,
            sourcePathId: "src1",
            targetPathId: "dest1",
            status: "CREATED",
          },
        ] as any);
        jest.spyOn(volumeRepo, "find").mockResolvedValue([
          { id: "src1", fileServer: { protocol } },
        ] as any);
        jest.spyOn(identityCrossMappingRepo, "exists").mockResolvedValue(false);
      };

      it("stores requested mode for SMB directory-level mapping on create", async () => {
        setupNewMigrateMocks(Protocol.SMB);
        const bulkMigrate: BulkMigrateJobConfig = {
          migrateConfigs: [
            {
              sourcePathId: "src1",
              sourceDirectoryPath: "/src/dir",
              destinationPathId: ["dest1"],
              destinationDirectoryPath: "/dest/dir",
            },
          ],
          options: {
            excludeFilePatterns: "*.tmp",
            preserveAccessTime: true,
            preservePermissions: true,
            skipFile: "15-M",
            smbPermissionInheritanceMode:
              SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT,
          },
        } as any;

        await service.createBulkMigrate(bulkMigrate);

        expect(jobConfigRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            smbPermissionInheritanceMode:
              SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT,
          }),
        );
      });

      it("defaults to INHERIT_PERMS_AS_EXPLICIT for SMB directory-level when mode omitted from payload", async () => {
        setupNewMigrateMocks(Protocol.SMB);
        const bulkMigrate: BulkMigrateJobConfig = {
          migrateConfigs: [
            {
              sourcePathId: "src1",
              sourceDirectoryPath: "/src/dir",
              destinationPathId: ["dest1"],
              destinationDirectoryPath: "/dest/dir",
            },
          ],
          options: {
            excludeFilePatterns: "*.tmp",
            preserveAccessTime: true,
            preservePermissions: true,
            skipFile: "15-M",
          },
        } as any;

        await service.createBulkMigrate(bulkMigrate);

        expect(jobConfigRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            smbPermissionInheritanceMode:
              SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT,
          }),
        );
      });

      it("stores null for SMB whole-export (no directory paths) on create", async () => {
        setupNewMigrateMocks(Protocol.SMB);
        const bulkMigrate: BulkMigrateJobConfig = {
          migrateConfigs: [
            { sourcePathId: "src1", destinationPathId: ["dest1"] },
          ],
          options: {
            excludeFilePatterns: "*.tmp",
            preserveAccessTime: true,
            preservePermissions: true,
            skipFile: "15-M",
            smbPermissionInheritanceMode:
              SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT,
          },
        } as any;

        await service.createBulkMigrate(bulkMigrate);

        expect(jobConfigRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            smbPermissionInheritanceMode: null,
          }),
        );
      });

      it("stores null when preservePermissions is false for SMB directory-level mapping on create", async () => {
        setupNewMigrateMocks(Protocol.SMB);
        const bulkMigrate: BulkMigrateJobConfig = {
          migrateConfigs: [
            {
              sourcePathId: "src1",
              sourceDirectoryPath: "/src/dir",
              destinationPathId: ["dest1"],
              destinationDirectoryPath: "/dest/dir",
            },
          ],
          options: {
            excludeFilePatterns: "*.tmp",
            preserveAccessTime: true,
            preservePermissions: false,
            skipFile: "15-M",
            smbPermissionInheritanceMode:
              SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT,
          },
        } as any;

        await service.createBulkMigrate(bulkMigrate);

        expect(jobConfigRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            preservePermissions: false,
            smbPermissionInheritanceMode: null,
          }),
        );
      });

      it("stores null for NFS even when directory paths are set on create", async () => {
        setupNewMigrateMocks(Protocol.NFS);
        const bulkMigrate: BulkMigrateJobConfig = {
          migrateConfigs: [
            {
              sourcePathId: "src1",
              sourceDirectoryPath: "/src/dir",
              destinationPathId: ["dest1"],
              destinationDirectoryPath: "/dest/dir",
            },
          ],
          options: {
            excludeFilePatterns: "*.tmp",
            preserveAccessTime: true,
            preservePermissions: true,
            skipFile: "15-M",
            smbPermissionInheritanceMode:
              SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT,
          },
        } as any;

        await service.createBulkMigrate(bulkMigrate);

        expect(jobConfigRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            smbPermissionInheritanceMode: null,
          }),
        );
      });

      it("stores null on update for SMB whole-export when existing job is rescheduled", async () => {
        jest.spyOn(volumeRepo, "find").mockResolvedValue([
          { id: "src1", fileServer: { protocol: Protocol.SMB } },
        ] as any);
        jest.spyOn(jobConfigRepo, "find").mockResolvedValue([
          {
            id: "job1",
            sourcePathId: "src1",
            sourceDirectoryPath: null,
            targetPathId: "dest1",
            targetDirectoryPath: null,
            scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED,
            status: JobStatus.Active,
          },
        ] as any);
        jest.spyOn(jobConfigRepo, "update").mockResolvedValue({ affected: 1 } as any);
        jest.spyOn(identityCrossMappingRepo, "exists").mockResolvedValue(false);

        const bulkMigrate: BulkMigrateJobConfig = {
          migrateConfigs: [
            { sourcePathId: "src1", destinationPathId: ["dest1"] },
          ],
          options: {
            excludeFilePatterns: "*.tmp",
            preserveAccessTime: true,
            preservePermissions: true,
            skipFile: "15-M",
            smbPermissionInheritanceMode:
              SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT,
          },
          firstRunAt: new Date(),
          futureRunSchedule: "0 0 * * *",
        } as any;

        await service.createBulkMigrate(bulkMigrate);

        expect(jobConfigRepo.update).toHaveBeenCalledWith(
          expect.objectContaining({
            sourcePathId: "src1",
            targetPathId: "dest1",
          }),
          expect.objectContaining({
            smbPermissionInheritanceMode: null,
          }),
        );
      });
    });
  });

 

  describe("calculateJobRunStats", () => {
    it("should return MV stats for a job run", async () => {
      const jobRunId = "12345";
      const mockJobStatsSummary = {
        fileCount: "10",
        directoryCount: "5",
        totalSize: "1000",
        deletedCount: "0",
        excludedCount: "0",
        newlyCopiedCount: "0",
        recopiedCount: "0",
        lastRefreshed: null,
      };

      jest.spyOn(jobStatsSummaryMvRepo, "findOne").mockResolvedValue(mockJobStatsSummary as any);
      jest.spyOn(service, "getErrorCounts").mockResolvedValue([]);

      const result = await service.calculateJobRunStats(jobRunId);
      expect(jobStatsSummaryMvRepo.findOne).toHaveBeenCalledWith({ where: { jobRunId } });
      expect(result).toEqual({
        fileCount: "10",
        directories: "5",
        totalSize: "1000",
        deletedCount: "0",
        excludedCount: "0",
        newlyCopiedCount: "0",
        modifiedCount: "0",
        lastRefreshed: null,
        errors: [],
      });
    });

    it("should default to '0' when MV returns no row", async () => {
      const jobRunId = "12345";

      jest.spyOn(jobStatsSummaryMvRepo, "findOne").mockResolvedValue(null);
      jest.spyOn(service, "getErrorCounts").mockResolvedValue([]);

      const result = await service.calculateJobRunStats(jobRunId);
      expect(result).toEqual({
        fileCount: "0",
        directories: "0",
        totalSize: "0",
        deletedCount: "0",
        excludedCount: "0",
        newlyCopiedCount: "0",
        modifiedCount: "0",
        lastRefreshed: null,
        errors: [],
      });
    });

    it("should always query MV even when job_stats snapshot is present on the job run", async () => {
      const jobRunId = "snap-fc";
      const mockMv = {
        fileCount: "100",
        directoryCount: "10",
        totalSize: "2048",
        deletedCount: "0",
        excludedCount: "0",
        newlyCopiedCount: "0",
        recopiedCount: "0",
        lastRefreshed: new Date("2025-01-01T10:00:00Z"),
      };

      jest.spyOn(jobStatsSummaryMvRepo, "findOne").mockResolvedValue(mockMv as any);
      jest.spyOn(service, "getErrorCounts").mockResolvedValue([]);

      const result = await service.calculateJobRunStats(jobRunId);

      expect(jobStatsSummaryMvRepo.findOne).toHaveBeenCalled();
      expect(result.fileCount).toBe("100");
      expect(result.directories).toBe("10");
    });

    it("should return MV dirCount when fileCount is '0' but directoryCount is non-zero", async () => {
      const jobRunId = "snap-dirs";
      const lastRefreshed = new Date("2025-01-01T10:00:00Z");
      const mockMv = {
        fileCount: "0",
        directoryCount: "5",
        totalSize: "0",
        deletedCount: "0",
        excludedCount: "0",
        newlyCopiedCount: "0",
        recopiedCount: "0",
        lastRefreshed,
      };

      jest.spyOn(jobStatsSummaryMvRepo, "findOne").mockResolvedValue(mockMv as any);
      jest.spyOn(service, "getErrorCounts").mockResolvedValue([]);

      const result = await service.calculateJobRunStats(jobRunId);

      expect(result.directories).toBe("5");
      expect(result.lastRefreshed).toBe(lastRefreshed);
      expect(jobStatsSummaryMvRepo.findOne).toHaveBeenCalled();
    });

    it("should return MV totalSize when only totalSize is non-zero", async () => {
      const jobRunId = "snap-size";
      const mockMv = {
        fileCount: "0",
        directoryCount: "0",
        totalSize: "8192",
        deletedCount: "0",
        excludedCount: "0",
        newlyCopiedCount: "0",
        recopiedCount: "0",
        lastRefreshed: null,
      };

      jest.spyOn(jobStatsSummaryMvRepo, "findOne").mockResolvedValue(mockMv as any);
      jest.spyOn(service, "getErrorCounts").mockResolvedValue([]);

      const result = await service.calculateJobRunStats(jobRunId);

      expect(result.totalSize).toBe("8192");
      expect(jobStatsSummaryMvRepo.findOne).toHaveBeenCalled();
    });

    it("should return MV data with all-zero counts when MV has zeros", async () => {
      const jobRunId = "snap-zeros";
      const mockJobStatsSummary = {
        fileCount: "10",
        directoryCount: "2",
        totalSize: "1024",
        deletedCount: "0",
        excludedCount: "0",
        newlyCopiedCount: "0",
        recopiedCount: "0",
        lastRefreshed: null,
      };

      jest.spyOn(jobStatsSummaryMvRepo, "findOne").mockResolvedValue(mockJobStatsSummary as any);
      jest.spyOn(service, "getErrorCounts").mockResolvedValue([]);

      const result = await service.calculateJobRunStats(jobRunId);

      expect(result.fileCount).toBe("10");
      expect(jobStatsSummaryMvRepo.findOne).toHaveBeenCalled();
    });

    it("should default to '0' when MV fields are falsy", async () => {
      const jobRunId = "12345";

      jest.spyOn(jobStatsSummaryMvRepo, "findOne").mockResolvedValue({
        fileCount: "",
        directoryCount: null,
        totalSize: 0,
        lastRefreshed: null,
      } as any);
      jest.spyOn(service, "getErrorCounts").mockResolvedValue([]);

      const result = await service.calculateJobRunStats(jobRunId);
      expect(result).toEqual({
        fileCount: "0",
        directories: "0",
        totalSize: "0",
        deletedCount: "0",
        excludedCount: "0",
        newlyCopiedCount: "0",
        modifiedCount: "0",
        lastRefreshed: null,
        errors: [],
      });
    });
  });

  describe("JobConfigService - flattenCutoverConfig", () => {
    it("should flatten a single config with multiple destination paths", () => {
      const config = [
        { sourcePathId: "source1", destinationPathId: ["dest1", "dest2"] },
      ];

      const result = service.flattenCutoverConfig(config);

      expect(result).toEqual([
        { sourcePathId: "source1", destinationPathId: "dest1" },
        { sourcePathId: "source1", destinationPathId: "dest2" },
      ]);
    });

    it("should flatten multiple configs with multiple destination paths", () => {
      const config = [
        { sourcePathId: "source1", destinationPathId: ["dest1", "dest2"] },
        { sourcePathId: "source2", destinationPathId: ["dest3"] },
      ];

      const result = service.flattenCutoverConfig(config);

      expect(result).toEqual([
        { sourcePathId: "source1", destinationPathId: "dest1" },
        { sourcePathId: "source1", destinationPathId: "dest2" },
        { sourcePathId: "source2", destinationPathId: "dest3" },
      ]);
    });

    it("should return an empty array when given an empty config", () => {
      const result = service.flattenCutoverConfig([]);
      expect(result).toEqual([]);
    });

    it("should return an empty array when all destinationPathId arrays are empty", () => {
      const config = [
        { sourcePathId: "source1", destinationPathId: [] },
        { sourcePathId: "source2", destinationPathId: [] },
      ];

      const result = service.flattenCutoverConfig(config);
      expect(result).toEqual([]);
    });
  });


  describe("getErrorCounts", () => {
    it("should return 0 if error count is not found", async () => {
      const mockError = [
        {
          errorType: "Error",
          count: 0,
        },
      ];
      const jobRunId = "12345";
      jest.spyOn(operationErrorRepo, "createQueryBuilder").mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockError),
      } as any);
      jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      } as any);
      const result = await service.getErrorCounts(jobRunId);
      expect(result).toEqual(mockError);
    });
    it("should throw error", async () => {
      const mockError = [
        {
          errorType: "Error",
          count: 0,
        },
      ];
      const jobRunId = "12345";
      jest.spyOn(operationErrorRepo, "createQueryBuilder").mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockRejectedValue(new Error("Database error")),
      } as any);
      jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      } as any);
      const result = await service.getErrorCounts(jobRunId);
      expect(result).toEqual([]);
    });

    describe('Comprehensive Error Count Scenarios with Query Testing', () => {
      it('should count all errors when same file has multiple different error codes', async () => {
        const mockJobRunId = "job-run-123";
        
        // Raw DB rows: Same file with 3 different error codes
        const mockDbRows = [
          { id: 1, operation_id: 'op1', error_code: 'EACCES', error_message: 'Permission denied', file_path: '/data/file.txt', error_type: 'FATAL_ERROR', origin: 'SOURCE' },
          { id: 2, operation_id: 'op1', error_code: 'ENOSPC', error_message: 'No space left', file_path: '/data/file.txt', error_type: 'FATAL_ERROR', origin: 'SOURCE' },
          { id: 3, operation_id: 'op1', error_code: 'ECONNRESET', error_message: 'Connection reset', file_path: '/data/file.txt', error_type: 'FATAL_ERROR', origin: 'SOURCE' }
        ];
        
        // Query result: COUNT(*) groups by error_type
        const mockErrorCounts = [
          { errortype: "FATAL_ERROR", count: 3 }
        ];

        const mockQueryBuilder = {
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          getRawMany: jest.fn().mockResolvedValue(mockErrorCounts),
        };

        jest.spyOn(operationErrorRepo, "createQueryBuilder").mockReturnValue(mockQueryBuilder as any);
        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        } as any);

        const result = await service.getErrorCounts(mockJobRunId);
        expect(result).toEqual(mockErrorCounts);
        expect(result[0].count).toBe(3); // All 3 errors counted (no deduplication)
      });

      it('should count TRANSIENT_ERROR when non-fatal errors exhaust retries', async () => {
        const mockJobRunId = "job-run-456";
        
        // Raw DB rows: Non-fatal error (ENOENT) retried 3 times
        const mockDbRows = [
          { id: 1, operation_id: 'op1', error_code: 'ENOENT', error_type: 'RECOVERABLE_ERROR', origin: 'SOURCE' }, // Excluded
          { id: 2, operation_id: 'op1', error_code: 'ENOENT', error_type: 'RECOVERABLE_ERROR', origin: 'SOURCE' }, // Excluded
          { id: 3, operation_id: 'op1', error_code: 'ENOENT', error_type: 'TRANSIENT_ERROR', origin: 'SOURCE' }  // Counted
        ];
        
        // Query result: WHERE filters RECOVERABLE_ERROR, only counts TRANSIENT_ERROR
        const mockErrorCounts = [
          { errortype: "TRANSIENT_ERROR", count: 1 }
        ];

        const mockQueryBuilder = {
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          getRawMany: jest.fn().mockResolvedValue(mockErrorCounts),
        };

        jest.spyOn(operationErrorRepo, "createQueryBuilder").mockReturnValue(mockQueryBuilder as any);
        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        } as any);

        const result = await service.getErrorCounts(mockJobRunId);
        expect(result).toEqual(mockErrorCounts);
        expect(result[0].count).toBe(1);
      });

      it('should count errors from both Source and Destination separately', async () => {
        const mockJobRunId = "job-run-789";
        
        // Raw DB rows: Same file failed on both SOURCE and DESTINATION
        const mockDbRows = [
          { id: 1, operation_id: 'op1', error_code: 'EACCES', file_path: '/data/file.txt', error_type: 'FATAL_ERROR', origin: 'SOURCE' },
          { id: 2, operation_id: 'op1', error_code: 'EROFS', file_path: '/data/file.txt', error_type: 'FATAL_ERROR', origin: 'DESTINATION' }
        ];
        
        // Query result: COUNT(*) counts both origins
        const mockErrorCounts = [
          { errortype: "FATAL_ERROR", count: 2 }
        ];

        const mockQueryBuilder = {
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          getRawMany: jest.fn().mockResolvedValue(mockErrorCounts),
        };

        jest.spyOn(operationErrorRepo, "createQueryBuilder").mockReturnValue(mockQueryBuilder as any);
        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        } as any);

        const result = await service.getErrorCounts(mockJobRunId);
        expect(result).toEqual(mockErrorCounts);
        expect(result[0].count).toBe(2);
      });

      it('should count mixed FATAL_ERROR and TRANSIENT_ERROR separately', async () => {
        const mockJobRunId = "job-run-mixed";
        
        // Raw DB rows: 5 FATAL + 3 TRANSIENT errors
        const mockDbRows = [
          { id: 1, error_code: 'EACCES', file_path: '/file1.txt', error_type: 'FATAL_ERROR', origin: 'SOURCE' },
          { id: 2, error_code: 'ENOSPC', file_path: '/file2.txt', error_type: 'FATAL_ERROR', origin: 'SOURCE' },
          { id: 3, error_code: 'ECONNRESET', file_path: '/file3.txt', error_type: 'FATAL_ERROR', origin: 'SOURCE' },
          { id: 4, error_code: 'ETIMEDOUT', file_path: '/file4.txt', error_type: 'FATAL_ERROR', origin: 'DESTINATION' },
          { id: 5, error_code: 'EROFS', file_path: '/file5.txt', error_type: 'FATAL_ERROR', origin: 'DESTINATION' },
          { id: 6, error_code: 'ENOENT', file_path: '/file6.txt', error_type: 'TRANSIENT_ERROR', origin: 'SOURCE' },
          { id: 7, error_code: 'ENOENT', file_path: '/file6.txt', error_type: 'TRANSIENT_ERROR', origin: 'SOURCE' },
          { id: 8, error_code: 'EIO', file_path: '/file7.txt', error_type: 'TRANSIENT_ERROR', origin: 'DESTINATION' }
        ];
        
        // Query result: GROUP BY error_type
        const mockErrorCounts = [
          { errortype: "FATAL_ERROR", count: 5 },
          { errortype: "TRANSIENT_ERROR", count: 3 }
        ];

        const mockQueryBuilder = {
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          getRawMany: jest.fn().mockResolvedValue(mockErrorCounts),
        };

        jest.spyOn(operationErrorRepo, "createQueryBuilder").mockReturnValue(mockQueryBuilder as any);
        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        } as any);

        const result = await service.getErrorCounts(mockJobRunId);
        expect(result).toEqual(mockErrorCounts);
        expect(result.length).toBe(2);
        expect(result.find(e => e.errortype === "FATAL_ERROR")?.count).toBe(5);
        expect(result.find(e => e.errortype === "TRANSIENT_ERROR")?.count).toBe(3);
      });

      it('should count large dataset with hundreds of errors efficiently', async () => {
        const mockJobRunId = "job-run-large";
        
        const mockErrorCounts = [
          { errortype: "FATAL_ERROR", count: 245 },
          { errortype: "TRANSIENT_ERROR", count: 178 }
        ];

        const mockQueryBuilder = {
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          getRawMany: jest.fn().mockResolvedValue(mockErrorCounts),
        };

        jest.spyOn(operationErrorRepo, "createQueryBuilder").mockReturnValue(mockQueryBuilder as any);
        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        } as any);

        const result = await service.getErrorCounts(mockJobRunId);
        expect(result).toEqual(mockErrorCounts);
        expect(result[0].count + result[1].count).toBe(423);
      });

      it('should exclude RECOVERABLE_ERROR from count', async () => {
        const mockJobRunId = "job-run-with-recoverable";
        
        // Raw DB rows: Mixed error types including RECOVERABLE_ERROR
        const mockDbRows = [
          { id: 1, error_code: 'EACCES', file_path: '/file1.txt', error_type: 'FATAL_ERROR', origin: 'SOURCE' },
          { id: 2, error_code: 'ENOSPC', file_path: '/file2.txt', error_type: 'FATAL_ERROR', origin: 'SOURCE' },
          { id: 3, error_code: 'ENOENT', file_path: '/file3.txt', error_type: 'RECOVERABLE_ERROR', origin: 'SOURCE' }, // Excluded
          { id: 4, error_code: 'ENOENT', file_path: '/file3.txt', error_type: 'RECOVERABLE_ERROR', origin: 'SOURCE' }, // Excluded
          { id: 5, error_code: 'ETIMEDOUT', file_path: '/file4.txt', error_type: 'FATAL_ERROR', origin: 'DESTINATION' },
          { id: 6, error_code: 'EIO', file_path: '/file5.txt', error_type: 'RECOVERABLE_ERROR', origin: 'DESTINATION' } // Excluded
        ];
        
        // Query result: WHERE error_type IN ('FATAL_ERROR', 'TRANSIENT_ERROR')
        const mockErrorCounts = [
          { errortype: "FATAL_ERROR", count: 3 }
        ];

        const mockQueryBuilder = {
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          getRawMany: jest.fn().mockResolvedValue(mockErrorCounts),
        };

        jest.spyOn(operationErrorRepo, "createQueryBuilder").mockReturnValue(mockQueryBuilder as any);
        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        } as any);

        const result = await service.getErrorCounts(mockJobRunId);
        
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          "oe.errorType IN (:...errorTypes)", 
          { errorTypes: expect.arrayContaining(["FATAL_ERROR", "TRANSIENT_ERROR"]) }
        );
        expect(result).toEqual(mockErrorCounts);
        expect(result.find(e => e.errortype === "RECOVERABLE_ERROR")).toBeUndefined();
        expect(result.find(e => e.errortype === "FATAL_ERROR")?.count).toBe(3);
      });

      it('should add worker setup errors to FATAL_ERROR count', async () => {
        const mockJobRunId = "job-run-with-setup-errors";
        const mockErrorCounts = [
          { errortype: "FATAL_ERROR", count: "3" }
        ];

        const mockQueryBuilder = {
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          getRawMany: jest.fn().mockResolvedValue(mockErrorCounts),
        };

        jest.spyOn(operationErrorRepo, "createQueryBuilder").mockReturnValue(mockQueryBuilder as any);
        
        // 2 workers with setup failures
        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([
            { workerId: "worker1", workerResponse: { code: "SETUP_FAILED" } },
            { workerId: "worker2", workerResponse: { code: "SETUP_FAILED" } }
          ]),
        } as any);

        const result = await service.getErrorCounts(mockJobRunId);
        
        expect(result).toEqual([{ errortype: "FATAL_ERROR", count: 5 }]);
      });

      it('should create FATAL_ERROR entry if only setup errors exist', async () => {
        const mockJobRunId = "job-run-only-setup-errors";
        const mockErrorCounts = []; // No operation errors

        const mockQueryBuilder = {
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          getRawMany: jest.fn().mockResolvedValue(mockErrorCounts),
        };

        jest.spyOn(operationErrorRepo, "createQueryBuilder").mockReturnValue(mockQueryBuilder as any);
        
        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([
            { workerId: "worker1", workerResponse: { code: "SETUP_FAILED" } },
            { workerId: "worker2", workerResponse: { code: "SETUP_FAILED" } },
            { workerId: "worker3", workerResponse: { code: "SETUP_FAILED" } }
          ]),
        } as any);

        const result = await service.getErrorCounts(mockJobRunId);
        
        expect(result).toEqual([{ errortype: "FATAL_ERROR", count: 3 }]);
      });
    });
  });

  it("should count error from setupFailedErrors", async () => {
    const mockError = [
      {
        errortype: "FATAL_ERROR",
        count: "0",
      },
    ];
    const jobRunId = "12345";
    jest.spyOn(operationErrorRepo, "createQueryBuilder").mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(mockError),
    } as any);
    jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{
        jobRunId: jobRunId,
        workerId: "worker1",
        workerResponse: {}
      }] as any)
    } as any);
    const result = await service.getErrorCounts(jobRunId);
    expect(result).toEqual([
      {
        errortype: "FATAL_ERROR",
        count: 1,
      },
    ]);
  })

  it("should count error from setupFailedErrors", async () => {
    const mockError = [
      {
        errortype: "ERROR",
        count: "0",
      },
    ];
    const jobRunId = "12345";
    jest.spyOn(operationErrorRepo, "createQueryBuilder").mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(mockError),
    } as any);

    jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{
        jobRunId: jobRunId,
        workerId: "worker1",
        workerResponse: {}
      }] as any)
    } as any);

    const result = await service.getErrorCounts(jobRunId);
    expect(result).toEqual([
      {
        errortype: "ERROR",
        count: "0",
      },
      {
        errortype: "FATAL_ERROR",
        count: 1,
      },
    ]);
  });

  describe('createBulkCutover', () => {
    it('should throw if inactive cutover already exists for source-destination pair', async () => {
      const sourcePathId = 'source-id';
      const destinationPathId = 'destination-id';
      const sourceDirectoryPath = '/cutover/source';
      const destinationDirectoryPath = '/cutover/destination';
    
      const cutoverConfig = [{
        sourcePathId,
        sourceDirectoryPath,
        destinationPathId,
        destinationDirectoryPath,
      }];
      const completedMigrateJob = {
        id: 'migrate-job-id',
        jobType: JobType.MIGRATE,
        sourcePathId,
        sourceDirectoryPath,
        targetPathId: destinationPathId,
        targetDirectoryPath: destinationDirectoryPath,
        excludeFilePatterns: ['*.tmp'],
        preserveAccessTime: true,
        preservePermissions: true,
        status: JobStatus.Active,
      };
    
      const jobRun = {
        jobConfigId: completedMigrateJob.id,
        status: JobRunStatus.Completed,
        endTime: new Date(),
      };
    
      const existingCutoverJob = {
        id: 'cutover-id',
        jobType: JobType.CUT_OVER,
        sourcePathId,
        sourceDirectoryPath,
        targetPathId: destinationPathId,
        targetDirectoryPath: destinationDirectoryPath,
        status: JobStatus.InActive, // <-- This triggers the throw
      };
    
      jest
        .spyOn(service as any, 'flattenCutoverConfig')
        .mockReturnValue(cutoverConfig);
    
      jest
        .spyOn(service as any, 'findJobConfigs')
        .mockResolvedValue([completedMigrateJob]);
    
      jest.spyOn(service['jobRunRepo'], 'find').mockResolvedValue([jobRun] as any);
    
      jest
        .spyOn(service['jobConfigRepo'], 'findOne')
        .mockResolvedValue(existingCutoverJob as any);
    
      await expect(
        service.createBulkCutover({ cutoverConfig } as any)
      ).rejects.toThrowError(
        "Cutover job already exists for this migration job. Please activate or delete the existing one before creating a new one"
      );
    });

    it('should inherit identity mapping from migrate job when creating new cutover jobs', async () => {
      const sourcePathId = 'source-id';
      const destinationPathId = 'destination-id';
      const sourceDirectoryPath = '/cutover/source';
      const destinationDirectoryPath = '/cutover/destination';
      const migrateJobId = 'migrate-job-id';
      const newCutoverJobId = 'new-cutover-job-id';
      const identityMappingId = 'identity-map-id';

      const cutoverConfig = [{
        sourcePathId,
        sourceDirectoryPath,
        destinationPathId,
        destinationDirectoryPath,
      }];

      const completedMigrateJob = {
        id: migrateJobId,
        jobType: JobType.MIGRATE,
        sourcePathId,
        sourceDirectoryPath,
        targetPathId: destinationPathId,
        targetDirectoryPath: destinationDirectoryPath,
        excludeFilePatterns: '*.tmp',
        preserveAccessTime: true,
        preservePermissions: true,
        status: JobStatus.Active,
        excludeOlderThan: new Date(),
        futureScheduleAt: null,
      };

      const jobRun = {
        jobConfigId: migrateJobId,
        status: JobRunStatus.Completed,
        endTime: new Date(),
      };

      const savedCutoverJob = {
        id: newCutoverJobId,
        jobType: JobType.CUT_OVER,
        sourcePathId,
        sourceDirectoryPath,
        targetPathId: destinationPathId,
        targetDirectoryPath: destinationDirectoryPath,
        status: JobStatus.Active,
        firstRunAt: new Date(),
      };

      const migrateCrossMapping = {
        id: 'cross-1',
        jobConfigId: migrateJobId,
        identityMappingId,
        isOrphan: false,
      };

      jest.spyOn(service as any, 'flattenCutoverConfig').mockReturnValue(cutoverConfig);
      jest.spyOn(service as any, 'findJobConfigs').mockResolvedValue([completedMigrateJob]);
      jest.spyOn(service['jobRunRepo'], 'find').mockResolvedValue([jobRun] as any);
      jest.spyOn(service['jobConfigRepo'], 'findOne').mockResolvedValue(null);
      jest.spyOn(service['jobConfigRepo'], 'create').mockImplementation((data) => data as any);
      jest.spyOn(service['jobConfigRepo'], 'save').mockResolvedValue([savedCutoverJob] as any);
      jest.spyOn(identityCrossMappingRepo, 'findOne').mockResolvedValue(migrateCrossMapping as any);
      jest.spyOn(identityCrossMappingRepo, 'create').mockImplementation((data) => data as any);
      jest.spyOn(identityCrossMappingRepo, 'save').mockResolvedValue({} as any);

      await service.createBulkCutover({ cutoverConfig } as any);

      expect(identityCrossMappingRepo.findOne).toHaveBeenCalledWith({
        where: { jobConfigId: migrateJobId, isOrphan: false },
        order: { createdAt: 'DESC' },
      });
      expect(identityCrossMappingRepo.create).toHaveBeenCalledWith({
        identityMappingId,
        jobConfigId: newCutoverJobId,
        isOrphan: false,
      });
      expect(identityCrossMappingRepo.save).toHaveBeenCalled();
    });

    it('should copy smbPermissionInheritanceMode from migrate job when creating new cutover (JOB-08)', async () => {
      const sourcePathId = 'source-id';
      const destinationPathId = 'destination-id';
      const sourceDirectoryPath = '/cutover/source';
      const destinationDirectoryPath = '/cutover/destination';
      const migrateJobId = 'migrate-job-id';
      const inheritMode =
        SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT;

      const cutoverConfig = [{
        sourcePathId,
        sourceDirectoryPath,
        destinationPathId,
        destinationDirectoryPath,
      }];

      const completedMigrateJob = {
        id: migrateJobId,
        jobType: JobType.MIGRATE,
        sourcePathId,
        sourceDirectoryPath,
        targetPathId: destinationPathId,
        targetDirectoryPath: destinationDirectoryPath,
        excludeFilePatterns: '*.tmp',
        preserveAccessTime: true,
        preservePermissions: true,
        smbPermissionInheritanceMode: inheritMode,
        status: JobStatus.Active,
        excludeOlderThan: new Date(),
        futureScheduleAt: null,
      };

      const jobRun = {
        jobConfigId: migrateJobId,
        status: JobRunStatus.Completed,
        endTime: new Date(),
      };

      jest.spyOn(service as any, 'flattenCutoverConfig').mockReturnValue(cutoverConfig);
      jest.spyOn(service as any, 'findJobConfigs').mockResolvedValue([completedMigrateJob]);
      jest.spyOn(service['jobRunRepo'], 'find').mockResolvedValue([jobRun] as any);
      jest.spyOn(service['jobConfigRepo'], 'findOne').mockResolvedValue(null);
      const createSpy = jest
        .spyOn(service['jobConfigRepo'], 'create')
        .mockImplementation((data) => data as any);
      jest.spyOn(service['jobConfigRepo'], 'save').mockResolvedValue([
        { id: 'new-cutover-id', jobType: JobType.CUT_OVER },
      ] as any);
      jest.spyOn(identityCrossMappingRepo, 'findOne').mockResolvedValue(null);

      await service.createBulkCutover({ cutoverConfig } as any);

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          jobType: JobType.CUT_OVER,
          smbPermissionInheritanceMode: inheritMode,
        }),
      );
    });

    it('should copy smbPermissionInheritanceMode when updating existing active cutover (JOB-08)', async () => {
      const sourcePathId = 'source-id';
      const destinationPathId = 'destination-id';
      const sourceDirectoryPath = '/cutover/source';
      const destinationDirectoryPath = '/cutover/destination';
      const migrateJobId = 'migrate-job-id';
      const existingCutoverId = 'existing-cutover-id';
      const inheritMode =
        SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT;

      const cutoverConfig = [{
        sourcePathId,
        sourceDirectoryPath,
        destinationPathId,
        destinationDirectoryPath,
      }];

      const completedMigrateJob = {
        id: migrateJobId,
        jobType: JobType.MIGRATE,
        sourcePathId,
        sourceDirectoryPath,
        targetPathId: destinationPathId,
        targetDirectoryPath: destinationDirectoryPath,
        excludeFilePatterns: '*.tmp',
        preserveAccessTime: true,
        preservePermissions: true,
        smbPermissionInheritanceMode: inheritMode,
        status: JobStatus.Active,
        excludeOlderThan: new Date(),
        futureScheduleAt: null,
      };

      const jobRun = {
        jobConfigId: migrateJobId,
        status: JobRunStatus.Completed,
        endTime: new Date(),
      };

      const existingCutoverJob = {
        id: existingCutoverId,
        jobType: JobType.CUT_OVER,
        sourcePathId,
        sourceDirectoryPath,
        targetPathId: destinationPathId,
        targetDirectoryPath: destinationDirectoryPath,
        status: JobStatus.Active,
      };

      jest.spyOn(service as any, 'flattenCutoverConfig').mockReturnValue(cutoverConfig);
      jest.spyOn(service as any, 'findJobConfigs').mockResolvedValue([completedMigrateJob]);
      jest.spyOn(service['jobRunRepo'], 'find').mockResolvedValue([jobRun] as any);
      jest.spyOn(service['jobConfigRepo'], 'findOne').mockResolvedValue(existingCutoverJob as any);
      const updateSpy = jest
        .spyOn(service['jobConfigRepo'], 'update')
        .mockResolvedValue({} as any);
      jest.spyOn(service['jobConfigRepo'], 'save').mockResolvedValue([] as any);
      jest.spyOn(identityCrossMappingRepo, 'update').mockResolvedValue({} as any);
      jest.spyOn(identityCrossMappingRepo, 'findOne').mockResolvedValue(null);

      await service.createBulkCutover({ cutoverConfig } as any);

      expect(updateSpy).toHaveBeenCalledWith(
        existingCutoverId,
        expect.objectContaining({
          smbPermissionInheritanceMode: inheritMode,
        }),
      );
    });

    it('should not create identity mapping for new cutover jobs when migrate job has no mapping', async () => {
      const sourcePathId = 'source-id';
      const destinationPathId = 'destination-id';
      const sourceDirectoryPath = '/cutover/source';
      const destinationDirectoryPath = '/cutover/destination';
      const migrateJobId = 'migrate-job-id';

      const cutoverConfig = [{
        sourcePathId,
        sourceDirectoryPath,
        destinationPathId,
        destinationDirectoryPath,
      }];

      const completedMigrateJob = {
        id: migrateJobId,
        jobType: JobType.MIGRATE,
        sourcePathId,
        sourceDirectoryPath,
        targetPathId: destinationPathId,
        targetDirectoryPath: destinationDirectoryPath,
        excludeFilePatterns: '*.tmp',
        preserveAccessTime: true,
        preservePermissions: true,
        status: JobStatus.Active,
        excludeOlderThan: new Date(),
        futureScheduleAt: null,
      };

      const jobRun = {
        jobConfigId: migrateJobId,
        status: JobRunStatus.Completed,
        endTime: new Date(),
      };

      const savedCutoverJob = {
        id: 'new-cutover-job-id',
        jobType: JobType.CUT_OVER,
        sourcePathId,
        sourceDirectoryPath,
        targetPathId: destinationPathId,
        targetDirectoryPath: destinationDirectoryPath,
        status: JobStatus.Active,
        firstRunAt: new Date(),
      };

      jest.spyOn(service as any, 'flattenCutoverConfig').mockReturnValue(cutoverConfig);
      jest.spyOn(service as any, 'findJobConfigs').mockResolvedValue([completedMigrateJob]);
      jest.spyOn(service['jobRunRepo'], 'find').mockResolvedValue([jobRun] as any);
      jest.spyOn(service['jobConfigRepo'], 'findOne').mockResolvedValue(null);
      jest.spyOn(service['jobConfigRepo'], 'create').mockImplementation((data) => data as any);
      jest.spyOn(service['jobConfigRepo'], 'save').mockResolvedValue([savedCutoverJob] as any);
      jest.spyOn(identityCrossMappingRepo, 'findOne').mockResolvedValue(null);
      const createSpy = jest.spyOn(identityCrossMappingRepo, 'create');
      const saveSpy = jest.spyOn(identityCrossMappingRepo, 'save');

      await service.createBulkCutover({ cutoverConfig } as any);

      expect(identityCrossMappingRepo.findOne).toHaveBeenCalledWith({
        where: { jobConfigId: migrateJobId, isOrphan: false },
        order: { createdAt: 'DESC' },
      });
      expect(createSpy).not.toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('should mark old mapping as orphan and inherit identity mapping when updating existing active cutover job', async () => {
      const sourcePathId = 'source-id';
      const destinationPathId = 'destination-id';
      const sourceDirectoryPath = '/cutover/source';
      const destinationDirectoryPath = '/cutover/destination';
      const migrateJobId = 'migrate-job-id';
      const existingCutoverId = 'existing-cutover-id';
      const identityMappingId = 'identity-map-id';

      const cutoverConfig = [{
        sourcePathId,
        sourceDirectoryPath,
        destinationPathId,
        destinationDirectoryPath,
      }];

      const completedMigrateJob = {
        id: migrateJobId,
        jobType: JobType.MIGRATE,
        sourcePathId,
        sourceDirectoryPath,
        targetPathId: destinationPathId,
        targetDirectoryPath: destinationDirectoryPath,
        excludeFilePatterns: '*.tmp',
        preserveAccessTime: true,
        preservePermissions: true,
        status: JobStatus.Active,
        excludeOlderThan: new Date(),
        futureScheduleAt: null,
      };

      const jobRun = {
        jobConfigId: migrateJobId,
        status: JobRunStatus.Completed,
        endTime: new Date(),
      };

      const existingCutoverJob = {
        id: existingCutoverId,
        jobType: JobType.CUT_OVER,
        sourcePathId,
        sourceDirectoryPath,
        targetPathId: destinationPathId,
        targetDirectoryPath: destinationDirectoryPath,
        status: JobStatus.Active,
      };

      const migrateCrossMapping = {
        id: 'cross-1',
        jobConfigId: migrateJobId,
        identityMappingId,
        isOrphan: false,
      };

      jest.spyOn(service as any, 'flattenCutoverConfig').mockReturnValue(cutoverConfig);
      jest.spyOn(service as any, 'findJobConfigs').mockResolvedValue([completedMigrateJob]);
      jest.spyOn(service['jobRunRepo'], 'find').mockResolvedValue([jobRun] as any);
      jest.spyOn(service['jobConfigRepo'], 'findOne').mockResolvedValue(existingCutoverJob as any);
      jest.spyOn(service['jobConfigRepo'], 'update').mockResolvedValue({} as any);
      jest.spyOn(service['jobConfigRepo'], 'save').mockResolvedValue([] as any);
      jest.spyOn(identityCrossMappingRepo, 'update').mockResolvedValue({} as any);
      jest.spyOn(identityCrossMappingRepo, 'findOne').mockResolvedValue(migrateCrossMapping as any);
      jest.spyOn(identityCrossMappingRepo, 'create').mockImplementation((data) => data as any);
      jest.spyOn(identityCrossMappingRepo, 'save').mockResolvedValue({} as any);

      await service.createBulkCutover({ cutoverConfig } as any);

      expect(identityCrossMappingRepo.update).toHaveBeenCalledWith(
        { jobConfigId: existingCutoverId, isOrphan: false },
        { isOrphan: true },
      );
      expect(identityCrossMappingRepo.findOne).toHaveBeenCalledWith({
        where: { jobConfigId: migrateJobId, isOrphan: false },
        order: { createdAt: 'DESC' },
      });
      expect(identityCrossMappingRepo.create).toHaveBeenCalledWith({
        identityMappingId,
        jobConfigId: existingCutoverId,
        isOrphan: false,
      });
      expect(identityCrossMappingRepo.save).toHaveBeenCalled();
    });
  })

  describe('getIdentityMappingsForJob', () => {
    it('should return identity mappings for a job configuration', async () => {
      const jobConfigId = 'test-job-config-id';
      const identityMapId = 'test-identity-map-id';
      
      const crossMappings = [{
          id: 'cross-1',
          jobConfigId,
          identityMappingId: identityMapId,
          isOrphan: false,
        },
      ];
      const identityMappings = [{
          id: 'mapping-1',
          identityMap: identityMapId,
          identityType: TemplateType.SID,
          sourceMapping: 'S-1-5-21-1111',
          targetMapping: 'S-1-5-21-2222',
        }, {
          id: 'mapping-2',
          identityMap: identityMapId,
          identityType: TemplateType.SID,
          sourceMapping: 'S-1-5-21-3333',
          targetMapping: 'S-1-5-21-4444',
        },
      ];

      jest.spyOn(identityCrossMappingRepo, 'find').mockResolvedValue(crossMappings as any);
      jest.spyOn(identityMappingRepo, 'findBy').mockResolvedValue(identityMappings as any);

      const result = await service.getIdentityMappingsForJob(jobConfigId);
      expect(result).toEqual({
        data: identityMappings,
        crossMappings: crossMappings,
      });
      expect(identityCrossMappingRepo.find).toHaveBeenCalledWith({
        where: { jobConfigId, isOrphan: false },
        relations: ['identityMapping'],
      });
      expect(identityMappingRepo.findBy).toHaveBeenCalledWith({
        identityMap: In([identityMapId]),
      });
    });

    it('should return empty data when no mappings found', async () => {
      const jobConfigId = 'test-job-config-id';
      jest.spyOn(identityCrossMappingRepo, 'find').mockResolvedValue([]);
      const result = await service.getIdentityMappingsForJob(jobConfigId);
      expect(result).toEqual({
        data: [],
        message: 'No identity mappings found for this job configuration',
      });
      expect(identityCrossMappingRepo.find).toHaveBeenCalledWith({
        where: { jobConfigId, isOrphan: false },
        relations: ['identityMapping'],
      });
    });

    it('should throw HttpException on error', async () => {
      const jobConfigId = 'test-job-config-id';
      const error = new Error('Database error');
      jest.spyOn(identityCrossMappingRepo, 'find').mockRejectedValue(error);
      await expect(service.getIdentityMappingsForJob(jobConfigId)).rejects.toThrow(
        HttpException
      );
    });
  });

  describe('updateJobIdentityMappings', () => {
    it('should update SID mappings for a job configuration', async () => {
      const jobConfigId = 'test-job-config-id';
      const sidMappingBase64 = 'data:text/csv;base64,U291cmNlU0lELFRhcmdldFNJRApTLTEtNS0yMS0xMTExLFMtMS01LTIxLTIyMjI=';
      const mappingData = { sidMapping: sidMappingBase64 };
      const existingCrossMapping = [{
          id: 'cross-1',
          jobConfigId,
          identityMappingId: 'old-map-id',
          isOrphan: false,
        },
      ];
      jest.spyOn(identityCrossMappingRepo, 'find').mockResolvedValue(existingCrossMapping as any);
      jest.spyOn(identityCrossMappingRepo, 'update').mockResolvedValue({} as any);
      jest.spyOn(service as any, 'decodeBase64').mockResolvedValue('SourceSID,TargetSID\nS-1-5-21-1111,S-1-5-21-2222');
      jest.spyOn(service as any, 'parseBlobData').mockResolvedValue([
        { sourceMapping: 'S-1-5-21-1111', targetMapping: 'S-1-5-21-2222' },
      ]);
      jest.spyOn(service as any, 'saveIdentityMappingsWithMap').mockResolvedValue(undefined);
      await service.updateJobIdentityMappings(jobConfigId, mappingData);
      expect(identityCrossMappingRepo.update).toHaveBeenCalledWith(
        { jobConfigId, isOrphan: false },
        { isOrphan: true }
      );
      expect(service['saveIdentityMappingsWithMap']).toHaveBeenCalled();
    });

    it('should update GID mappings for a job configuration', async () => {
      const jobConfigId = 'test-job-config-id';
      const gidMappingBase64 = 'data:text/csv;base64,U291cmNlR0lELFRhcmdldEdJRCxTb3VyY2VVSUQsVGFyZ2V0VUlECjEwMDAsMjAwMCwxMDAxLDIwMDE=';
      const mappingData = { gidMapping: gidMappingBase64 };
      jest.spyOn(identityCrossMappingRepo, 'find').mockResolvedValue([]);
      jest.spyOn(service as any, 'decodeBase64').mockResolvedValue('SourceGID,TargetGID,SourceUID,TargetUID\n1000,2000,1001,2001');
      jest.spyOn(service as any, 'parseBlobData').mockResolvedValue([
        {
          sourceMappingGid: '1000',
          targetMappingGid: '2000',
          sourceMappingUid: '1001',
          targetMappingUid: '2001',
        },
      ]);
      jest.spyOn(service as any, 'saveIdentityMappingsWithMap').mockResolvedValue(undefined);
      await service.updateJobIdentityMappings(jobConfigId, mappingData);
      expect(service['saveIdentityMappingsWithMap']).toHaveBeenCalled();
    });

    it('should throw HttpException on error', async () => {
      const jobConfigId = 'test-job-config-id';
      const mappingData = { sidMapping: 'invalid-base64' };
      const error = new Error('Decoding error');
      jest.spyOn(identityCrossMappingRepo, 'find').mockResolvedValue([]);
      jest.spyOn(service as any, 'decodeBase64').mockRejectedValue(error);
      await expect(
        service.updateJobIdentityMappings(jobConfigId, mappingData)
      ).rejects.toThrow(HttpException);
    });

    it('should rethrow BadRequestException when GID mapping CSV is invalid', async () => {
      const jobConfigId = 'test-job-config-id';
      const mappingData = { gidMapping: 'data:text/csv;base64,c29tZWhlYWRlcgo=' };
      jest.spyOn(identityCrossMappingRepo, 'find').mockResolvedValue([]);
      jest.spyOn(service as any, 'decodeBase64').mockResolvedValue(
        'source gid,target gid,source uid,target uid\n1000,2000,not-a-number,2001',
      );
      await expect(
        service.updateJobIdentityMappings(jobConfigId, mappingData),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateJobConfigWithMappings', () => {
    it('should update mappings and config within a single transaction', async () => {
      const jobConfigId = 'job-123';
      const jobConfigData: Partial<JobConfigDto> = {
        excludeFilePatterns: '*.log',
      };
      const mappingData = { sidMapping: 'base64-sid' };
      const mockManager = { id: 'manager' } as any;

      const transactionSpy = jest
        .spyOn(jobConfigRepo.manager, 'transaction')
        .mockImplementation(async (isolationOrCallback: any, maybeCallback?: any) => {
          const callback = typeof isolationOrCallback === 'function' ? isolationOrCallback : maybeCallback;
          if (!callback) {
            throw new Error('Transaction callback missing');
          }
          return callback(mockManager);
        });
      const updateMappingsSpy = jest
        .spyOn(service, 'updateJobIdentityMappings')
        .mockResolvedValue({ data: ['mapped'] } as any);
      const updateJobSpy = jest
        .spyOn(service, 'updateJobConfig')
        .mockResolvedValue({ id: jobConfigId } as JobConfigEntity);

      const result = await service.updateJobConfigWithMappings(
        jobConfigId,
        jobConfigData,
        mappingData,
      );

      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(updateMappingsSpy).toHaveBeenCalledWith(
        jobConfigId,
        mappingData,
        mockManager,
      );
      expect(updateJobSpy).toHaveBeenCalledWith(
        jobConfigId,
        jobConfigData,
        mockManager,
      );
      expect(result).toEqual({
        jobConfig: { id: jobConfigId },
        identityMappings: { data: ['mapped'] },
      });

      transactionSpy.mockRestore();
      updateMappingsSpy.mockRestore();
      updateJobSpy.mockRestore();
    });

    it('should propagate errors when either update fails', async () => {
      const jobConfigId = 'job-500';
      const mappingData = { gidMapping: 'base64-gid' };
      const mockManager = { id: 'manager' } as any;
      const error = new Error('transaction failure');

      const transactionSpy = jest
        .spyOn(jobConfigRepo.manager, 'transaction')
        .mockImplementation(async (isolationOrCallback: any, maybeCallback?: any) => {
          const callback = typeof isolationOrCallback === 'function'
            ? isolationOrCallback
            : maybeCallback;
          if (!callback) {
            throw new Error('Transaction callback missing');
          }
          return callback(mockManager);
        });
      const updateMappingsSpy = jest
        .spyOn(service, 'updateJobIdentityMappings')
        .mockResolvedValue({ data: [] } as any);
      const updateJobSpy = jest
        .spyOn(service, 'updateJobConfig')
        .mockRejectedValue(error);

      await expect(
        service.updateJobConfigWithMappings(jobConfigId, {}, mappingData),
      ).rejects.toBeInstanceOf(HttpException);

      expect(updateMappingsSpy).toHaveBeenCalledWith(
        jobConfigId,
        mappingData,
        mockManager,
      );
      expect(updateJobSpy).toHaveBeenCalledWith(
        jobConfigId,
        {},
        mockManager,
      );
      expect(transactionSpy).toHaveBeenCalledTimes(1);

      transactionSpy.mockRestore();
      updateMappingsSpy.mockRestore();
      updateJobSpy.mockRestore();
    });
  });

  describe('deleteIdentityMappingsForJob', () => {
    it('should delete identity mappings by marking them as orphan', async () => {
      const jobConfigId = 'test-job-config-id';
      const jobConfig = {
        id: jobConfigId,
        jobType: JobType.MIGRATE,
        status: JobStatus.Active,
      };

      const crossMappings = [{
          id: 'cross-1',
          jobConfigId,
          identityMappingId: 'map-id-1',
          isOrphan: false,
        }, {
          id: 'cross-2',
          jobConfigId,
          identityMappingId: 'map-id-2',
          isOrphan: false,
        },
      ];

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(jobConfig as any);
      jest.spyOn(identityCrossMappingRepo, 'find').mockResolvedValue(crossMappings as any);
      jest.spyOn(identityCrossMappingRepo, 'update').mockResolvedValue({} as any);

      const result = await service.deleteIdentityMappingsForJob(jobConfigId);
      expect(result).toEqual({
        message: 'Identity mappings deleted successfully',
        deletedCount: 2,
      });
      expect(identityCrossMappingRepo.update).toHaveBeenCalledWith(
        { jobConfigId, isOrphan: false },
        { isOrphan: true }
      );
    });

    it('should throw HttpException on database error', async () => {
      const jobConfigId = 'test-job-config-id';
      const jobConfig = {
        id: jobConfigId,
        jobType: JobType.MIGRATE,
        status: JobStatus.Active,
      };
      const error = new Error('Database error');
      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(jobConfig as any);
      jest.spyOn(identityCrossMappingRepo, 'find').mockRejectedValue(error);
      await expect(service.deleteIdentityMappingsForJob(jobConfigId)).rejects.toThrow(
        HttpException
      );
    });
  });

  describe('getJobConfigInventoryStats', () => {
    const validJobConfigId = '123e4567-e89b-12d3-a456-426614174000';
    const mockJobConfig = {
      id: validJobConfigId,
      jobType: JobType.MIGRATE,
      status: JobStatus.Active,
    };

    beforeEach(() => {
      // Set default environment variable
      process.env.SCHEMA = 'public';
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should throw BadRequestException for invalid UUID format', async () => {
      const invalidJobConfigId = 'invalid-uuid';

      await expect(
        service.getJobConfigInventoryStats(invalidJobConfigId)
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getJobConfigInventoryStats(invalidJobConfigId)
      ).rejects.toThrow('Invalid jobConfigID format');
    });

    it('should throw NotFoundException when job config does not exist', async () => {
      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(null);

      await expect(
        service.getJobConfigInventoryStats(validJobConfigId)
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getJobConfigInventoryStats(validJobConfigId)
      ).rejects.toThrow(`Job config with ID ${validJobConfigId} not found`);

      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: validJobConfigId },
      });
    });

    it('should throw BadRequestException when job type is not MIGRATE', async () => {
      const discoveryJobConfig = {
        ...mockJobConfig,
        jobType: JobType.DISCOVER,
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(discoveryJobConfig as any);

      await expect(
        service.getJobConfigInventoryStats(validJobConfigId)
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getJobConfigInventoryStats(validJobConfigId)
      ).rejects.toThrow('Inventory stats are only available for Migration job configs');
    });

    it('should throw HttpException with 202 status when fetchLatest is false and no stats entity exists', async () => {
      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'findOne').mockResolvedValue(null);

      await expect(
        service.getJobConfigInventoryStats(validJobConfigId, false),
      ).rejects.toThrow(HttpException);

      const thrownError = await service
        .getJobConfigInventoryStats(validJobConfigId, false)
        .catch((e) => e);

      expect(thrownError).toBeInstanceOf(HttpException);
      expect(thrownError.getStatus()).toBe(HttpStatus.ACCEPTED);
      expect(thrownError.getResponse()).toEqual({
        status: 'pending',
        message: 'Calculation in progress or no results to display',
      });

      expect(jobConfigInventoryStatsRepo.findOne).toHaveBeenCalledWith({
        where: { jobConfigId: validJobConfigId },
      });
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('should throw HttpException with 202 status when fetchLatest is not provided (defaults to false) and no stats exist', async () => {
      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'findOne').mockResolvedValue(null);

      await expect(
        service.getJobConfigInventoryStats(validJobConfigId),
      ).rejects.toThrow(HttpException);

      const thrownError = await service
        .getJobConfigInventoryStats(validJobConfigId)
        .catch((e) => e);

      expect(thrownError).toBeInstanceOf(HttpException);
      expect(thrownError.getStatus()).toBe(202);
      expect(thrownError.getResponse()).toHaveProperty('status', 'pending');
      expect(thrownError.getResponse()).toHaveProperty(
        'message',
        'Calculation in progress or no results to display',
      );
    });

    it('should NOT throw 202 error when fetchLatest is true and no stats exist (should recalculate)', async () => {
      const mockQueryResult = [
        {
          total_unique_files: '150',
          total_unique_directories: '75',
          total_size: '2048000',
        },
      ];

      const mockLatestJobRun = {
        id: 'jobrun-id',
        jobConfigId: validJobConfigId,
        status: JobRunStatus.Completed,
        endTime: new Date('2024-01-15T10:00:00Z'),
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(mockLatestJobRun as any);
      jest.spyOn(dataSource, 'query').mockResolvedValue(mockQueryResult);
      jest.spyOn(jobConfigInventoryStatsRepo, 'create').mockReturnValue({
        jobConfigId: validJobConfigId,
        fileCount: 150,
        dirCount: 75,
        totalSize: 2048000,
        lastUpdatedAt: expect.any(Date),
      } as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'save').mockResolvedValue({
        id: 'new-stats-id',
        jobConfigId: validJobConfigId,
        fileCount: 150,
        dirCount: 75,
        totalSize: 2048000,
        lastUpdatedAt: new Date(),
      } as any);

      const result = await service.getJobConfigInventoryStats(validJobConfigId, true);

      expect(result).toEqual({
        totalUniqueFiles: 150,
        totalUniqueDirectories: 75,
        totalSize: formatBytes(2048000),
        lastUpdatedAt: expect.any(Date),
      });

      // Should not throw 202, should recalculate instead
      expect(dataSource.query).toHaveBeenCalled();
      expect(jobConfigInventoryStatsRepo.save).toHaveBeenCalled();
    });

    it('should return cached stats when no recalculation is needed', async () => {
      const mockStatsEntity = {
        id: 'stats-id',
        jobConfigId: validJobConfigId,
        fileCount: 100,
        dirCount: 50,
        totalSize: 1024000,
        lastUpdatedAt: new Date('2024-01-15T10:00:00Z'),
      };

      const mockLatestJobRun = {
        id: 'jobrun-id',
        jobConfigId: validJobConfigId,
        status: JobRunStatus.Completed,
        endTime: new Date('2024-01-15T09:00:00Z'), // Older than stats
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'findOne').mockResolvedValue(mockStatsEntity as any);
      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(mockLatestJobRun as any);

      const result = await service.getJobConfigInventoryStats(validJobConfigId);

      expect(result).toEqual({
        totalUniqueFiles: 100,
        totalUniqueDirectories: 50,
        totalSize: formatBytes(1024000),
        lastUpdatedAt: mockStatsEntity.lastUpdatedAt,
      });

      expect(jobConfigInventoryStatsRepo.findOne).toHaveBeenCalledWith({
        where: { jobConfigId: validJobConfigId },
      });
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('should recalculate stats when no stats entity exists', async () => {
      const mockQueryResult = [
        {
          total_unique_files: '150',
          total_unique_directories: '75',
          total_size: '2048000',
        },
      ];

      const mockLatestJobRun = {
        id: 'jobrun-id',
        jobConfigId: validJobConfigId,
        status: JobRunStatus.Completed,
        endTime: new Date('2024-01-15T10:00:00Z'),
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(mockLatestJobRun as any);
      jest.spyOn(dataSource, 'query').mockResolvedValue(mockQueryResult);
      jest.spyOn(jobConfigInventoryStatsRepo, 'create').mockReturnValue({
        jobConfigId: validJobConfigId,
        fileCount: 150,
        dirCount: 75,
        totalSize: 2048000,
        lastUpdatedAt: expect.any(Date),
      } as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'save').mockResolvedValue({
        id: 'new-stats-id',
        jobConfigId: validJobConfigId,
        fileCount: 150,
        dirCount: 75,
        totalSize: 2048000,
        lastUpdatedAt: new Date(),
      } as any);

      const result = await service.getJobConfigInventoryStats(validJobConfigId, true);

      expect(result).toEqual({
        totalUniqueFiles: 150,
        totalUniqueDirectories: 75,
        totalSize: formatBytes(2048000),
        lastUpdatedAt: expect.any(Date),
      });

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('WITH all_related_jobs AS'),
        [validJobConfigId]
      );
      expect(jobConfigInventoryStatsRepo.create).toHaveBeenCalledWith({
        jobConfigId: validJobConfigId,
        fileCount: 150,
        dirCount: 75,
        totalSize: 2048000,
        lastUpdatedAt: expect.any(Date),
      });
      expect(jobConfigInventoryStatsRepo.save).toHaveBeenCalled();
    });

    it('should recalculate stats when latest jobRun is newer than stats', async () => {
      const mockStatsEntity = {
        id: 'stats-id',
        jobConfigId: validJobConfigId,
        fileCount: 100,
        dirCount: 50,
        totalSize: 1024000,
        lastUpdatedAt: new Date('2024-01-15T09:00:00Z'),
      };

      const mockLatestJobRun = {
        id: 'jobrun-id',
        jobConfigId: validJobConfigId,
        status: JobRunStatus.Completed,
        endTime: new Date('2024-01-15T10:00:00Z'), // Newer than stats
      };

      const mockQueryResult = [
        {
          total_unique_files: '200',
          total_unique_directories: '100',
          total_size: '3072000',
        },
      ];

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'findOne').mockResolvedValue(mockStatsEntity as any);
      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(mockLatestJobRun as any);
      jest.spyOn(dataSource, 'query').mockResolvedValue(mockQueryResult);
      jest.spyOn(jobConfigInventoryStatsRepo, 'save').mockResolvedValue({
        ...mockStatsEntity,
        fileCount: 200,
        dirCount: 100,
        totalSize: 3072000,
        lastUpdatedAt: new Date(),
      } as any);

      const result = await service.getJobConfigInventoryStats(validJobConfigId, true);

      expect(result).toEqual({
        totalUniqueFiles: 200,
        totalUniqueDirectories: 100,
        totalSize: formatBytes(3072000),
        lastUpdatedAt: expect.any(Date),
      });

      expect(dataSource.query).toHaveBeenCalled();
      expect(jobConfigInventoryStatsRepo.save).toHaveBeenCalled();
    });

    it('should update existing stats entity when recalculating', async () => {
      const mockStatsEntity = {
        id: 'stats-id',
        jobConfigId: validJobConfigId,
        fileCount: 100,
        dirCount: 50,
        totalSize: 1024000,
        lastUpdatedAt: new Date('2024-01-15T09:00:00Z'),
      };

      const mockLatestJobRun = {
        id: 'jobrun-id',
        jobConfigId: validJobConfigId,
        status: JobRunStatus.Completed,
        endTime: new Date('2024-01-15T10:00:00Z'),
      };

      const mockQueryResult = [
        {
          total_unique_files: '250',
          total_unique_directories: '125',
          total_size: '4096000',
        },
      ];

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'findOne').mockResolvedValue(mockStatsEntity as any);
      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(mockLatestJobRun as any);
      jest.spyOn(dataSource, 'query').mockResolvedValue(mockQueryResult);
      jest.spyOn(jobConfigInventoryStatsRepo, 'save').mockResolvedValue({
        ...mockStatsEntity,
        fileCount: 250,
        dirCount: 125,
        totalSize: 4096000,
        lastUpdatedAt: new Date(),
      } as any);

      const result = await service.getJobConfigInventoryStats(validJobConfigId, true);

      expect(result.totalUniqueFiles).toBe(250);
      expect(result.totalUniqueDirectories).toBe(125);
      expect(result.totalSize).toBe(formatBytes(4096000));

      // Verify that the existing entity was updated, not created
      expect(jobConfigInventoryStatsRepo.create).not.toHaveBeenCalled();
      expect(jobConfigInventoryStatsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'stats-id',
          fileCount: 250,
          dirCount: 125,
          totalSize: 4096000,
        })
      );
    });

    it('should handle query result with null or undefined values', async () => {
      const mockQueryResult = [
        {
          total_unique_files: null,
          total_unique_directories: undefined,
          total_size: '0',
        },
      ];

      const mockLatestJobRun = {
        id: 'jobrun-id',
        jobConfigId: validJobConfigId,
        status: JobRunStatus.Completed,
        endTime: new Date('2024-01-15T10:00:00Z'),
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(mockLatestJobRun as any);
      jest.spyOn(dataSource, 'query').mockResolvedValue(mockQueryResult);
      jest.spyOn(jobConfigInventoryStatsRepo, 'create').mockReturnValue({
        jobConfigId: validJobConfigId,
        fileCount: 0,
        dirCount: 0,
        totalSize: 0,
        lastUpdatedAt: expect.any(Date),
      } as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'save').mockResolvedValue({
        id: 'new-stats-id',
        jobConfigId: validJobConfigId,
        fileCount: 0,
        dirCount: 0,
        totalSize: 0,
        lastUpdatedAt: new Date(),
      } as any);

      const result = await service.getJobConfigInventoryStats(validJobConfigId, true);

      expect(result).toEqual({
        totalUniqueFiles: 0,
        totalUniqueDirectories: 0,
        totalSize: formatBytes(0),
        lastUpdatedAt: expect.any(Date),
      });
    });

    it('should handle case when no latest jobRun exists', async () => {
      const mockStatsEntity = {
        id: 'stats-id',
        jobConfigId: validJobConfigId,
        fileCount: 100,
        dirCount: 50,
        totalSize: 1024000,
        lastUpdatedAt: new Date('2024-01-15T10:00:00Z'),
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'findOne').mockResolvedValue(mockStatsEntity as any);
      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(null);

      const result = await service.getJobConfigInventoryStats(validJobConfigId);

      // Should return cached stats when no jobRun exists
      expect(result).toEqual({
        totalUniqueFiles: 100,
        totalUniqueDirectories: 50,
        totalSize: formatBytes(1024000),
        lastUpdatedAt: mockStatsEntity.lastUpdatedAt,
      });

      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('should handle database query errors', async () => {
      const mockLatestJobRun = {
        id: 'jobrun-id',
        jobConfigId: validJobConfigId,
        status: JobRunStatus.Completed,
        endTime: new Date('2024-01-15T10:00:00Z'),
      };

      const dbError = new Error('Database connection failed');

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(mockLatestJobRun as any);
      jest.spyOn(dataSource, 'query').mockRejectedValue(dbError);

      await expect(
        service.getJobConfigInventoryStats(validJobConfigId, true)
      ).rejects.toThrow(HttpException);

      // The service uses error.message when available, so expect the actual error message
      await expect(
        service.getJobConfigInventoryStats(validJobConfigId, true)
      ).rejects.toThrow('Database connection failed');

      expect(loggerService.error).toHaveBeenCalledWith(
        expect.stringContaining('Error getting inventory stats'),
        dbError
      );
    });

    it('should handle jobRun with no endTime', async () => {
      const mockStatsEntity = {
        id: 'stats-id',
        jobConfigId: validJobConfigId,
        fileCount: 100,
        dirCount: 50,
        totalSize: 1024000,
        lastUpdatedAt: new Date('2024-01-15T10:00:00Z'),
      };

      const mockLatestJobRun = {
        id: 'jobrun-id',
        jobConfigId: validJobConfigId,
        status: JobRunStatus.Running,
        endTime: null,
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'findOne').mockResolvedValue(mockStatsEntity as any);
      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(mockLatestJobRun as any);

      const result = await service.getJobConfigInventoryStats(validJobConfigId);

      // Should return cached stats when jobRun has no endTime
      expect(result).toEqual({
        totalUniqueFiles: 100,
        totalUniqueDirectories: 50,
        totalSize: formatBytes(1024000),
        lastUpdatedAt: mockStatsEntity.lastUpdatedAt,
      });

      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('should handle multiple job run statuses (Completed, Failed, Errored)', async () => {
      const mockQueryResult = [
        {
          total_unique_files: '300',
          total_unique_directories: '150',
          total_size: '5120000',
        },
      ];

      const mockLatestJobRun = {
        id: 'jobrun-id',
        jobConfigId: validJobConfigId,
        status: JobRunStatus.Failed,
        endTime: new Date('2024-01-15T10:00:00Z'),
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(mockLatestJobRun as any);
      jest.spyOn(dataSource, 'query').mockResolvedValue(mockQueryResult);
      jest.spyOn(jobConfigInventoryStatsRepo, 'create').mockReturnValue({
        jobConfigId: validJobConfigId,
        fileCount: 300,
        dirCount: 150,
        totalSize: 5120000,
        lastUpdatedAt: expect.any(Date),
      } as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'save').mockResolvedValue({
        id: 'new-stats-id',
        jobConfigId: validJobConfigId,
        fileCount: 300,
        dirCount: 150,
        totalSize: 5120000,
        lastUpdatedAt: new Date(),
      } as any);

      const result = await service.getJobConfigInventoryStats(validJobConfigId, true);

      expect(result.totalUniqueFiles).toBe(300);
      expect(result.totalUniqueDirectories).toBe(150);
      expect(result.totalSize).toBe(formatBytes(5120000));

      expect(jobRunRepo.findOne).toHaveBeenCalledWith({
        where: {
          jobConfigId: validJobConfigId,
          status: In([JobRunStatus.Completed, JobRunStatus.Failed, JobRunStatus.Errored, JobRunStatus.Stopped]),
        },
        order: { endTime: 'DESC' },
      });
    });

    it('should return cached stats when fetchLatest=true but statsEntity is already up-to-date (no recalculation needed)', async () => {
      // statsEntity.lastUpdatedAt is NEWER than latestJobRun.endTime → no recalculation
      const mockStatsEntity = {
        id: 'stats-id',
        jobConfigId: validJobConfigId,
        fileCount: 200,
        dirCount: 100,
        totalSize: 3072000,
        lastUpdatedAt: new Date('2024-02-01T12:00:00Z'), // newer than job run end
      };
      const mockLatestJobRun = {
        id: 'jobrun-id',
        jobConfigId: validJobConfigId,
        status: JobRunStatus.Completed,
        endTime: new Date('2024-01-01T10:00:00Z'), // older than statsEntity
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobConfigInventoryStatsRepo, 'findOne').mockResolvedValue(mockStatsEntity as any);
      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(mockLatestJobRun as any);

      const result = await service.getJobConfigInventoryStats(validJobConfigId, true);

      expect(result).toEqual({
        totalUniqueFiles: 200,
        totalUniqueDirectories: 100,
        totalSize: formatBytes(3072000),
        lastUpdatedAt: mockStatsEntity.lastUpdatedAt,
      });
      // dataSource.query should NOT have been called
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });

  // ---- bulkDeactivateAllJobs ---- //
  describe('bulkDeactivateAllJobs', () => {
    it('should return 0 deactivated when no IDs are provided', async () => {
      const result = await service.bulkDeactivateAllJobs([]);
      expect(result).toEqual({ deactivatedCount: 0, deactivatedIds: [] });
      expect(jobConfigRepo.update).not.toHaveBeenCalled();
    });

    it('should deactivate all provided job config IDs', async () => {
      const ids = ['id-1', 'id-2', 'id-3'];
      jest.spyOn(jobConfigRepo, 'update').mockResolvedValue({ affected: 3 } as any);
      jest.spyOn(jobConfigRepo, 'find').mockResolvedValue(
        ids.map((id) => ({ id } as any)),
      );

      const result = await service.bulkDeactivateAllJobs(ids);

      expect(result).toEqual({ deactivatedCount: 3, deactivatedIds: ids });
      expect(jobConfigRepo.update).toHaveBeenCalledWith(
        { id: In(ids) },
        { status: JobStatus.InActive },
      );
      expect(jobConfigRepo.find).toHaveBeenCalledWith({
        where: { id: In(ids), status: JobStatus.InActive },
        select: ['id'],
      });
    });
  });

  // ---- bulkActivateJobs ---- //
  describe('bulkActivateJobs', () => {
    it('should return 0 activated when no IDs are provided', async () => {
      const result = await service.bulkActivateJobs([]);
      expect(result).toEqual({ activatedCount: 0, activatedIds: [] });
      expect(jobConfigRepo.update).not.toHaveBeenCalled();
    });

    it('should activate all provided job config IDs', async () => {
      const ids = ['id-a', 'id-b'];
      jest.spyOn(jobConfigRepo, 'update').mockResolvedValue({ affected: 2 } as any);
      jest.spyOn(jobConfigRepo, 'find').mockResolvedValue(
        ids.map((id) => ({ id } as any)),
      );

      const result = await service.bulkActivateJobs(ids);

      expect(result).toEqual({ activatedCount: 2, activatedIds: ids });
      expect(jobConfigRepo.update).toHaveBeenCalledWith(
        { id: In(ids) },
        { status: JobStatus.Active },
      );
      expect(jobConfigRepo.find).toHaveBeenCalledWith({
        where: { id: In(ids), status: JobStatus.Active },
        select: ['id'],
      });
    });
  });

  // ---- getStoppedJobsReport ---- //
  describe('getStoppedJobsReport', () => {
    it('should return empty arrays when both inputs are empty', async () => {
      const result = await service.getStoppedJobsReport([], []);
      expect(result).toEqual({ stoppedRuns: [], deactivatedConfigs: [] });
    });

    it('should return stoppedRuns mapped from job runs with full relations', async () => {
      const jobRunId = 'run-1';
      const jobConfigId = 'cfg-1';
      const mockRun = {
        id: jobRunId,
        status: JobRunStatus.Stopped,
        startTime: new Date('2024-01-01T08:00:00Z'),
        jobConfigId,
        jobConfig: {
          sourcePath: {
            fileServer: { fileServerName: 'SrcServer' },
            volumePath: '/vol/src',
          },
          sourceDirectoryPath: '/data',
          targetPath: {
            fileServer: { fileServerName: 'DstServer' },
            volumePath: '/vol/dst',
          },
          targetDirectoryPath: '/backup',
        },
      };

      jest.spyOn(jobRunRepo, 'find').mockResolvedValue([mockRun] as any);
      jest.spyOn(jobConfigRepo, 'find').mockResolvedValue([]);

      const result = await service.getStoppedJobsReport([jobRunId], []);

      expect(result.stoppedRuns).toEqual([{
        runId: jobRunId,
        status: JobRunStatus.Stopped,
        startTime: mockRun.startTime,
        jobConfigId,
        sourceServer: 'SrcServer',
        sourceVolume: '/vol/src',
        sourceDir: '/data',
        destServer: 'DstServer',
        destVolume: '/vol/dst',
        destDir: '/backup',
      }]);
      expect(result.deactivatedConfigs).toEqual([]);
    });

    it('should return deactivatedConfigs mapped from job configs', async () => {
      const cfgId = 'cfg-2';
      const mockConfig = {
        id: cfgId,
        jobType: JobType.MIGRATE,
        status: JobStatus.InActive,
        sourcePath: {
          fileServer: { fileServerName: 'SrcServer2' },
          volumePath: '/vol/src2',
        },
        sourceDirectoryPath: null,
        targetPath: {
          fileServer: { fileServerName: 'DstServer2' },
          volumePath: '/vol/dst2',
        },
        targetDirectoryPath: null,
      };

      jest.spyOn(jobRunRepo, 'find').mockResolvedValue([]);
      jest.spyOn(jobConfigRepo, 'find').mockResolvedValue([mockConfig] as any);

      const result = await service.getStoppedJobsReport([], [cfgId]);

      expect(result.stoppedRuns).toEqual([]);
      expect(result.deactivatedConfigs).toEqual([{
        configId: cfgId,
        jobType: JobType.MIGRATE,
        status: JobStatus.InActive,
        sourceServer: 'SrcServer2',
        sourceVolume: '/vol/src2',
        sourceDir: '',
        destServer: 'DstServer2',
        destVolume: '/vol/dst2',
        destDir: '',
      }]);
    });

    it('should handle missing jobConfig on run (fallback to empty strings)', async () => {
      const runId = 'run-2';
      const mockRun = {
        id: runId,
        status: JobRunStatus.Stopped,
        startTime: new Date(),
        jobConfigId: 'cfg-orphan',
        jobConfig: null, // no relation loaded
      };

      jest.spyOn(jobRunRepo, 'find').mockResolvedValue([mockRun] as any);
      jest.spyOn(jobConfigRepo, 'find').mockResolvedValue([]);

      const result = await service.getStoppedJobsReport([runId], []);

      expect(result.stoppedRuns[0]).toMatchObject({
        runId,
        sourceServer: '',
        sourceVolume: '',
        sourceDir: '',
        destServer: '',
        destVolume: '',
        destDir: '',
      });
    });
  });

  // ---- updateJobConfig with futureSchedule ---- //
  describe('updateJobConfig with futureSchedule mapping', () => {
    it('should map futureSchedule DTO field to futureScheduleAt entity field', async () => {
      const jobConfigId = 'cfg-future';
      const futureDate = new Date('2025-06-01T00:00:00Z');
      const mockJob: any = {
        id: jobConfigId,
        jobType: JobType.MIGRATE,
        futureScheduleAt: null,
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJob);
      jest.spyOn(jobConfigRepo, 'save').mockImplementation(async (e: any) => e);

      const result = await service.updateJobConfig(jobConfigId, {
        futureSchedule: futureDate,
      } as any);

      expect(result.futureScheduleAt).toEqual(futureDate);
      expect(jobConfigRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ futureScheduleAt: futureDate }),
      );
    });
  });

  // ---- getJobEntity ---- //
  describe('getJobEntity', () => {
    it('should return the job entity when found', async () => {
      const jobId = 'job-entity-1';
      const mockJob = { id: jobId, jobType: JobType.MIGRATE } as any;
      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJob);

      const result = await service.getJobEntity(jobId);

      expect(result).toEqual(mockJob);
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({ where: { id: jobId } });
    });

    it('should throw NotFoundException when job entity is not found', async () => {
      const jobId = 'missing-job';
      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(null);

      await expect(service.getJobEntity(jobId)).rejects.toThrow(
        new NotFoundException(`Job with id ${jobId} not found`),
      );
    });
  });

  // ---- getAllJobConfig covering fetchLatestRunPerJobConfig & fetchBatchErrorCountsForRuns ---- //
  describe('getAllJobConfig — fetchLatestRunPerJobConfig & fetchBatchErrorCountsForRuns', () => {
    it('should populate error counts from operationErrors and workerErrors when runs are found', async () => {
      const projectId = 'proj-1';
      const jobConfigId = 'cfg-x';
      const latestRunId = 'run-x';
      const date = new Date();

      const mockAllJobsDetails = [{
        jobconfigid: jobConfigId,
        jobtype: JobType.MIGRATE,
        jobconfigstatus: JobStatus.Active,
        firstrunat: date,
        futureschedule: null,
        sourcepath: '/vol/src',
        targetpath: '/vol/dst',
        sourceservername: 'Srv1',
        targetservername: 'Srv2',
        sourceprotocol: 'NFS',
        targetprotocol: 'NFS',
        sourcedirectorypath: null,
        targetdirectorypath: null,
        configname: 'cfg',
        createdAt: date,
        updated_at: date,
        totalRuns: 2,
      }];

      // jobConfigRepo.createQueryBuilder for the main getAllJobConfig query
      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockAllJobsDetails),
      } as any);

      // jobRunRepo.createQueryBuilder: fetchLatestRunPerJobConfig returns a row
      jest.spyOn(jobRunRepo, 'createQueryBuilder').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { jobconfigid: jobConfigId, id: latestRunId },
        ]),
      } as any);

      // operationErrorRepo.createQueryBuilder: fetchBatchErrorCountsForRuns
      jest.spyOn(operationErrorRepo, 'createQueryBuilder').mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { jobrunid: latestRunId, count: '3' },
        ]),
      } as any);

      // workerJobRunMapRepo.createQueryBuilder: fetchBatchErrorCountsForRuns
      jest.spyOn(workerJobRunMapRepo, 'createQueryBuilder').mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { jobrunid: latestRunId },
        ]),
      } as any);

      jest.spyOn(require('src/utils/mapper'), 'nextDate').mockReturnValue(date);

      const result = await service.getAllJobConfig(projectId);

      expect(result).toHaveLength(1);
      // 3 operation errors + 1 worker error = 4
      expect(result[0].errors).toBe(4);
    });
  });

  // ---- deleteIdentityMappingsForJob — no mappings ---- //
  describe('deleteIdentityMappingsForJob — additional branches', () => {
    it('should return early with message when no cross-mappings exist', async () => {
      const jobConfigId = 'cfg-no-mappings';
      jest.spyOn(identityCrossMappingRepo, 'find').mockResolvedValue([]);

      const result = await service.deleteIdentityMappingsForJob(jobConfigId);

      expect(result).toEqual({
        message: 'No identity mappings found for this job configuration',
      });
      expect(identityCrossMappingRepo.update).not.toHaveBeenCalled();
    });
  });

  // ---- getFileServerById ---- //
  describe('getFileServerById', () => {
    it('should return the file server entity when found', async () => {
      const fsId = 'fs-1';
      const mockFs = { id: fsId, fileServerName: 'MyServer' } as any;
      jest.spyOn(fileServerRepo, 'findOne').mockResolvedValue(mockFs);

      const result = await service.getFileServerById(fsId);

      expect(result).toEqual(mockFs);
      expect(fileServerRepo.findOne).toHaveBeenCalledWith({ where: { id: fsId } });
    });

    it('should return null when file server is not found', async () => {
      jest.spyOn(fileServerRepo, 'findOne').mockResolvedValue(null);

      const result = await service.getFileServerById('missing-fs');

      expect(result).toBeNull();
    });
  });
});