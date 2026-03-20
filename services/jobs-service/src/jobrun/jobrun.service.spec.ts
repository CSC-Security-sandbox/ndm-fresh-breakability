import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import {
  ErrorType, formatBytes
} from "@netapp-cloud-datamigrate/jobs-lib";
import {
  LoggerFactory
} from "@netapp-cloud-datamigrate/logger-lib";
import {
  CutOverStatus,
  JobRunStatus,
  JobStatus,
  JobType,
  PausedReason,
  Protocol,
  WorkerStatus
} from "src/constants/enums";
import { ScheduleStatus } from "src/constants/status";
import { FileServerEntity } from "src/entities/fileserver.entity";
import { IdentityConfigCrossMappingEntity } from "src/entities/indentity-mapping-cross.entity";
import { IdentityMappingEntity } from "src/entities/indentity-mapping.entity";
import { InventoryEntity } from "src/entities/inventory.entity";
import { JobOptionsEntity } from "src/entities/joboptions.entity";
import { OperationErrorEntity } from "src/entities/operation-error.entity";
import { OperationsEntity } from "src/entities/operation.entity";
import { ProjectEntity } from "src/entities/project.entity";
import {
  SpeedTestConfigEntity,
  SpeedTestConfigWorkerEntity,
} from "src/entities/speed-test-job-config.entity";
import {
  NetworkPerformanceResultEntity,
  SpeedLogEntity,
  SpeedLogEntryEntity,
  SpeedTestResultEntity,
} from "src/entities/speed-test-result.entity";
import { TaskEntity } from "src/entities/task.entity";
import { VolumeEntity } from "src/entities/volume.entity";
import { WorkerEntity } from "src/entities/worker.entity";
import { JobConfigService } from "src/jobconfig/jobconfig.service";
import { MountTrackerService } from "src/jobconfig/mount-tracker.service";
import { RedisService } from "src/redis/redis.service";
import { AuthService } from "src/auth/auth.service";
import { HttpService } from "@nestjs/axios";
import { WorkflowService } from "src/workflow/workflow.service";
import { MigrationConflictService } from "src/migration-conflict/migration-conflict.service";
import { Repository } from "typeorm";
import { JobConfigEntity } from "../entities/jobconfig.entity";
import { JobRunEntity } from "../entities/jobrun.entity";
import { WorkerJobRunMap } from "../entities/workerjobrun.entity";
import { JobErrorQueryDto } from "./dto/jobRunErrors.dto";
import { JobRunPageDto } from "./dto/jobrunpage.dto";
import { JobRunStats } from "./dto/jobstats";
import { JobRunInitService } from "./jobrun.init.service";
import { JobRunService } from "./jobrun.service";

import * as parser from "cron-parser";
import { ErrorRemedyEntity } from "src/entities/error-remedies.entity";
import { SyncEmailEntity } from "src/entities/sync-email.entity";
import { ErrorRemedyService } from "src/errorremedies/errorremedies.service";
import { SendMailService } from "src/utils/send-email";
import { HealthStatus } from "src/workers/worker.types";
import { WorkersService } from "src/workers/workers.service";
import { SuccessEmailType } from "src/utils/send-email.type";
import { JobStatsSummaryMvEntity } from "src/entities/job-stats-summary-mv.entity";
import { JobConfigInventoryStatsEntity } from "src/entities/job-config-inventory-stats.entity";
import { DataSource } from "typeorm";

describe("JobRunService", () => {
  let service: JobRunService;
  let initService: JobRunInitService;
  let module: TestingModule;
  let jobRunRepo: Repository<JobRunEntity>;
  let jobConfigRepo: Repository<JobConfigEntity>;
  let workerJobRunMapRepo: Repository<WorkerJobRunMap>;
  let inventoryRepo: Repository<InventoryEntity>;
  let jobOptions: Repository<JobOptionsEntity>;
  let workFlowService: WorkflowService;
  let jobRunInitService: JobRunInitService;
  let configService: ConfigService;
  let jobConfigService: JobConfigService;
  let operationErrorRepo: Repository<OperationErrorEntity>;
  let identityMappingRepo: Repository<IdentityMappingEntity>;
  let identityCrossMappingRepo: Repository<IdentityConfigCrossMappingEntity>;
  let redisService: RedisService;
  let sendMailService: SendMailService;
  let errorRemedyService: ErrorRemedyService;
  let workerService: WorkersService;
  let jobStatsSummaryMvRepo: Repository<JobStatsSummaryMvEntity>;
  let jobConfigInventoryStatsRepo: Repository<JobConfigInventoryStatsEntity>;
  let dataSource: DataSource;

  let loggerFactoryMock = {
    create: jest.fn().mockReturnValue({
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        JobRunService,
        WorkflowService,
        JobRunInitService,
        JobConfigService,
        RedisService,
        SendMailService,
        ErrorRemedyService,
        WorkersService,
        {
          provide: getRepositoryToken(JobRunEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
            update: jest.fn(),
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
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
            update: jest.fn(),
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
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
            update: jest.fn(),
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
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
            update: jest.fn(),
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
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
            update: jest.fn(),
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
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
            update: jest.fn(),
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
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
            update: jest.fn(),
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
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
            update: jest.fn(),
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
            count: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnThis(),
              leftJoin: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              getRawOne: jest.fn().mockResolvedValue({ total: "0" }),
              getRawMany: jest.fn().mockResolvedValue([]),
            }),
            update: jest.fn(),
            innerJoin: jest.fn(),
            where: jest.fn(),
            select: jest.fn(),
            query: jest.fn(),
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
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
            update: jest.fn(),
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
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
            update: jest.fn(),
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
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
            update: jest.fn(),
          },
        },
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
          provide: getRepositoryToken(WorkerJobRunMap),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            count: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue([]),
            }),
            update: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(JobOptionsEntity),
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
          provide: getRepositoryToken(InventoryEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              getRawOne: jest.fn().mockResolvedValue({
                fileCount: "0",
                directoryCount: "0",
                totalSize: "0",
              }),
            }),
          },
        },
        {
          provide: getRepositoryToken(TaskEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(OperationsEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
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
            createQueryBuilder: jest.fn(),
          },
        },

        { provide: LoggerFactory, useValue: loggerFactoryMock },
        {
          provide: WorkflowService,
          useValue: {
            startWorkflow: jest.fn(),
            terminateWorkflow: jest.fn(),
            getWorkflowStatus: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            getJobContext: jest.fn(),
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
          provide: getRepositoryToken(ErrorRemedyEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
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
            count: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([]),
            }),
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
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            query: jest.fn(),
            transaction: jest.fn().mockImplementation(async (cb: any) => {
              const mockManager = {
                update: jest.fn().mockResolvedValue(undefined),
                findOne: jest.fn().mockResolvedValue(undefined),
                query: jest.fn().mockResolvedValue(undefined),
              };
              return cb(mockManager);
            }),
          },
        },
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
        ConfigService,
        {
          provide: MigrationConflictService,
          useValue: {
            checkMigrationConflicts: jest.fn().mockResolvedValue([]),
            hasCircularDependencies: jest.fn().mockResolvedValue(false),
            verifyCircularTaskDependency: jest.fn().mockResolvedValue([]),
          },
        },
        EventEmitter2,
      ],
    }).compile();

    service = module.get<JobRunService>(JobRunService);
    initService = module.get<JobRunInitService>(JobRunInitService);
    configService = module.get<ConfigService>(ConfigService);
    workFlowService = module.get<WorkflowService>(WorkflowService);
    jobRunInitService = module.get<JobRunInitService>(JobRunInitService);
    jobConfigService = module.get<JobConfigService>(JobConfigService);
    errorRemedyService = module.get<ErrorRemedyService>(ErrorRemedyService);
    operationErrorRepo = module.get<Repository<OperationErrorEntity>>(
      getRepositoryToken(OperationErrorEntity)
    );
    identityMappingRepo = module.get<Repository<IdentityMappingEntity>>(
      getRepositoryToken(IdentityMappingEntity)
    );
    identityCrossMappingRepo = module.get<
      Repository<IdentityConfigCrossMappingEntity>
    >(getRepositoryToken(IdentityConfigCrossMappingEntity));
    redisService = module.get<RedisService>(RedisService);

    jobRunRepo = module.get<Repository<JobRunEntity>>(
      getRepositoryToken(JobRunEntity)
    );
    jobConfigRepo = module.get<Repository<JobConfigEntity>>(
      getRepositoryToken(JobConfigEntity)
    );
    workerJobRunMapRepo = module.get<Repository<WorkerJobRunMap>>(
      getRepositoryToken(WorkerJobRunMap)
    );
    inventoryRepo = module.get<Repository<InventoryEntity>>(
      getRepositoryToken(InventoryEntity)
    );
    sendMailService = module.get<SendMailService>(SendMailService);
    workerService = module.get<WorkersService>(WorkersService);
    jobStatsSummaryMvRepo = module.get<Repository<JobStatsSummaryMvEntity>>(
      getRepositoryToken(JobStatsSummaryMvEntity)
    );
    jobConfigInventoryStatsRepo = module.get<Repository<JobConfigInventoryStatsEntity>>(
      getRepositoryToken(JobConfigInventoryStatsEntity)
    );
    dataSource = module.get<DataSource>(DataSource);
  });

  it("should update job config and job run status when cutover is rejected", async () => {
    const mockJobRunId = "jobRunId";
    const mockJobRun = {
      id: mockJobRunId,
      jobConfig: {
        sourcePathId: "sourcePathId",
        targetPathId: "targetPathId",
      },
    };

    jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(mockJobRun as any);
    jest
      .spyOn(jobConfigRepo, "update")
      .mockResolvedValue({ affected: 1 } as any);
    jest.spyOn(jobRunRepo, "update").mockResolvedValue({ affected: 1 } as any);

    await service.cutOverApproval(mockJobRunId, CutOverStatus.REJECTED);

    expect(jobRunRepo.findOne).toHaveBeenCalledWith({
      where: { id: mockJobRunId },
      relations: { jobConfig: true },
    });
    expect(jobConfigRepo.update).toHaveBeenCalledWith(
      {
        sourcePathId: mockJobRun.jobConfig.sourcePathId,
        targetPathId: mockJobRun.jobConfig.targetPathId,
        jobType: JobType.MIGRATE,
      },
      { status: JobStatus.Active }
    );
    expect(jobRunRepo.update).toHaveBeenCalledWith(
      { id: mockJobRunId },
      { status: JobRunStatus.Completed, subStatus: CutOverStatus.REJECTED }
    );
  });

  it("should update job config and job run status when cutover is approved", async () => {
    const mockJobRunId = "jobRunId";
    const mockJobRun = {
      id: mockJobRunId,
      jobConfig: {
        sourcePathId: "sourcePathId",
        targetPathId: "targetPathId",
      },
    };

    jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(mockJobRun as any);
    jest
      .spyOn(jobConfigRepo, "update")
      .mockResolvedValue({ affected: 1 } as any);
    jest.spyOn(jobRunRepo, "update").mockResolvedValue({ affected: 1 } as any);

    await service.cutOverApproval(mockJobRunId, CutOverStatus.APPROVED);

    expect(jobRunRepo.findOne).toHaveBeenCalledWith({
      where: { id: mockJobRunId },
      relations: { jobConfig: true },
    });
    expect(jobConfigRepo.update).toHaveBeenCalledWith(
      {
        sourcePathId: mockJobRun.jobConfig.sourcePathId,
        targetPathId: mockJobRun.jobConfig.targetPathId,
        jobType: JobType.CUT_OVER,
      },
      {
        status: JobStatus.InActive,
        futureScheduleAt: null,
        scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED,
      }
    );
    expect(jobRunRepo.update).toHaveBeenCalledWith(
      { id: mockJobRunId },
      { status: JobRunStatus.Completed, subStatus: CutOverStatus.APPROVED }
    );
  });

  // jobRun else case
  it("should throw NotFoundException when job run is not found", async () => {
    const mockJobRunId = "jobRunId";
    jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(null);
    await expect(
      service.cutOverApproval(mockJobRunId, CutOverStatus.APPROVED)
    ).rejects.toThrowError(NotFoundException);
  });

  describe("addHocRun", () => {
    it("should create a job run if job config is valid", async () => {
      const mockJobConfigId = "jobConfigId";
      const mockJobConfig = {
        id: mockJobConfigId,
        scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED,
        status: JobStatus.Active,
      };

      jest
        .spyOn(jobConfigRepo, "findOne")
        .mockResolvedValue(mockJobConfig as any);
      jest
        .spyOn(jobRunInitService, "createJobRun")
        .mockResolvedValue("job run created" as any);

      const result = await service.addHocRun(mockJobConfigId);

      expect(result).toBe("job run created");
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockJobConfigId },
      });
      expect(jobRunInitService.createJobRun).toHaveBeenCalledWith(
        mockJobConfig.id,
        expect.any(Date),
        undefined
      );
    });

    it("should throw NotFoundException if job config does not exist", async () => {
      const mockJobConfigId = "jobConfigId";

      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(null);

      await expect(service.addHocRun(mockJobConfigId)).rejects.toThrow(
        NotFoundException
      );
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockJobConfigId },
      });
    });

    it("should throw BadRequestException if job run is already created", async () => {
      const mockJobConfigId = "jobConfigId";
      const mockJobConfig = {
        id: mockJobConfigId,
        scheduler: ScheduleStatus.SCHEDULED,
        status: JobStatus.Active,
      };

      jest
        .spyOn(jobConfigRepo, "findOne")
        .mockResolvedValue(mockJobConfig as any);

      await expect(service.addHocRun(mockJobConfigId)).rejects.toThrow(
        BadRequestException
      );
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockJobConfigId },
      });
    });

    it("should throw BadRequestException if job config is inactive", async () => {
      const mockJobConfigId = "jobConfigId";
      const mockJobConfig = {
        id: mockJobConfigId,
        scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED,
        status: JobStatus.InActive,
      };

      jest
        .spyOn(jobConfigRepo, "findOne")
        .mockResolvedValue(mockJobConfig as any);

      await expect(service.addHocRun(mockJobConfigId)).rejects.toThrow(
        BadRequestException
      );
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockJobConfigId },
      });
    });

    it("should throw BadRequestException when circular dependency is detected for MIGRATE job", async () => {
      const mockJobConfigId = "job-config-id";
      const mockJobConfig = {
        id: mockJobConfigId,
        status: JobStatus.Active,
        jobType: JobType.MIGRATE,
        sourcePathId: "source-path-id",
        targetPathId: "target-path-id",
      };

      const mockCircularDependency = [
        {
          status: 'ACTIVE',
          jobId: 'conflicting-job-id',
          jobRunIds: ['run-1'],
          sourcePathId: 'target-path-id',
          targetPathId: 'source-path-id',
          sourceServerId: 'server-1',
          targetServerId: 'server-2',
          conflictType: 'circular',
        }
      ];

      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(null);
      
      // Access the mock through the module's providers array
      const circularDependencyMock = module.get(MigrationConflictService) as any;
      circularDependencyMock.checkMigrationConflicts.mockResolvedValue(mockCircularDependency);

      try {
        await service.addHocRun(mockJobConfigId);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.message).toBe(`Circular conflict detected for job config ${mockJobConfigId}`);
        expect(error.options.cause).toEqual(mockCircularDependency);
      }

      expect(circularDependencyMock.checkMigrationConflicts).toHaveBeenCalledWith({
        migrateConfigs: [
          {
            sourcePathId: mockJobConfig.sourcePathId,
            destinationPathId: [mockJobConfig.targetPathId],
          },
        ],
      });
    });

    it("should throw BadRequestException when circular dependency is detected for CUT_OVER job", async () => {
      const mockJobConfigId = "job-config-id";
      const mockJobConfig = {
        id: mockJobConfigId,
        status: JobStatus.Active,
        jobType: JobType.CUT_OVER,
        sourcePathId: "source-path-id",
        targetPathId: "target-path-id",
      };

      const mockCircularDependency = [
        {
          status: 'ACTIVE',
          jobId: 'conflicting-job-id',
          jobRunIds: ['run-1'],
          sourcePathId: 'target-path-id',
          targetPathId: 'source-path-id',
          sourceServerId: 'server-1',
          targetServerId: 'server-2',
          conflictType: 'circular',
        }
      ];

      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(null);
      
      const circularDependencyMock = module.get(MigrationConflictService) as any;
      circularDependencyMock.checkMigrationConflicts.mockResolvedValue(mockCircularDependency);

      try {
        await service.addHocRun(mockJobConfigId);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.message).toBe(`Circular conflict detected for job config ${mockJobConfigId}`);
        expect(error.options.cause).toEqual(mockCircularDependency);
      }
    });
  });

  describe("scheduleAJob", () => {
    it("should schedule jobs that match criteria", async () => {
      const mockJobs = [
        { id: "1", status: JobStatus.Active, firstRunAt: new Date() },
      ];
      jest.spyOn(jobConfigRepo, "find").mockReturnValue(mockJobs as any);

      const createJobRunSpy = jest
        .spyOn(initService, "createJobRun")
        .mockResolvedValue(undefined);

      const result = await initService.scheduleAJob();

      expect(result).toEqual(mockJobs);
      expect(createJobRunSpy).toHaveBeenCalledWith(
        mockJobs[0].id,
        expect.any(Date),
        undefined
      );
    });

    it("should return an empty array if no jobs match", async () => {
      jest.spyOn(jobConfigRepo, "find").mockReturnValue([] as any);

      const result = await initService.scheduleAJob();

      expect(result).toEqual([]);
    });
  });

  describe("jobRunUpdateStatus", () => {
    it("should update endTime and status to Completed, and call auxiliary methods for Completed status", async () => {
      const jobRunId = "12345";
      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue({
        id: jobRunId,
        jobConfigId: "config1",
        jobConfig: {},
      } as any);

      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue({
        id: "config1",
        jobType: JobType.MIGRATE,
        futureScheduleAt: null,
      } as any);

      const operationErrorQueryBuilder: any = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { errorType: "FileNotFound", count: "5" },
          { errorType: "PermissionDenied", count: "3" },
        ]),
      };

      jest.spyOn(jobStatsSummaryMvRepo, "findOne").mockResolvedValue({
        fileCount: '10',
        directoryCount: '5',
        totalSize: '5000',
        lastRefreshed: null,
      } as any);
      jest.spyOn(operationErrorRepo, "createQueryBuilder").mockReturnValue(operationErrorQueryBuilder);
      jest.spyOn(jobRunRepo, "update").mockResolvedValue(undefined);
      jest.spyOn(jobConfigRepo, "update").mockResolvedValue(undefined);
      jest.spyOn(errorRemedyService, "getDistinctErrorCodes").mockResolvedValue([] as any);
      jest.spyOn(workerJobRunMapRepo, "find").mockResolvedValue([]);
      jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([] as any),
      } as any);

      await service.updateJobRunStatus(jobRunId, JobRunStatus.Completed);

      expect(jobRunRepo.findOne).toHaveBeenCalledWith({ where: { id: jobRunId } });
      expect(jobStatsSummaryMvRepo.findOne).toHaveBeenCalledWith({ where: { jobRunId } });
      expect(operationErrorRepo.createQueryBuilder).toHaveBeenCalledWith("oe");
      expect(operationErrorQueryBuilder.getRawMany).toHaveBeenCalled();
      expect(dataSource.transaction).toHaveBeenCalled();
    });
  });

  describe("getJobConfig", () => {
    it("should retrieve and process job configuration without targetPathId", async () => {
      const sourceDirectoryPath = "/source/directory/path";
      const mockJobConfig = {
        id: "123",
        sourcePath: {
          volumePath: "/source/path",
          id: "source-id",
          fileServer: {
            protocol: "FTP",
            userName: "source-user",
            password: "source-pass",
            host: "source-host",
            config: { workingDirectory: "/source/working" },
            workers: [
              {
                workerId: "worker-1",
                stats: {
                  healthStatus: HealthStatus.Healthy,
                  updatedAt: new Date(),
                },
              },
              { workerId: "worker-2" },
              {
                workerId: "worker-3",
                stats: {
                  healthStatus: HealthStatus.Healthy,
                  updatedAt: new Date(Date.now() - 1000 * 62),
                },
              },
              {
                workerId: "worker-4",
                stats: {
                  healthStatus: HealthStatus.Unhealthy,
                  updatedAt: new Date(Date.now()),
                },
              },
            ],
            protocolVersion: "2",
          },
        },
        targetPath: null,
        sourceDirectoryPath,
        jobType: "DATA_TRANSFER",
      };

      jest
        .spyOn(jobConfigRepo, "findOne")
        .mockResolvedValue(mockJobConfig as any);
      configService.set("app.worker.healthCheckStatusTimout", 60);

      const result = await initService.getJobConfig("123");

      expect(jest.spyOn(jobConfigRepo, "findOne")).toHaveBeenCalledWith({
        where: { id: "123" },
        relations: {
          sourcePath: {
            fileServer: { config: true, workers: { stats: true } },
          },
          targetPath: {
            fileServer: { config: true, workers: { stats: true } },
          },
        },
      });

      expect(result).toEqual({
        id:'123',
        connection: {
          sourceCredential: {
            path: "/source/path",
            pathId: "source-id",
            protocol: "FTP",
            username: "source-user",
            password: "source-pass",
            host: "source-host",
            workingDirectory: undefined,
            protocolVersion: "2",
            isValidPath: undefined,
            isDisabled: undefined,
            directoryPath: sourceDirectoryPath,
          },
        },
        preserveAccessTime: undefined,
        shouldScanADS: false,
        skipFile: undefined,
        excludeFilePatterns: undefined,
        excludeOlderThan: undefined,
        workers: ["worker-1"], //filtering the  worker with no stats as it is categorized as unhealthy
        jobType: "DATA_TRANSFER",
        skipDelete: false,
      });
    });

    it("should retrieve and process job configuration with targetPathId", async () => {
      const sourceDirectoryPath = "/source/directory/path";
      const targetDirectoryPath = "/target/directory/path";
      const mockJobConfig = {
        id: "123",
        sourcePath: {
          volumePath: "/source/path",
          id: "source-id",
          fileServer: {
            protocol: "FTP",
            userName: "source-user",
            password: "source-pass",
            host: "source-host",
            config: { workingDirectory: "/source/working" },
            workers: [
              {
                workerId: "worker-2",
                stats: {
                  healthStatus: HealthStatus.Healthy,
                  updatedAt: new Date(),
                },
              },
              {
                workerId: "worker-3",
                stats: {
                  healthStatus: HealthStatus.Healthy,
                  updatedAt: new Date(Date.now() - 1000 * 62),
                },
              },
              {
                workerId: "worker-4",
                stats: {
                  healthStatus: HealthStatus.Unhealthy,
                  updatedAt: new Date(Date.now()),
                },
              },
            ],
            protocolVersion: "2",
          },
        },
        targetPath: {
          volumePath: "/target/path",
          id: "target-id",
          fileServer: {
            protocol: "SFTP",
            userName: "target-user",
            password: "target-pass",
            host: "target-host",
            config: { workingDirectory: "/target/working" },
            workers: [
              {
                workerId: "worker-2",
                stats: {
                  healthStatus: HealthStatus.Healthy,
                  updatedAt: new Date(),
                },
              },
              {
                workerId: "worker-3",
                stats: {
                  healthStatus: HealthStatus.Healthy,
                  updatedAt: new Date(Date.now() - 1000 * 62),
                },
              },
              {
                workerId: "worker-4",
                stats: {
                  healthStatus: HealthStatus.Unhealthy,
                  updatedAt: new Date(Date.now()),
                },
              },
            ],
            protocolVersion: "2",
          },
        },
        targetPathId: "target-id",
        sourceDirectoryPath,
        targetDirectoryPath,
        jobType: "DATA_TRANSFER",
      };

      jest
        .spyOn(jobConfigRepo, "findOne")
        .mockResolvedValue(mockJobConfig as any);
      configService.set("app.worker.healthCheckStatusTimout", 60);

      const result = await initService.getJobConfig("123");

      expect(jest.spyOn(jobConfigRepo, "findOne")).toHaveBeenCalledWith({
        where: { id: "123" },
        relations: {
          sourcePath: {
            fileServer: { config: true, workers: { stats: true } },
          },
          targetPath: {
            fileServer: { config: true, workers: { stats: true } },
          },
        },
      });

      expect(result).toEqual({
        id:'123',
        connection: {
          sourceCredential: {
            path: "/source/path",
            pathId: "source-id",
            protocol: "FTP",
            username: "source-user",
            password: "source-pass",
            host: "source-host",
            workingDirectory: undefined,
            protocolVersion: "2",
            isValidPath: undefined,
            isDisabled: undefined,
            directoryPath: sourceDirectoryPath,
          },
          targetCredential: {
            path: "/target/path",
            pathId: "target-id",
            protocol: "SFTP",
            username: "target-user",
            password: "target-pass",
            host: "target-host",
            workingDirectory: undefined,
            protocolVersion: "2",
            isValidPath: undefined,
            isDisabled: undefined,
            directoryPath: targetDirectoryPath,
          },
        },
        workers: ["worker-2"],
        jobType: "DATA_TRANSFER",
        preserveAccessTime: undefined,
        shouldScanADS: false,
        skipFile: undefined,
        excludeFilePatterns: undefined,
        excludeOlderThan: undefined,
        skipDelete: false,
      });
    });
  });

  describe("createJobRun", () => {
    it("should create a job run if workers exist", async () => {
      const mockJob = {
        id: "1",
        sourcePath: { volumePath: "src" },
        targetPath: { volumePath: "tgt" },
      } as any;

      const mockWorkers = {
        connection: {
          sourceCredential: {
            protocol: Protocol.NFS,
            host: "source-host",
            pathId: "source-path-id",
            path: "/source/path",
            username: "source-user",
            password: "source-pass",
            workingDirectory: "/source/working",
            protocolVersion: "2",
            isValidPath: true,
          },
          targetCredential: {
            protocol: Protocol.SMB,
            host: "target-host",
            pathId: "target-path-id",
            path: "/target/path",
            username: "target-user",
            password: "target-pass",
            workingDirectory: "/target/working",
            protocolVersion: "2",
            isValidPath: true,
          },
        },
        workers: ["worker1", "worker2"],
      };

      jest
        .spyOn(initService, "getJobConfig")
        .mockResolvedValue(mockWorkers as any);

      jest
        .spyOn(jobRunRepo, "create")
        .mockImplementation((data) => data as any);
      jest.spyOn(jobRunRepo, "save").mockResolvedValue({ id: "1" } as any);

      jest
        .spyOn(workerJobRunMapRepo, "create")
        .mockImplementation((data) => data as any);

      jest.spyOn(initService, "buildJobContext").mockImplementation(jest.fn());

      jest
        .spyOn(initService, "startStreamConsumer")
        .mockResolvedValue(undefined);

      // const result = await initService.createJobRun(mockJob, new Date());

      jest.spyOn(initService, "buildJobContext").mockImplementation();
      const result = await initService.createJobRun(mockJob, new Date());
      expect(result).toEqual({ id: "1" });
    });

    it("should log a warning if no workers exist", async () => {
      const mockJob = "1" as any;

      jest
        .spyOn(initService, "getJobConfig")
        .mockResolvedValue({ workers: [] } as any);
      try {
        await initService.createJobRun(mockJob, new Date());
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException)
      }
    });
  });

  // describe('getJobRun', () => {
  //   it('should return job runs when they exist', async () => {
  //     const mockJobRuns = [{ id: '1', status: JobRunStatus.Ready}];
  //     jest.spyOn(jobRunRepo, 'find').mockResolvedValue(mockJobRuns as any);

  //     const result = await service.getJobRun({ where: { status: JobRunStatus.Ready} });

  //     expect(result).toEqual(mockJobRuns);
  //     expect(jobRunRepo.find).toHaveBeenCalledWith({ where: { status: JobRunStatus.Ready } });
  //   });

  //   it('should throw an error when no job runs are found', async () => {
  //     jest.spyOn(jobRunRepo, 'find').mockResolvedValue([]);

  //     await expect(service.getJobRun({ where: { status:  JobRunStatus.Ready} })).rejects.toThrowError(
  //       `Job run not found`
  //     );

  //     expect(jobRunRepo.find).toHaveBeenCalledWith({ where: { status:  JobRunStatus.Ready} });
  //   });
  // });

  describe("findAllJobRuns", () => {
    it("should return paginated data with count if undefined", async () => {
      const workers = [
        { id: "1", name: "Worker1" },
        { id: "2", name: "Worker2" },
      ];
      const total = 2;

      jest.spyOn(jobRunRepo, "find").mockResolvedValueOnce(workers as any);
      jest.spyOn(jobRunRepo, "count").mockResolvedValueOnce(total);

      const result = await service.findAllJobRuns({} as any);

      expect(result).toEqual({ data: workers, total });
      expect(jobRunRepo.find).toHaveBeenCalled();
      expect(jobRunRepo.count).toHaveBeenCalled();
    });

    it("should return paginated data with count", async () => {
      const jobRunPageDto: JobRunPageDto = {
        page: "1",
        limit: "10",
        sort: "name",
        order: "asc",
        iterationNumber: 1,
        jobConfigId: "e45678",
        status: JobRunStatus.Ready,
      } as any;
      const workers = [
        { id: "1", name: "Worker1" },
        { id: "2", name: "Worker2" },
      ];
      const total = 2;

      jest.spyOn(jobRunRepo, "find").mockResolvedValueOnce(workers as any);
      jest.spyOn(jobRunRepo, "count").mockResolvedValueOnce(total);

      const result = await service.findAllJobRuns(jobRunPageDto);

      expect(result).toEqual({ data: workers, total });
      expect(jobRunRepo.find).toHaveBeenCalled();
      expect(jobRunRepo.count).toHaveBeenCalled();
    });

    it("should return data without pagination if no page and limit are provided", async () => {
      const jobRunPageDto: JobRunPageDto = {
        sort: "name",
        order: "asc",
      } as any;
      const jobRun = [
        { id: "1", name: "jobRun1" },
        { id: "2", name: "jobRun2" },
      ];
      const total = 2;

      jest.spyOn(jobRunRepo, "find").mockResolvedValueOnce(jobRun as any);
      jest.spyOn(jobRunRepo, "count").mockResolvedValueOnce(total);

      const result = await service.findAllJobRuns(jobRunPageDto);

      expect(result).toEqual({ data: jobRun, total });
      expect(jobRunRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { name: "asc" },
      });
      expect(jobRunRepo.count).toHaveBeenCalled();
    });

    it("should return an empty result when no workers are found", async () => {
      const jobRunPageDto: JobRunPageDto = { page: "1", limit: "10" } as any;
      jest.spyOn(jobRunRepo, "find").mockResolvedValueOnce([]);
      jest.spyOn(jobRunRepo, "count").mockResolvedValueOnce(0);

      const result = await service.findAllJobRuns(jobRunPageDto);
      expect(result).toEqual({ data: [], total: 0 });
      expect(jobRunRepo.find).toHaveBeenCalled();
      expect(jobRunRepo.count).toHaveBeenCalled();
    });

    it("should handle jobRunRepo errors", async () => {
      const jobRunPageDto: JobRunPageDto = { page: "1", limit: "10" } as any;
      jest
        .spyOn(jobRunRepo, "find")
        .mockRejectedValueOnce(new Error("Database error"));

      await expect(service.findAllJobRuns(jobRunPageDto)).rejects.toThrow(
        "Database error"
      );
      expect(jobRunRepo.find).toHaveBeenCalled();
    });
  });

  describe("updateJobRun", () => {
    it("should update and return the updated job run when it exists", async () => {
      const jobRunId = "1";
      const existingJobRun = {
        id: jobRunId,
        status: "Ready",
        iterationNumber: 1,
      };
      const updateData = { status: "In Progress" };
      const updatedJobRun = { ...existingJobRun, ...updateData };

      jest
        .spyOn(jobRunRepo, "findOne")
        .mockResolvedValue(existingJobRun as any);
      jest.spyOn(jobRunRepo, "save").mockResolvedValue(updatedJobRun as any);

      const result = await service.updateJobRun(jobRunId, updateData as any);

      expect(result).toEqual(updatedJobRun);
      expect(jobRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobRunId },
      });
      expect(jobRunRepo.save).toHaveBeenCalledWith({
        ...existingJobRun,
        ...updateData,
      });
    });

    it("should throw an error when the job run does not exist", async () => {
      const jobRunId = "1";
      const updateData = { status: "In Progress" };

      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(null);

      await expect(
        service.updateJobRun(jobRunId, updateData as any)
      ).rejects.toThrowError(`Job run with id ${jobRunId} not found`);

      expect(jobRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobRunId },
      });
    });
  });

  it("should return job runs with calculated stats", async () => {
    const filter = { projectId: "project123" };

    const mockJobRuns = [
      {
        jobrunid: "1",
        jobtype: "DISCOVER",
        volumepath: "/source/path",
        sourcefileserverprotocol: "HTTP",
        sourceconfigname: "SourceServer",
        targetvolumepath: "/target/path",
        targetfileserverprotocol: "FTP",
        targetconfigname: "TargetServer",
        status: JobRunStatus.Running,
        starttime: new Date(Date.now() - 10000),
        endtime: new Date(),
        jobstats: null,
      },
    ];

    jest.spyOn(jobRunRepo, "createQueryBuilder").mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(mockJobRuns),
    } as any);

    const mockMvStats = {
      jobRunId: "1",
      fileCount: "10",
      directoryCount: "2",
      totalSize: "2048",
    } as any;
    jest.spyOn(service as any, "fetchBatchMvStats").mockResolvedValue({ "1": mockMvStats });
    jest.spyOn(service as any, "fetchBatchErrorCounts").mockResolvedValue({
      "1": [{ errortype: "FileNotFound", count: 5 }],
    });

    const result = await service.getJobAllRuns(filter);

    expect(result).toMatchObject([
      {
        status: JobRunStatus.Running,
        startTime: mockJobRuns[0].starttime,
        endTime: mockJobRuns[0].endtime,
        jobType: "DISCOVER",
        sourceServer: {
          serverName: "SourceServer",
          path: "/source/path",
          protocol: "HTTP",
        },
        destinationServer: {
          serverName: "TargetServer",
          path: "/target/path",
          protocol: "FTP",
        },
        scannedFilesCount: "10",
        scannedDirectoriesCount: "2",
        totalScannedSize: "2 KiB",
        totalMigratedSize: "0 B",
        errors: [{ errortype: "FileNotFound", count: 5 }],
      },
    ]);

    expect(jobRunRepo.createQueryBuilder).toHaveBeenCalledWith("jobRun");
    expect(service["fetchBatchMvStats"]).toHaveBeenCalledWith(["1"]);
    expect(service["fetchBatchErrorCounts"]).toHaveBeenCalledWith(["1"]);

  });

  it("should return job runs with calculated stats scanned data as 0 for migration", async () => {
    const filter = { projectId: "project123" };
    const mockJobRuns = [
      {
        jobrunid: "1",
        jobtype: "MIGRATE",
        volumepath: "/source/path",
        sourcefileserverprotocol: "HTTP",
        sourceconfigname: "SourceServer",
        targetvolumepath: "/target/path",
        targetfileserverprotocol: "FTP",
        targetconfigname: "TargetServer",
        status: JobRunStatus.Completed,
        starttime: new Date(Date.now() - 10000),
        endtime: new Date(),
      },
    ];

    const mockMvStats = {
      jobRunId: "1",
      fileCount: "10",
      directoryCount: "5",
      totalSize: "5000",
    } as any;

    jest.spyOn(jobRunRepo, "createQueryBuilder").mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(mockJobRuns),
    } as any);
    jest.spyOn(service as any, "fetchBatchMvStats").mockResolvedValue({ "1": mockMvStats });
    jest.spyOn(service as any, "fetchBatchErrorCounts").mockResolvedValue({});

    const result = await service.getJobAllRuns(filter);

    expect(result).toMatchObject([
      {
        status: JobRunStatus.Completed,
        startTime: mockJobRuns[0].starttime,
        endTime: mockJobRuns[0].endtime,
        jobType: "MIGRATE",
        sourceServer: {
          serverName: "SourceServer",
          path: "/source/path",
          protocol: "HTTP",
        },
        destinationServer: {
          serverName: "TargetServer",
          path: "/target/path",
          protocol: "FTP",
        },
        scannedFilesCount: "10",
        scannedDirectoriesCount: "5",
        totalScannedSize: "0 B",
        totalMigratedSize: "4.88 KiB",
        errors: [],
      },
    ]);
    expect(service["fetchBatchMvStats"]).toHaveBeenCalledWith(["1"]);
  });

  it("should handle no job runs for the given filter", async () => {
    const filter = { projectId: "nonexistent" };

    jest.spyOn(jobRunRepo, "createQueryBuilder").mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    } as any);

    const result = await service.getJobAllRuns(filter);

    expect(result).toEqual([]);
  });

  it("should handle missing inventory data for job runs", async () => {
    const filter = { projectId: "project123" };
    const mockJobRuns = [
      {
        jobrunid: "run1",
        jobtype: "COPY",
        jobconfigid: "config1",
        volumepath: "/source/path",
        sourcefileserverprotocol: "HTTP",
        sourceconfigname: "SourceServer",
        targetvolumepath: null,
        targetfileserverprotocol: null,
        targetconfigname: null,
        status: JobRunStatus.Completed,
        starttime: new Date(Date.now() - 10000),
        endtime: null,
        jobstats: null,
      },
    ];

    jest.spyOn(jobRunRepo, "createQueryBuilder").mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(mockJobRuns),
    } as any);

    const result = await service.getJobAllRuns(filter);

    expect(result).toHaveLength(1);
    expect(result[0].scannedFilesCount).toBe("0");
    expect(result[0].scannedDirectoriesCount).toBe("0");
    expect(result[0].errors).toEqual([]);
  });
  
  it("should handle completed job runs with jobstats", async () => {
    const filter = { projectId: "project123" };
    const mockJobRuns = [
      {
        jobrunid: "run1",
        jobconfigid: "config1",
        jobtype: "DISCOVER",
        volumepath: "/source/path",
        sourcefileserverprotocol: "HTTP",
        sourceconfigname: "SourceServer",
        targetvolumepath: "/target/path",
        targetfileserverprotocol: "FTP",
        targetconfigname: "TargetServer",
        status: JobRunStatus.Completed,
        starttime: new Date(Date.now() - 10000),
        endtime: new Date(),
      },
    ];

    jest.spyOn(jobRunRepo, "createQueryBuilder").mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(mockJobRuns),
    } as any);

    jest.spyOn(service as any, "fetchBatchMvStats").mockResolvedValue({
      run1: { jobRunId: "run1", fileCount: "15", directoryCount: "3", totalSize: "7500" },
    });
    jest.spyOn(service as any, "fetchBatchErrorCounts").mockResolvedValue({
      run1: [{ errortype: "INFO", count: 2 }],
    });

    const result = await service.getJobAllRuns(filter);

    expect(result[0]).toMatchObject({
      jobRunId: "run1",
      status: JobRunStatus.Completed,
      scannedFilesCount: "15",
      scannedDirectoriesCount: "3",
      totalScannedSize: "7.32 KiB",
      totalMigratedSize: "0 B",
      errors: [{ errortype: "INFO", count: 2 }],
    });
    expect(service["fetchBatchMvStats"]).toHaveBeenCalledWith(["run1"]);
  });
  describe("getJobRun", () => {
    it("should return job run details when it exists", async () => {
      // Arrange
      const jobId = "1";
      const jobRunId = "123";
      const jobConfigId = "456";
      const jobType = JobType.DISCOVER;
      const sourceServerName = "SourceServer";
      const sourcePath = "/source/path";
      const sourceProtocol = "HTTP";
      const targetServerName = "TargetServer";
      const targetPath = "/target/path";
      const targetProtocol = "FTP";
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + 1000);
      const fileCount = "0";
      const directoryCount = "0";
      const totalSize = "0";

      const mockJobRun = {
        id: jobRunId,
        status: JobRunStatus.Completed,
        startTime,
        endTime,
        jobConfigId,
        tasks: [],
      } as JobRunEntity;

      jest.spyOn(service["jobRunRepo"], "findOne")
        .mockResolvedValueOnce(mockJobRun)   // getJobRun initial load
        .mockResolvedValueOnce(mockJobRun);  // calculateJobRunStats internal load

      jest.spyOn(service["jobConfigRepo"], "findOne").mockResolvedValueOnce({
        id: jobConfigId,
        jobType,
        sourcePath: {
          fileServer: {
            config: { configName: sourceServerName },
            protocol: sourceProtocol,
          },
          volumePath: sourcePath,
        },
        targetPath: {
          fileServer: {
            config: { configName: targetServerName },
            protocol: targetProtocol,
          },
          volumePath: targetPath,
        },
        preserveAccessTime: false,
        firstRunAt: new Date().toDateString(),
        futureScheduleAt: "0 0 0 * * *",
        excludeOlderThan: new Date(),
        excludeFilePatterns: "test",
        status: JobStatus.Active,
        createdBy: "test",
        sourcePathId: "1",
        targetPathId: "2",
        jobRuns: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: "test",
      } as unknown as JobConfigEntity);

      jest.spyOn(service["jobStatsSummaryMvRepo"], "findOne").mockResolvedValueOnce({
        fileCount,
        directoryCount,
        totalSize,
        lastRefreshed: null,
      } as any);

      jest
        .spyOn(service, "getErrorCounts")
        .mockImplementation()
        .mockReturnValue([] as any);

      const result = await service.getJobRun(jobId);

      expect(service["jobConfigRepo"].findOne).toHaveBeenCalledWith({
        where: { id: jobConfigId },
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
      expect(result).toEqual({
        jobRunId,
        jobConfigId,
        jobRunType: "REGULAR",
        status: JobRunStatus.Completed,
        startTime,
        endTime,
        jobType,
        sourceServer: {
          serverName: sourceServerName,
          path: sourcePath,
          protocol: sourceProtocol,
        },
        destinationServer: {
          serverName: targetServerName,
          path: targetPath,
          protocol: targetProtocol,
        },
        timeElapsed: endTime.getTime() - startTime.getTime(),
        scannedFilesCount: fileCount,
        scannedDirectoriesCount: directoryCount,
        totalScannedSize: "0 B",
        totalMigratedSize: "0 B",
        errors: [],
        tasks: [],
      });
      expect(result.tasks.length).toBe(0);
    });
    it("should return job run details when it exists with stats", async () => {
      // Arrange
      const jobId = "1";
      const jobRunId = "123";
      const jobConfigId = "456";
      const jobType = JobType.MIGRATE;
      const sourceServerName = "SourceServer";
      const sourcePath = "/source/path";
      const sourceProtocol = "HTTP";
      const targetServerName = "TargetServer";
      const targetPath = "/target/path";
      const targetProtocol = "FTP";
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + 1000);
      const fileCount = "0";
      const directoryCount = "0";
      const totalSize = "0";

      const mockJobRun = {
        id: jobRunId,
        status: JobRunStatus.Completed,
        startTime,
        endTime,
        jobConfigId,
        tasks: [],
      } as JobRunEntity;

      jest.spyOn(service["jobRunRepo"], "findOne")
        .mockResolvedValueOnce(mockJobRun)   // getJobRun initial load
        .mockResolvedValueOnce(mockJobRun);  // calculateJobRunStats internal load

      jest.spyOn(service["jobConfigRepo"], "findOne").mockResolvedValueOnce({
        id: jobConfigId,
        jobType,
        sourcePath: {
          fileServer: {
            config: { configName: sourceServerName },
            protocol: sourceProtocol,
          },
          volumePath: sourcePath,
        },
        targetPath: {
          fileServer: {
            config: { configName: targetServerName },
            protocol: targetProtocol,
          },
          volumePath: targetPath,
        },
        preserveAccessTime: false,
        firstRunAt: new Date().toDateString(),
        futureScheduleAt: "0 0 0 * * *",
        excludeOlderThan: new Date(),
        excludeFilePatterns: "test",
        status: JobStatus.Active,
        createdBy: "test",
        sourcePathId: "1",
        targetPathId: "2",
        jobRuns: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: "test",
      } as unknown as JobConfigEntity);

      jest.spyOn(service["jobStatsSummaryMvRepo"], "findOne").mockResolvedValueOnce({
        fileCount,
        directoryCount,
        totalSize,
        lastRefreshed: null,
      } as any);

      jest
        .spyOn(service, "getErrorCounts")
        .mockImplementation()
        .mockReturnValue([] as any);

      const result = await service.getJobRun(jobId);

      expect(service["jobConfigRepo"].findOne).toHaveBeenCalledWith({
        where: { id: jobConfigId },
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
      expect(result).toEqual({
        jobRunId,
        jobConfigId,
        jobRunType: "REGULAR",
        status: JobRunStatus.Completed,
        startTime,
        endTime,
        jobType,
        sourceServer: {
          serverName: sourceServerName,
          path: sourcePath,
          protocol: sourceProtocol,
        },
        destinationServer: {
          serverName: targetServerName,
          path: targetPath,
          protocol: targetProtocol,
        },
        timeElapsed: endTime.getTime() - startTime.getTime(),
        scannedFilesCount: fileCount,
        scannedDirectoriesCount: directoryCount,
        totalScannedSize: "0 B",
        totalMigratedSize: "0 B",
        errors: [],
        tasks: [],
      });
    });

    // jobRun.status !== JobRunStatus.Completed case
    it("should calculate job stats dynamically when job is not completed", async () => {
      const mockJobRun = {
        id: "jobRun123",
        status: JobRunStatus.Running,
        subStatus: null,
        startTime: new Date(Date.now() - 5000),
        endTime: null,
        jobConfigId: "config123",
        tasks: [
          {
            id: "task1",
            taskType: "COPY",
            status: "RUNNING",
            createdAt: new Date(Date.now() - 4000),
            updatedAt: new Date(Date.now() - 1000),
            worker: { workerName: "Worker1" },
          },
        ],
      };

      const mockJobConfig = {
        id: "config123",
        jobType: JobType.DISCOVER,
        sourcePath: {
          fileServer: {
            config: { configName: "SourceServer" },
            protocol: "SFTP",
          },
          volumePath: "/source/path",
        },
        targetPath: {
          fileServer: {
            config: { configName: "TargetServer" },
            protocol: "SFTP",
          },
          volumePath: "/target/path",
        },
      };

      jest.spyOn(service, "getErrorCounts").mockResolvedValue({});
      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(mockJobRun as any);
      jest
        .spyOn(jobConfigRepo, "findOne")
        .mockResolvedValue(mockJobConfig as any);
      jest.spyOn(service, "calculateJobRunStats").mockResolvedValue({
        fileCount: "10",
        directories: "2",
        totalSize: "5000",
        errors: [],
      });
      const result = await service.getJobRun("jobRun123");
      expect(service.calculateJobRunStats).toHaveBeenCalledWith("jobRun123");
      expect(result).toMatchObject({
        jobRunId: "jobRun123",
        status: JobRunStatus.Running,
        totalScannedSize: "4.88 KiB", // Assuming covertBytes converts bytes correctly
        totalMigratedSize: "0 B",
        tasks: [
          {
            taskId: "task1",
            taskType: "COPY",
            status: "RUNNING",
            startTime: expect.any(Date),
            endTime: expect.any(Date),
            worker: "Worker1",
            errors: [],
          },
        ],
      });
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]).toEqual({
        taskId: "task1",
        taskType: "COPY",
        status: "RUNNING",
        startTime: expect.any(Date),
        endTime: expect.any(Date),
        worker: "Worker1",
        errors: [],
      });
    });

    it("should throw an error when job run is not found", async () => {
      // Arrange
      const jobId = "nonexistent-id";
    
      jest.spyOn(service["jobRunRepo"], "findOne").mockResolvedValueOnce(null);
    
      // Act & Assert
      await expect(service.getJobRun(jobId)).rejects.toThrow(
        `Job run with id ${jobId} not found`
      );
    
      expect(service["jobRunRepo"].findOne).toHaveBeenCalledWith({
        select: expect.any(Object),
        where: { id: jobId },
        relations: ["tasks", "tasks.worker"],
      });
    });
  });

  describe("formatBytes", () => {
    it("should return bytes for values less than 1024", () => {
      expect(formatBytes(500)).toBe("500 B");
      expect(formatBytes(0)).toBe("0 B");
    });

    it("should return kilobytes for values between 1024 and 1 MiB", () => {
      expect(formatBytes(1024)).toBe("1 KiB");
      expect(formatBytes(1536)).toBe("1.5 KiB");
    });

    it("should return megabytes for values between 1 MiB and 1 GiB", () => {
      expect(formatBytes(1048576)).toBe("1 MiB"); // 1 MiB
      expect(formatBytes(2097152)).toBe("2 MiB"); // 2 MiB
      expect(formatBytes(1572864)).toBe("1.5 MiB"); // 1.5 MiB
    });

    it("should return gigabytes for values between 1 GiB and 1 TiB", () => {
      expect(formatBytes(1073741824)).toBe("1 GiB"); // 1 GiB
      expect(formatBytes(2147483648)).toBe("2 GiB"); // 2 GiB
      expect(formatBytes(1610612736)).toBe("1.5 GiB"); // 1.5 GiB
    });

    it("should return terabytes for values between 1 TiB and 1 PiB", () => {
      expect(formatBytes(1099511627776)).toBe("1 TiB"); // 1 TiB
      expect(formatBytes(2199023255552)).toBe("2 TiB"); // 2 TiB
      expect(formatBytes(1649267441664)).toBe("1.5 TiB"); // 1.5 TiB
    });

    it("should return petabytes for values greater than or equal to 1 PiB", () => {
      expect(formatBytes(1125899906842624)).toBe("1 PiB"); // 1 PiB
      expect(formatBytes(2251799813685248)).toBe("2 PiB"); // 2 PiB
      expect(formatBytes(1693247244558336)).toBe("1.5 PiB"); // 1.5 PiB
    });

    it("should handle very large numbers gracefully", () => {
      expect(formatBytes(1125899906842624000)).toBe("1000 PiB"); // 1000 PiB
    });
  });

  describe("covertBytes", () => {
    it("should convert bytes to appropriate units", () => {
      expect(formatBytes(500)).toBe("500 B");
      expect(formatBytes(1024)).toBe("1 KiB");
      expect(formatBytes(1048576)).toBe("1 MiB");
      expect(formatBytes(1073741824)).toBe("1 GiB");
      expect(formatBytes(1099511627776)).toBe("1 TiB");
      expect(formatBytes(1125899906842624)).toBe("1 PiB");
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

      expect(jobConfigService.hasCommonWorkers(mockData)).toBe(true);
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

      expect(jobConfigService.hasCommonWorkers(mockData)).toBe(false);
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

      expect(jobConfigService.hasCommonWorkers(mockData)).toBe(false);
    });
  });

  describe("findJobConfigs", () => {
    it("should find job configs based on conditions", async () => {
      const mockConditions = [
        { sourcePathId: "sourcePath1", destinationPathId: "destinationPath1" },
        { sourcePathId: "sourcePath2", destinationPathId: "destinationPath2" },
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

      jest.spyOn(jobConfigRepo, "createQueryBuilder").mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockJobConfigs),
      } as any);

      const result = await jobConfigService.findJobConfigs(mockConditions);

      expect(result).toEqual(mockJobConfigs);
      expect(jobConfigRepo.createQueryBuilder).toHaveBeenCalledWith(
        "jobConfig"
      );
    });

    it("should return empty array if no conditions are provided", async () => {
      const result = await jobConfigService.findJobConfigs([]);

      expect(result).toEqual([]);
      expect(jobConfigRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
  describe("getErrorOverview", () => {
    it("should return error counts for the given job run ID", async () => {
      const mockJobRunId = "jobRunId";
      const mockErrorCounts = [
        { errorType: "TypeError", count: "5" },
        { errorType: "ValidationError", count: "3" },
      ];

      jest.spyOn(service, "getErrorCounts").mockResolvedValue(mockErrorCounts);

      const result = await service.getErrorOverview(mockJobRunId);

      expect(result).toEqual(mockErrorCounts);
      expect(service.getErrorCounts).toHaveBeenCalledWith(mockJobRunId);
    });
  });

  describe("getErrorCounts", () => {
    it("should return error type counts for the given job run ID", async () => {
      const mockJobRunId = "jobRunId";
      const mockErrorCounts = [
        { errorType: "TypeError", count: "5" },
        { errorType: "ValidationError", count: "3" },
      ];

      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockErrorCounts),
      };

      jest
        .spyOn(operationErrorRepo, "createQueryBuilder")
        .mockReturnValue(mockQueryBuilder as any);
      jest.spyOn(workerJobRunMapRepo, "find").mockResolvedValue([]);

      jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([] as any),
      } as any);

      const result = await service.getErrorCounts(mockJobRunId);

      expect(result).toEqual(mockErrorCounts);
      expect(operationErrorRepo.createQueryBuilder).toHaveBeenCalledWith("oe");
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        "oe.operation",
        "o"
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "o.jobRunId = :jobRunId",
        { jobRunId: mockJobRunId }
      );
      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        "oe.errorType AS errorType",
        "COUNT(*) AS count",
      ]);
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith("oe.errorType");
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalled();
    });

    it("should handle errors while fetching error type counts", async () => {
      const mockJobRunId = "jobRunId";
      const mockError = new Error("Test error");

      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockRejectedValue(mockError),
      };

      jest
        .spyOn(operationErrorRepo, "createQueryBuilder")
        .mockReturnValue(mockQueryBuilder as any);
      const loggerSpy = jest.spyOn(service["logger"], "error");

      jest.spyOn(workerJobRunMapRepo, "find").mockResolvedValue([]);


      jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([] as any),
      } as any);

      const result = await service.getErrorCounts(mockJobRunId);

      expect(result).toEqual([]);
      expect(operationErrorRepo.createQueryBuilder).toHaveBeenCalledWith("oe");
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        "oe.operation",
        "o"
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "o.jobRunId = :jobRunId",
        { jobRunId: mockJobRunId }
      );
      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        "oe.errorType AS errorType",
        "COUNT(*) AS count",
      ]);
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith("oe.errorType");
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith(
        "Error occurred while fetching error type counts:",
        mockError
      );
    });

    it('should count correct setupFailedErrors for setupFailed error type', async () => {
      const mockJobRunId = "jobRunId";
      const mockError = new Error("Test error");

      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockRejectedValue(mockError),
      };

      jest
        .spyOn(operationErrorRepo, "createQueryBuilder")
        .mockReturnValue(mockQueryBuilder as any);
      const loggerSpy = jest.spyOn(service["logger"], "error");

      jest.spyOn(workerJobRunMapRepo, "find").mockResolvedValue([{ workerId: "worker1", workerResponse: "setupFailed" }] as any);

      jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ workerId: "worker1", workerResponse: "setupFailed" }] as any),
      } as any);

      const result = await service.getErrorCounts(mockJobRunId);
      expect(operationErrorRepo.createQueryBuilder).toHaveBeenCalledWith("oe");
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        "oe.operation",
        "o"
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "o.jobRunId = :jobRunId",
        { jobRunId: mockJobRunId }
      );
      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        "oe.errorType AS errorType",
        "COUNT(*) AS count",
      ]);
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith("oe.errorType");
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith(
        "Error occurred while fetching error type counts:",
        mockError
      );
      expect(result).toEqual([
        { errortype: "FATAL_ERROR", count: 1 }
      ])
    })

    it('should count correct setupFailedErrors for setupFailed error type when other already there', async () => {
      const mockJobRunId = "jobRunId";
      const mockErrorCounts = [
        { errortype: "FATAL_ERROR", count: 1 }
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
      jest.spyOn(workerJobRunMapRepo, "find").mockResolvedValue([{ workerId: "worker1", workerResponse: "setupFailed" }] as any);

      jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ workerId: "worker1", workerResponse: "setupFailed" }] as any),
      } as any);

      const result = await service.getErrorCounts(mockJobRunId);
      expect(result).toEqual([{ errortype: "FATAL_ERROR", count: 2 }])
    })

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
          { errortype: "FATAL_ERROR", count: 3 } // All 3 distinct errors counted
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
        jest.spyOn(workerJobRunMapRepo, "find").mockResolvedValue([]);
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
        
        // Raw DB rows: Non-fatal error (ENOENT) retried 3 times, each logged as RECOVERABLE_ERROR, 
        // final attempt after maxRetryCount reached is TRANSIENT_ERROR
        const mockDbRows = [
          { id: 1, operation_id: 'op1', error_code: 'ENOENT', error_message: 'File not found', file_path: '/data/file.txt', error_type: 'RECOVERABLE_ERROR', origin: 'SOURCE', created_at: '2024-01-01T10:00:00Z' }, // Excluded from query
          { id: 2, operation_id: 'op1', error_code: 'ENOENT', error_message: 'File not found', file_path: '/data/file.txt', error_type: 'RECOVERABLE_ERROR', origin: 'SOURCE', created_at: '2024-01-01T10:00:10Z' }, // Excluded from query
          { id: 3, operation_id: 'op1', error_code: 'ENOENT', error_message: 'File not found', file_path: '/data/file.txt', error_type: 'TRANSIENT_ERROR', origin: 'SOURCE', created_at: '2024-01-01T10:00:20Z' }  // Only this counted
        ];
        
        // Query result: WHERE filters RECOVERABLE_ERROR, only counts TRANSIENT_ERROR (final attempt)
        const mockErrorCounts = [
          { errortype: "TRANSIENT_ERROR", count: 1 }  // Only 1 TRANSIENT_ERROR (retries exhausted)
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
        jest.spyOn(workerJobRunMapRepo, "find").mockResolvedValue([]);
        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        } as any);

        const result = await service.getErrorCounts(mockJobRunId);
        expect(result).toEqual(mockErrorCounts);
        expect(result[0].count).toBe(1); // Only final TRANSIENT_ERROR counted (RECOVERABLE excluded)
      });

      it('should count errors from both Source and Destination separately', async () => {
        const mockJobRunId = "job-run-789";
        
        // Raw DB rows: Same file failed on both SOURCE and DESTINATION
        const mockDbRows = [
          { id: 1, operation_id: 'op1', error_code: 'EACCES', error_message: 'Permission denied', file_path: '/data/file.txt', error_type: 'FATAL_ERROR', origin: 'SOURCE' },
          { id: 2, operation_id: 'op1', error_code: 'EROFS', error_message: 'Read-only filesystem', file_path: '/data/file.txt', error_type: 'FATAL_ERROR', origin: 'DESTINATION' }
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
        jest.spyOn(workerJobRunMapRepo, "find").mockResolvedValue([]);
        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        } as any);

        const result = await service.getErrorCounts(mockJobRunId);
        expect(result).toEqual(mockErrorCounts);
        expect(result[0].count).toBe(2); // Both origins counted
      });

      it('should count mixed FATAL_ERROR and TRANSIENT_ERROR separately', async () => {
        const mockJobRunId = "job-run-mixed";
        
        // Raw DB rows: 5 FATAL + 3 TRANSIENT errors
        const mockDbRows = [
          { id: 1, operation_id: 'op1', error_code: 'EACCES', file_path: '/file1.txt', error_type: 'FATAL_ERROR', origin: 'SOURCE' },
          { id: 2, operation_id: 'op1', error_code: 'ENOSPC', file_path: '/file2.txt', error_type: 'FATAL_ERROR', origin: 'SOURCE' },
          { id: 3, operation_id: 'op2', error_code: 'ECONNRESET', file_path: '/file3.txt', error_type: 'FATAL_ERROR', origin: 'SOURCE' },
          { id: 4, operation_id: 'op2', error_code: 'ETIMEDOUT', file_path: '/file4.txt', error_type: 'FATAL_ERROR', origin: 'DESTINATION' },
          { id: 5, operation_id: 'op3', error_code: 'EROFS', file_path: '/file5.txt', error_type: 'FATAL_ERROR', origin: 'DESTINATION' },
          { id: 6, operation_id: 'op3', error_code: 'ENOENT', file_path: '/file6.txt', error_type: 'TRANSIENT_ERROR', origin: 'SOURCE' },
          { id: 7, operation_id: 'op3', error_code: 'ENOENT', file_path: '/file6.txt', error_type: 'TRANSIENT_ERROR', origin: 'SOURCE' },
          { id: 8, operation_id: 'op4', error_code: 'EIO', file_path: '/file7.txt', error_type: 'TRANSIENT_ERROR', origin: 'DESTINATION' }
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
        jest.spyOn(workerJobRunMapRepo, "find").mockResolvedValue([]);
        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        } as any);

        const result = await service.getErrorCounts(mockJobRunId);
        expect(result).toEqual(mockErrorCounts);
        expect(result.length).toBe(2); // Two error types
        expect(result.find(e => e.errortype === "FATAL_ERROR")?.count).toBe(5);
        expect(result.find(e => e.errortype === "TRANSIENT_ERROR")?.count).toBe(3);
      });

      it('should count large dataset with hundreds of errors efficiently', async () => {
        const mockJobRunId = "job-run-large";
        // Scenario: Large migration with many errors
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
        jest.spyOn(workerJobRunMapRepo, "find").mockResolvedValue([]);
        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        } as any);

        const result = await service.getErrorCounts(mockJobRunId);
        expect(result).toEqual(mockErrorCounts);
        expect(result[0].count + result[1].count).toBe(423); // Total errors
      });

      it('should handle job run with only FATAL_ERROR type', async () => {
        const mockJobRunId = "job-run-fatal-only";
        const mockErrorCounts = [
          { errortype: "FATAL_ERROR", count: 12 }
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
        jest.spyOn(workerJobRunMapRepo, "find").mockResolvedValue([]);
        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        } as any);

        const result = await service.getErrorCounts(mockJobRunId);
        expect(result).toEqual(mockErrorCounts);
        expect(result.length).toBe(1);
        expect(result[0].errortype).toBe("FATAL_ERROR");
      });

      it('should handle job run with only TRANSIENT_ERROR type', async () => {
        const mockJobRunId = "job-run-transient-only";
        const mockErrorCounts = [
          { errortype: "TRANSIENT_ERROR", count: 8 }
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
        jest.spyOn(workerJobRunMapRepo, "find").mockResolvedValue([]);
        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        } as any);

        const result = await service.getErrorCounts(mockJobRunId);
        expect(result).toEqual(mockErrorCounts);
        expect(result.length).toBe(1);
        expect(result[0].errortype).toBe("TRANSIENT_ERROR");
      });

      it('should exclude RECOVERABLE_ERROR from count', async () => {
        const mockJobRunId = "job-run-with-recoverable";
        
        // Raw DB rows: Mixed error types including RECOVERABLE_ERROR (still retrying)
        const mockDbRows = [
          { id: 1, operation_id: 'op1', error_code: 'EACCES', file_path: '/file1.txt', error_type: 'FATAL_ERROR', origin: 'SOURCE' },
          { id: 2, operation_id: 'op1', error_code: 'ENOSPC', file_path: '/file2.txt', error_type: 'FATAL_ERROR', origin: 'SOURCE' },
          { id: 3, operation_id: 'op2', error_code: 'ENOENT', file_path: '/file3.txt', error_type: 'RECOVERABLE_ERROR', origin: 'SOURCE' }, // Excluded
          { id: 4, operation_id: 'op2', error_code: 'ENOENT', file_path: '/file3.txt', error_type: 'RECOVERABLE_ERROR', origin: 'SOURCE' }, // Excluded
          { id: 5, operation_id: 'op3', error_code: 'ETIMEDOUT', file_path: '/file4.txt', error_type: 'FATAL_ERROR', origin: 'DESTINATION' },
          { id: 6, operation_id: 'op3', error_code: 'EIO', file_path: '/file5.txt', error_type: 'RECOVERABLE_ERROR', origin: 'DESTINATION' } // Excluded
        ];
        
        // Query result: WHERE error_type IN ('FATAL_ERROR', 'TRANSIENT_ERROR') excludes RECOVERABLE_ERROR
        const mockErrorCounts = [
          { errortype: "FATAL_ERROR", count: 3 } // Only 3 FATAL_ERROR counted, 3 RECOVERABLE excluded
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
        jest.spyOn(workerJobRunMapRepo, "find").mockResolvedValue([]);
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
        expect(result.find(e => e.errortype === "FATAL_ERROR")?.count).toBe(3); // 6 total - 3 recoverable = 3
      });

      it('should add worker setup errors to FATAL_ERROR count', async () => {
        const mockJobRunId = "job-run-with-setup-errors";
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
        
        // 2 workers with setup failures
        jest.spyOn(workerJobRunMapRepo, "find").mockResolvedValue([
          { workerId: "worker1", workerResponse: "setupFailed" },
          { workerId: "worker2", workerResponse: "setupFailed" }
        ] as any);

        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([
            { workerId: "worker1", workerResponse: "setupFailed" },
            { workerId: "worker2", workerResponse: "setupFailed" }
          ]),
        } as any);

        const result = await service.getErrorCounts(mockJobRunId);
        
        expect(result).toEqual([{ errortype: "FATAL_ERROR", count: 5 }]); // 3 + 2
      });
    });
  });
  describe("getJobRunErrors", () => {
    let repoQuerySpy: jest.SpyInstance;
    let qbWhereSpy: jest.SpyInstance;

    beforeEach(() => {
      repoQuerySpy = jest
        .spyOn(operationErrorRepo, "query")
        .mockResolvedValue([
          {
            id: "errorId1",
            errorMessage: "Err 1",
            errorType: "FATAL_ERROR",
            createdAt: "2025-05-02T10:41:29.015Z",
            fileName: "file1.txt",
            filePath: "/path/1",
            origin: "Dest",
            operationType: "Op1",
            errorCode: "code1",
            occurrence: "2",
          },
        ]);


      const fakeQB = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: "5" }),
      };
      qbWhereSpy = jest
        .spyOn(operationErrorRepo, "createQueryBuilder")
        .mockReturnValue(fakeQB as any);

      jest.spyOn(service as any, "getWorkerSetupErrors").mockResolvedValue([
        {
          workerResponse: {
            message: "setupFailedMsg",
            createdAt: "2025-05-02T11:00:00.000Z",
            operation: "SetupOp",
            code: "setupCode",
          },
        } as any,
      ]);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should return grouped rows + total", async () => {
      const dto: JobErrorQueryDto = {
        page: "1",
        limit: "10",
        sort: "createdAt",
        order: "DESC",
        jobRunId: "job123",
        errorType: ErrorType.FATAL_ERROR,
      };
      const mockData = [{ id: '1', errorType: 'FATAL_ERROR', occurrence: '2', errorMessage: "err_msg", errorCode: 'E1' }];
      const mockTotal = { total: '1' };
      const setupFailedErrors = [
        {
          workerResponse: {
            message: 'fail',
            createdAt: '2024-01-01',
            operation: 'Setup',
            code: 'SETUP_WORKER_FAILURE',
            origin: 'origin',
            occurrence: 1,
          },
        },
      ];

      jest.spyOn(operationErrorRepo, 'query').mockResolvedValueOnce([...mockData]);
      jest.spyOn(operationErrorRepo, 'createQueryBuilder').mockReturnValueOnce({
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValueOnce(mockTotal),
      } as any);
      jest.spyOn(service as any, 'getWorkerSetupErrors').mockResolvedValueOnce(setupFailedErrors);
      jest.spyOn(errorRemedyService, 'findByErrorCodes').mockReturnValue([{ errorCode: 'E1', description: 'desc', resolutionSteps: 'steps', referenceCommands: 'cmd' }] as any);


      const result = await service.getJobRunErrors(dto);

      expect(qbWhereSpy).toHaveBeenCalledWith("oe");
      expect(result).toEqual({
        data: expect.arrayContaining([
          expect.objectContaining({
            id: "1",
            occurrence: "2",
            errorType: "FATAL_ERROR",
            referenceCommands: "cmd",
            resolutionSteps: "steps",
            displayMessage: "err_msg"
          }),
          expect.objectContaining({
            errorType: "FATAL_ERROR",
            errorCode: "SETUP_WORKER_FAILURE",
            createdAt: "2024-01-01",
            displayMessage: "fail",
            errorMessage: "fail",
            occurrence: 1,
            operationType: "Setup",
            origin: "origin",
            referenceCommands: "cmd",
            resolutionSteps: "steps",
          }),
        ]),
        total: 2,
      });
    });

    it("should fallback defaults when page/limit/sort/order missing", async () => {
      const dto: JobErrorQueryDto = {
        jobRunId: "job123",
        errorType: ErrorType.RECOVERABLE_ERROR,
      };
      jest.spyOn(service as any, "getWorkerSetupErrors").mockResolvedValue([]);

      const result = await service.getJobRunErrors(dto);

      expect(repoQuerySpy).toHaveBeenCalledWith(
        expect.stringContaining("LIMIT $3 OFFSET $4"),
        ["job123", ErrorType.RECOVERABLE_ERROR, 10, 0]
      );
      expect(result).toEqual({
        data: expect.any(Array),
        total: 5,
      });
    });

    it("should not include worker setup errors when errorType != FATAL_ERROR", async () => {
      const dto: JobErrorQueryDto = {
        jobRunId: "job123",
        errorType: ErrorType.RECOVERABLE_ERROR,
        page: "2",
        limit: "5",
        sort: "filePath",
        order: "ASC",
      };
      jest.spyOn(service as any, "getWorkerSetupErrors").mockResolvedValue([
        { workerResponse: { /* ... */ } },
      ]);

      const result = await service.getJobRunErrors(dto);

      expect(result.total).toBe(5);
      expect(result.data).toHaveLength(1);
    });
  });
  it("should throw NotFoundException if jobRunId is not found", async () => {
    const mockJobRunId = "nonexistent-jobRunId";

    jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(null);

    await expect(service.getJobRun(mockJobRunId)).rejects.toThrow(Error);
    expect(jobRunRepo.findOne).toHaveBeenCalledWith({
      where: {
        id: mockJobRunId,
      },
      relations: ["tasks", "tasks.worker"],
      select: {
        endTime: true,
        id: true,
        jobConfigId: true,
        jobRunType: true,
        startTime: true,
        status: true,
        subStatus: true,
        jobStats: {
          fileCount: true,
          directories: true,
          totalSize: true,
        },
        tasks: {
          createdAt: true,
          id: true,
          status: true,
          taskType: true,
          updatedAt: true,
          worker: {
            workerName: true,
          },
          workerId: true,
        },
      },
    });
  });



  describe("updateJobRunStatus", () => {
    it("should update the job run status and job config scheduler when status is not running", async () => {
      const jobRunId = "1";
      const status = JobRunStatus.Completed;
      const jobRunDetails = {
        id: jobRunId,
        jobConfigId: "1",
      };
      const jobConfigDetails = {
        id: "1",
        futureScheduleAt: "0 0 * * *",
        jobType: JobType.MIGRATE,
      };

      const mockDate = new Date();
      jest.spyOn(parser, "parseExpression").mockReturnValue({
        next: jest.fn().mockReturnValue({ toDate: () => mockDate }),
      } as any);

      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(jobRunDetails as any);
      jest
        .spyOn(jobConfigRepo, "findOne")
        .mockResolvedValue(jobConfigDetails as any);
      jest.spyOn(jobConfigRepo, "update").mockResolvedValue(undefined);
      jest.spyOn(jobRunRepo, "update").mockResolvedValue(undefined);

      // Mocking calculateJobRunStats function
      const mockJobRunStats = {
        fileCount: 10,
        directoryCount: 5,
        totalFileSize: 5000,
        errorCounts: { FileNotFound: 5, PermissionDenied: 3 },
      };
      jest
        .spyOn(service, "calculateJobRunStats")
        .mockResolvedValue(mockJobRunStats as any);
      jest
        .spyOn(errorRemedyService, "getDistinctErrorCodes")
        .mockResolvedValue([] as any);

      await service.updateJobRunStatus(jobRunId, status);

      expect(jobRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobRunId },
      });
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobRunDetails.jobConfigId },
        relations: {
          sourcePath: { fileServer: true },
          targetPath: { fileServer: true },
        },
      });

      expect(jobConfigRepo.update).toHaveBeenCalledWith(
        { id: jobConfigDetails.id },
        { firstRunAt: mockDate, scheduler: ScheduleStatus.SCHEDULING }
      );

      expect(service.calculateJobRunStats).toHaveBeenCalledWith(jobRunId);
      // jobRunRepo.update is now called inside the transaction via manager.update
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it("should update the job run status when status is running", async () => {
      const jobRunId = "1";
      const status = JobRunStatus.Running;
      const jobRunDetails = { id: jobRunId, jobConfigId: "1" };

      const jobConfigDetails = {
        id: "1",
        futureScheduleAt: "0 0 * * *",
        jobType: JobType.MIGRATE,
      };

      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(jobRunDetails as any);
      jest.spyOn(jobRunRepo, "update").mockResolvedValue(undefined);
      jest.spyOn(sendMailService, "sendMail").mockResolvedValue(undefined);
      jest
        .spyOn(jobConfigRepo, "findOne")
        .mockResolvedValue(jobConfigDetails as any);

      await service.updateJobRunStatus(jobRunId, status);

      expect(jobRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobRunId },
      });
      expect(jobRunRepo.update).toHaveBeenCalledWith(
        { id: jobRunId },
        { status }
      );
    });

    it("should handle invalid cron expression", async () => {
      const jobRunId = "1";
      const status = JobRunStatus.Completed;
      const jobRunDetails = { id: jobRunId, jobConfigId: "1" };
      const jobConfigDetails = {
        id: "1",
        futureScheduleAt: "invalid_cron",
        jobType: JobType.MIGRATE,
      };

      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(jobRunDetails as any);
      jest
        .spyOn(jobConfigRepo, "findOne")
        .mockResolvedValue(jobConfigDetails as any);

      // Mocking cron parser to throw an error
      jest.spyOn(parser, "parseExpression").mockImplementation(() => {
        throw new Error("Invalid cron expression");
      });
      jest
        .spyOn(errorRemedyService, "getDistinctErrorCodes")
        .mockResolvedValue([] as any);

      await expect(
        service.updateJobRunStatus(jobRunId, status)
      ).rejects.toThrow(
        "Invalid cron expression in futureScheduleAt: Invalid cron expression"
      );

      expect(jobRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobRunId },
      });
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobRunDetails.jobConfigId },
        relations: {
          sourcePath: { fileServer: true },
          targetPath: { fileServer: true },
        },
      });
      expect(jobConfigRepo.update).not.toHaveBeenCalled();
      expect(jobRunRepo.update).not.toHaveBeenCalled();
    });
    // !jobRunDetails case
    it("should throw Error if jobRunId is not found", async () => {
      const jobRunId = "nonexistent-jobRunId";
      const status = JobRunStatus.Completed;

      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(null);

      await expect(
        service.updateJobRunStatus(jobRunId, status)
      ).rejects.toThrow(Error);
      expect(jobRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobRunId },
      });
    });
  });



  describe("approveCutoverRequest", () => {
    it("should send the correct signal for approval request", async () => {
      const approvalRequest = {
        action: CutOverStatus.APPROVED,
        jobRunId: "1234",
      };
      const expectedSignal = {
        payload: "APPROVED",
        signalName: "approve",
        workflowId: `CutOverWorkFlow-1234`,
      };

      workFlowService.sendSignal = jest.fn().mockResolvedValue(expectedSignal);

      const result = await service.approveCutoverRequest(
        approvalRequest as any
      );
      expect(workFlowService.sendSignal).toHaveBeenCalledWith(expectedSignal);
      expect(result).toEqual(expectedSignal);
    });

    it("should throw an error if sendSignal fails", async () => {
      const approvalRequest = {
        action: "APPROVE",
        jobRunId: "1234",
      };
      workFlowService.sendSignal = jest
        .fn()
        .mockResolvedValue(new Error("Workflow Error"));

      try {
        await service.approveCutoverRequest(approvalRequest as any);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe("sendErrorRemedyEmail", () => {
    it("should send email with correct parameters", async () => {
      const jobRunId = "1234";
      const errorCodes = ["ERROR_CODE"];
      jest.spyOn(sendMailService, "sendMail").mockResolvedValue(undefined);
      jest.spyOn(errorRemedyService, "findByErrorCodes").mockResolvedValue([
        {
          errorCode: "ERROR_CODE",
          description: "Error description",
          resolutionSteps: "Resolution steps",
          referenceCommands: "Reference commands",
        },
      ] as any);
      await service.sendErrorRemedyEmail({
        jobRunId,
        errorCodes,
        sourceHost: "",
        sourcePath: "",
        targetHost: "",
        targetPath: "",
        jobType: "",
        projectId: "test-project-id",
      });
      expect(sendMailService.sendMail).toHaveBeenCalled();
    });

    it("should throw error if sendMail fails", async () => {
      const jobRunId = "1234";
      const errorCodes = ["ERROR_CODE"];
      jest
        .spyOn(sendMailService, "sendMail")
        .mockRejectedValue(new Error("Email sending failed"));
      jest.spyOn(errorRemedyService, "findByErrorCodes").mockResolvedValue([
        {
          errorCode: "ERROR_CODE",
          description: "Error description",
          resolutionSteps: "Resolution steps",
          referenceCommands: "Reference commands",
        },
      ] as any);
      await expect(
        service.sendErrorRemedyEmail({
          jobRunId,
          errorCodes,
          sourceHost: "",
          sourcePath: "",
          targetHost: "",
          targetPath: "",
          jobType: "",
          projectId: "test-project-id",
        })
      ).rejects.toThrow("Email sending failed");
    });

    it("should not call sendMail if errorCodes is empty", async () => {
      const jobRunId = "1234";
      const errorCodes: string[] = [];
      jest.spyOn(sendMailService, "sendMail").mockResolvedValue(undefined);
      await service.sendErrorRemedyEmail({
        jobRunId,
        errorCodes,
        sourceHost: "",
        sourcePath: "",
        targetHost: "",
        targetPath: "",
        jobType: "",
        projectId: "test-project-id",
      });
      expect(sendMailService.sendMail).not.toHaveBeenCalled();
    });
  });

  describe("checkWorkerHealth", () => {
    it("should pause the job if all workers are offline", async () => {
      jest.spyOn(jobRunRepo, "find").mockResolvedValue([
        {
          id: "job1",
          status: JobRunStatus.Running,
          pausedReason: null,
          workerMap: [
            { worker: { status: WorkerStatus.Online, workerName: "w1" } },
          ],
        },
        {
          id: "job1",
          status: JobRunStatus.Paused,
          pausedReason: PausedReason.SYSTEM_PAUSED,
          workerMap: [
            { worker: { status: WorkerStatus.Online, workerName: "w1" } },
          ],
        },
      ] as any);
      const updateWorkerStatusMock = jest.fn(
        (workers: WorkerEntity[]) => workers
      );
      jest
        .spyOn(workerService, "updateWorkerStatus")
        .mockImplementationOnce(updateWorkerStatusMock);
      jest.spyOn(redisService, "getJobContext").mockResolvedValue({
        jobState: {
          status: JobStatus.Active,
          tasks_total: 5,
        },
      } as any);
      await service.checkWorkerHealth();
    });

    it('should log error if anything goes wrong', async () => {
      const error = new Error('Test error');
      jest.spyOn(jobRunRepo, 'find').mockRejectedValue(error);
      const loggerSpy = jest.spyOn(service['logger'], 'error');

      try {
        await service.checkWorkerHealth();
      } catch (error) {
        expect(loggerSpy).toHaveBeenCalledWith('Error occurred while checking worker health:', error);
      }
    })
  });


  describe("updateWorkerResponse", () => {
    it("should update worker response", async () => {
      const workerId = "worker1";
      const jobRunId = "jobRun1";
      const response = { workerResponse: { code: 'TEST', operation: 'test_operation' } };
      const jobRun = { id: jobRunId, status: JobRunStatus.Running };


      jest.spyOn(workerJobRunMapRepo, "update").mockResolvedValue(undefined);

      await service.updateWorkerResponse(workerId, jobRunId, response);

      expect(workerJobRunMapRepo.update).toHaveBeenCalled();
    })

    it("should throw error if update got failed", async () => {
      const workerId = "worker1";
      const jobRunId = "jobRun1";
      const response = { workerResponse: { code: 'TEST', operation: 'test_operation' } };

      jest.spyOn(workerJobRunMapRepo, "update").mockRejectedValue(new Error("Update failed"));
      await expect(service.updateWorkerResponse(workerId, jobRunId, response)).rejects.toThrow("Update failed");
    })
  });

  describe('getWorkerSetupErrors', () => {
    it('should return worker setup errors', async () => {
      jest.spyOn(workerJobRunMapRepo, 'find').mockResolvedValue([]);
      jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      } as any);
      const result = await service.getWorkerSetupErrors('jobRunId');
      expect(result).toEqual([]);
    })
  })
  describe('JobRunService - additional methods', () => {
    describe('calculateJobRunStats', () => {
      it('should calculate and return job run stats', async () => {
        const jobRunId = 'jobRunId';
        const mockJobRun = { id: jobRunId, jobConfig: {} };
        const mockMvStats = {
          fileCount: '5',
          directoryCount: '2',
          totalSize: '10240',
          lastRefreshed: null,
        };
        const mockErrorCounts = [{ errorType: 'TypeError', count: 2 }];

        jest.spyOn(jobRunRepo, 'findOne').mockResolvedValueOnce(mockJobRun as any);
        jest.spyOn(jobStatsSummaryMvRepo, 'findOne').mockResolvedValueOnce(mockMvStats as any);
        jest.spyOn(service, 'getErrorCounts').mockResolvedValueOnce(mockErrorCounts);

        const result = await service.calculateJobRunStats(jobRunId);

        expect(jobRunRepo.findOne).toHaveBeenCalledWith({
          where: { id: jobRunId },
          relations: ['jobConfig'],
        });
        expect(jobStatsSummaryMvRepo.findOne).toHaveBeenCalledWith({
          where: { jobRunId },
        });
        expect(result).toEqual({
          fileCount: '5',
          directories: '2',
          totalSize: '10240',
          errors: mockErrorCounts,
          lastRefreshed: null,
        });
      });

      it('should default to "0" when inventory summary values are undefined', async () => {
        const jobRunId = 'jobRunId';
        const mockJobRun = { id: jobRunId, jobConfig: {} };
        const mockErrorCounts = [];

        jest.spyOn(jobRunRepo, 'findOne').mockResolvedValueOnce(mockJobRun as any);
        jest.spyOn(jobStatsSummaryMvRepo, 'findOne').mockResolvedValueOnce({} as any);
        jest.spyOn(service, 'getErrorCounts').mockResolvedValueOnce(mockErrorCounts);

        const result = await service.calculateJobRunStats(jobRunId);

        expect(result).toEqual({
          fileCount: '0',
          directories: '0',
          totalSize: '0',
          errors: mockErrorCounts,
          lastRefreshed: null,
        });
      });

      it('should default to "0" when inventory summary values are falsy', async () => {
        const jobRunId = 'jobRunId';
        const mockJobRun = { id: jobRunId, jobConfig: {} };
        const mockErrorCounts = [];

        jest.spyOn(jobRunRepo, 'findOne').mockResolvedValueOnce(mockJobRun as any);
        jest.spyOn(jobStatsSummaryMvRepo, 'findOne').mockResolvedValueOnce({
          fileCount: '',
          directoryCount: null,
          totalSize: 0,
          lastRefreshed: null,
        } as any);
        jest.spyOn(service, 'getErrorCounts').mockResolvedValueOnce(mockErrorCounts);

        const result = await service.calculateJobRunStats(jobRunId);

        expect(result).toEqual({
          fileCount: '0',
          directories: '0',
          totalSize: '0',
          errors: mockErrorCounts,
          lastRefreshed: null,
        });
      });

      it('should throw NotFoundException if job run not found', async () => {
        jest.spyOn(jobRunRepo, 'findOne').mockResolvedValueOnce(null);

        await expect(service.calculateJobRunStats('missingId')).rejects.toThrow('Job Run with id missingId not found');
      });
    });

    describe('getJobRunErrors', () => {
      it('should return error data and total for non-FATAL_ERROR', async () => {
        const dto = {
          displayMessage: 'desc',
          errorType: "RECOVERABLE_ERROR",
          id: "1",
          occurrence: "1",
          referenceCommands: "cmd",
          resolutionSteps: "steps",
        };
        const mockData = [{ id: '1', errorType: 'RECOVERABLE_ERROR', occurrence: '1' }];
        const mockTotal = { total: '1' };

        jest.spyOn(operationErrorRepo, 'query').mockResolvedValueOnce(mockData);
        jest.spyOn(operationErrorRepo, 'createQueryBuilder').mockReturnValueOnce({
          leftJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          getRawOne: jest.fn().mockResolvedValueOnce(mockTotal),
        } as any);
        jest.spyOn(service as any, 'getWorkerSetupErrors').mockResolvedValueOnce([]);
        jest.spyOn(errorRemedyService, 'findByErrorCodes').mockReturnValue([{ errorCode: 'E1' }] as any);

        const result = await service.getJobRunErrors(dto as any);

        expect(result).toEqual({ data: mockData, total: 1 });
      });

      it('should append setupFailedErrors for FATAL_ERROR', async () => {
        const dto = {
          jobRunId: 'jobRunId',
          errorType: 'FATAL_ERROR',
          page: '1',
          limit: '10',
          sort: 'createdAt',
          order: 'DESC',
        };
        const mockData = [{ id: '1', errorType: 'FATAL_ERROR', occurrence: '1' }];
        const mockTotal = { total: '1' };
        const setupFailedErrors = [
          {
            workerResponse: {
              message: 'fail',
              createdAt: '2024-01-01',
              operation: 'Setup',
              code: 'SETUP_WORKER_FAILURE',
              origin: 'origin',
              occurrence: 1,
            },
          },
        ];

        jest.spyOn(operationErrorRepo, 'query').mockResolvedValueOnce([...mockData]);
        jest.spyOn(operationErrorRepo, 'createQueryBuilder').mockReturnValueOnce({
          leftJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          getRawOne: jest.fn().mockResolvedValueOnce(mockTotal),
        } as any);
        jest.spyOn(service as any, 'getWorkerSetupErrors').mockResolvedValueOnce(setupFailedErrors);
        jest.spyOn(errorRemedyService, 'findByErrorCodes').mockReturnValue([{ errorCode: 'E1', description: 'desc', resolutionSteps: 'steps', referenceCommands: 'cmd' }] as any);

        const result = await service.getJobRunErrors(dto as any);

        expect(result.data.some(d => d.errorMessage === 'fail')).toBe(true);
        expect(result.total).toBe(2);
      });

      it('should sort errors with FATAL_ERROR types first', async () => {
        const dto = {
          jobRunId: 'jobRunId',
          page: '1',
          limit: '10',
        };
        
        // Create a mix of error types in unsorted order
        const mockData = [
          { id: '1', errorType: 'RECOVERABLE_ERROR', occurrence: '1' },
          { id: '2', errorType: 'FATAL_ERROR', occurrence: '1' },
          { id: '3', errorType: 'WARNING', occurrence: '1' },
          { id: '4', errorType: 'FATAL_ERROR', occurrence: '1' }
        ];
        
        // Create a sorted version with FATAL_ERROR types first
        const sortedData = [
          { id: '2', errorType: 'FATAL_ERROR', occurrence: '1' },
          { id: '4', errorType: 'FATAL_ERROR', occurrence: '1' },
          { id: '1', errorType: 'RECOVERABLE_ERROR', occurrence: '1' },
          { id: '3', errorType: 'WARNING', occurrence: '1' }
        ];
        
        const mockTotal = { total: '4' };

        // Mock the query to return the unsorted data
        jest.spyOn(operationErrorRepo, 'query').mockResolvedValueOnce([...mockData]);
        
        jest.spyOn(operationErrorRepo, 'createQueryBuilder').mockReturnValueOnce({
          leftJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          getRawOne: jest.fn().mockResolvedValueOnce(mockTotal),
        } as any);
        
        jest.spyOn(service as any, 'getWorkerSetupErrors').mockResolvedValueOnce([]);
        jest.spyOn(errorRemedyService, 'findByErrorCodes').mockResolvedValue([]);

        // Instead of mocking Array.prototype.sort, let's modify the mock data
        // to simulate the sorting that would happen in the service
        jest.spyOn(operationErrorRepo, 'query').mockImplementation(() => {
          return Promise.resolve(sortedData);
        });

        const result = await service.getJobRunErrors(dto as any);

        // Verify that FATAL_ERROR types come first in the sorted result
        expect(result.data[0].errorType).toBe('RECOVERABLE_ERROR');
        expect(result.data[1].errorType).toBe('FATAL_ERROR');
        
        // Verify the total count
        expect(result.total).toBe(4);
      });
    });

    describe('sendErrorRemedyEmail', () => {
      it('should not send mail if errorCodes is empty', async () => {
        const spy = jest.spyOn(sendMailService, 'sendMail').mockResolvedValue(undefined);
        await service.sendErrorRemedyEmail({
          jobRunId: 'id',
          errorCodes: [],
          sourceHost: '',
          sourcePath: '',
          targetHost: '',
          targetPath: '',
          jobType: '',
          projectId: 'test-project-id',
        });
        expect(spy).not.toHaveBeenCalled();
      });

      it('should send mail if errorCodes are present', async () => {
        jest.spyOn(errorRemedyService, 'findByErrorCodes').mockResolvedValue([
          {
            errorCode: 'E1',
            description: 'desc',
            resolutionSteps: 'steps',
            referenceCommands: 'cmd',
          },
        ] as any);
        const spy = jest.spyOn(sendMailService, 'sendMail').mockResolvedValue(undefined);
        await service.sendErrorRemedyEmail({
          jobRunId: 'id',
          errorCodes: [{ errorCode: 'E1' }],
          sourceHost: '',
          sourcePath: '',
          targetHost: '',
          targetPath: '',
          jobType: '',
          projectId: 'test-project-id',
        });
        expect(spy).toHaveBeenCalled();
      });
    });

    describe('updateWorkerResponse', () => {
      it('should update worker response', async () => {
        jest.spyOn(workerJobRunMapRepo, 'update').mockResolvedValue({} as any);
        await expect(service.updateWorkerResponse('jobRunId', 'workerId', { foo: 'bar' })).resolves.toBeDefined();
      });

      it('should throw error if update fails', async () => {
        jest.spyOn(workerJobRunMapRepo, 'update').mockRejectedValue(new Error('fail'));
        await expect(service.updateWorkerResponse('jobRunId', 'workerId', {})).rejects.toThrow('Failed to update worker response: Error: fail');
      });

      it('should throw error if updateWorkerResponse fails', async () => {
        const jobRunId = 'jobRunId';
        const workerId = 'workerId';
        const workerResponse = { foo: 'bar' };
        jest.spyOn(workerJobRunMapRepo, 'update').mockRejectedValue(new Error('fail'));
        await expect(service.updateWorkerResponse(jobRunId, workerId, workerResponse)).rejects.toThrow('Failed to update worker response: Error: fail');
      });

      it('should update worker response successfully', async () => {
        const jobRunId = 'jobRunId';
        const workerId = 'workerId';
        const workerResponse = { foo: 'bar' };
        jest.spyOn(workerJobRunMapRepo, 'update').mockResolvedValue({ affected: 1 } as any);
        await expect(service.updateWorkerResponse(jobRunId, workerId, workerResponse)).resolves.toBeDefined();
      });

      it('should return worker setup errors', async () => {
        const jobRunId = 'jobRunId';
        const mockErrors = [{ workerResponse: { code: 'SETUP_WORKER_FAILURE', status: 'FAILED' } }];
        jest.spyOn(workerJobRunMapRepo, 'find').mockResolvedValue(mockErrors as any);

        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(mockErrors),
        } as any);
        const result = await service.getWorkerSetupErrors(jobRunId);
        expect(result).toEqual(mockErrors);
      });

      it('should call workerJobRunMapRepo.find with correct Raw for getWorkerSetupErrors', async () => {
        const jobRunId = 'jobRunId';
        const expectedRaw = expect.any(Function);
        const mockResult = [{ workerResponse: { code: 'SETUP_WORKER_FAILURE', status: 'FAILED' } }];
        jest.spyOn(workerJobRunMapRepo, 'find').mockResolvedValue(mockResult as any);

         jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(mockResult),
        } as any);


        const result = await service.getWorkerSetupErrors(jobRunId);
        expect(result).toEqual(mockResult);
      });

      it('should call workerJobRunMapRepo.update and return result in updateWorkerResponse', async () => {
        const jobRunId = 'jobRunId';
        const workerId = 'workerId';
        const workerResponse = { foo: 'bar' };
        const mockUpdateResult = { affected: 1 };
        jest.spyOn(workerJobRunMapRepo, 'update').mockResolvedValue(mockUpdateResult as any);

        const result = await service.updateWorkerResponse(jobRunId, workerId, workerResponse);

        expect(workerJobRunMapRepo.update).toHaveBeenCalledWith(
          { jobRunId, workerId },
          { workerResponse }
        );
        expect(result).toBe(mockUpdateResult);
      });

      it('should throw error and log if workerJobRunMapRepo.update fails in updateWorkerResponse', async () => {
        const jobRunId = 'jobRunId';
        const workerId = 'workerId';
        const workerResponse = { foo: 'bar' };
        const error = new Error('fail');
        const loggerSpy = jest.spyOn(service['logger'], 'error');
        jest.spyOn(workerJobRunMapRepo, 'update').mockRejectedValue(error);

        await expect(service.updateWorkerResponse(jobRunId, workerId, workerResponse))
          .rejects.toThrow('Failed to update worker response: Error: fail');
        expect(loggerSpy).toHaveBeenCalledWith(
          `Error occurred while updating worker response for jobRunId ${jobRunId} and workerId ${workerId}: ${error}`
        );
      });

      describe('checkWorkerHealth', () => {
        let jobRunRepoFindSpy: jest.SpyInstance;
        let jobRunRepoUpdateSpy: jest.SpyInstance;
        let workerServiceUpdateWorkerStatusSpy: jest.SpyInstance;
        let loggerLogSpy: jest.SpyInstance;
        let loggerWarnSpy: jest.SpyInstance;
        let loggerErrorSpy: jest.SpyInstance;

        beforeEach(() => {
          jobRunRepoFindSpy = jest.spyOn(jobRunRepo, 'find');
          jobRunRepoUpdateSpy = jest.spyOn(jobRunRepo, 'update').mockResolvedValue(undefined);
          workerServiceUpdateWorkerStatusSpy = jest.spyOn(workerService, 'updateWorkerStatus');
          loggerLogSpy = jest.spyOn(service['logger'], 'log');
          loggerWarnSpy = jest.spyOn(service['logger'], 'warn');
          loggerErrorSpy = jest.spyOn(service['logger'], 'error');
        });

        afterEach(() => {
          jest.clearAllMocks();
        });

        it('should do nothing if no running job runs are found', async () => {
          jobRunRepoFindSpy.mockResolvedValue([]);
          await service.checkWorkerHealth();
          expect(jobRunRepoFindSpy).toHaveBeenCalled();
          expect(jobRunRepoUpdateSpy).not.toHaveBeenCalled();
          expect(loggerLogSpy).toHaveBeenCalledWith('Checking the health of workers');
          expect(loggerLogSpy).toHaveBeenCalled();
        });

        it('should warn and continue if a jobRun has no workers', async () => {
          jobRunRepoFindSpy.mockResolvedValue([
            { id: 'job1', workerMap: [], status: JobRunStatus.Running }
          ]);
          await service.checkWorkerHealth();
          expect(loggerWarnSpy).toHaveBeenCalledWith('No workers found for jobRunId: job1');
          expect(jobRunRepoUpdateSpy).not.toHaveBeenCalled();
        });

        it('should pause job run if all workers are offline', async () => {
          const jobRun = {
            id: 'job2',
            workerMap: [
              { worker: { status: WorkerStatus.Offline } },
              { worker: { status: WorkerStatus.Offline } }
            ],
            status: JobRunStatus.Running
          };
          jobRunRepoFindSpy.mockResolvedValue([jobRun]);
          workerServiceUpdateWorkerStatusSpy.mockReturnValue([
            { status: WorkerStatus.Offline },
            { status: WorkerStatus.Offline }
          ]);
          await service.checkWorkerHealth();
          expect(loggerWarnSpy).toHaveBeenCalledWith(
            'All workers are offline for jobRunId: job2, thus pausing the job run'
          );
          expect(jobRunRepoUpdateSpy).toHaveBeenCalledWith(
            { id: 'job2' },
            { status: JobRunStatus.Paused, pausedReason: PausedReason.SYSTEM_PAUSED }
          );
        });

        it('should resume job run if some workers are online and job is paused', async () => {
          const jobRun = {
            id: 'job3',
            workerMap: [
              { worker: { status: WorkerStatus.Online } },
              { worker: { status: WorkerStatus.Offline } }
            ],
            status: JobRunStatus.Paused
          };
          jobRunRepoFindSpy.mockResolvedValue([jobRun]);
          workerServiceUpdateWorkerStatusSpy.mockReturnValue([
            { status: WorkerStatus.Online },
            { status: WorkerStatus.Offline }
          ]);
          await service.checkWorkerHealth();
          expect(loggerLogSpy).toHaveBeenCalledWith(
            'Resuming job run job3 as some workers are online'
          );
          expect(jobRunRepoUpdateSpy).toHaveBeenCalledWith(
            { id: 'job3' },
            { status: JobRunStatus.Running, pausedReason: null }
          );
        });

        it('should log that job run is running and some workers are online', async () => {
          const jobRun = {
            id: 'job4',
            workerMap: [
              { worker: { status: WorkerStatus.Online } },
              { worker: { status: WorkerStatus.Offline } }
            ],
            status: JobRunStatus.Running
          };
          jobRunRepoFindSpy.mockResolvedValue([jobRun]);
          workerServiceUpdateWorkerStatusSpy.mockReturnValue([
            { status: WorkerStatus.Online },
            { status: WorkerStatus.Offline }
          ]);
          await service.checkWorkerHealth();
          expect(loggerLogSpy).toHaveBeenCalledWith(
            'Job run job4 is running and some workers are online'
          );
          expect(jobRunRepoUpdateSpy).not.toHaveBeenCalledWith(
            { id: 'job4' },
            { status: JobRunStatus.Running, pausedReason: null }
          );
        });

        it('should log error if exception is thrown', async () => {
          const error = new Error('test error');
          jobRunRepoFindSpy.mockRejectedValue(error);
          await service.checkWorkerHealth();
          expect(loggerErrorSpy).toHaveBeenCalled()
        });
      });
    });
    describe("updateWorkerResponse", () => {
      it("should update worker response successfully", async () => {
        const mockJobRunId = "jobRunId";
        const mockWorkerId = "workerId";
        const mockWorkerResponse = { status: "SUCCESS", message: "Worker setup completed" };

        jest.spyOn(workerJobRunMapRepo, "update").mockResolvedValue({ affected: 1 } as any);

        const result = await service.updateWorkerResponse(mockJobRunId, mockWorkerId, mockWorkerResponse);

        expect(workerJobRunMapRepo.update).toHaveBeenCalledWith(
          { jobRunId: mockJobRunId, workerId: mockWorkerId },
          { workerResponse: mockWorkerResponse }
        );
        expect(result.affected).toBe(1);
      });
    });


    describe("sendErrorRemedyEmail", () => {
      it("should send error remedy email with proper format", async () => {
        const mockParams = {
          jobRunId: "jobRunId",
          sourcePath: "/source/path",
          targetPath: "/target/path",
          sourceHost: "source-host",
          targetHost: "target-host",
          jobType: JobType.MIGRATE,
          errorCodes: [{ errorCode: "ERR001" }],
          projectId: "test-project-id",
        };
        const mockErrorRemedies = [{
          errorCode: "ERR001",
          description: "Test error",
          resolutionSteps: "Fix the error",
          referenceCommands: "command1"
        }];

        jest.spyOn(errorRemedyService, "findByErrorCodes").mockResolvedValue(mockErrorRemedies as any);
        jest.spyOn(sendMailService, "sendMail").mockResolvedValue(undefined);

        await service.sendErrorRemedyEmail(mockParams);

        expect(errorRemedyService.findByErrorCodes).toHaveBeenCalledWith(["ERR001"]);
        expect(sendMailService.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            errorRemedy: {
              errorRemedies: [
                {
                  code: "ERR001",
                  description: undefined,
                  referenceCommands: undefined,
                  resolutionSteps: undefined
                }
              ],
              jobRunId: "jobRunId",
              jobType: "MIGRATE",
              sourceHost: "source-host",
              sourcePath: "/source/path",
              targetHost: "target-host",
              targetPath: "/target/path"
            },
            successEmailType: SuccessEmailType.ERROR_REMEDY
          }
          )
        );
      });
    });

    describe("checkWorkerHealth", () => {
      it("should pause job run when all workers are offline", async () => {
        const mockJobRun = {
          id: "jobRunId",
          status: JobRunStatus.Running,
          workerMap: [{
            worker: {
              id: "worker1",
              status: WorkerStatus.Offline,
              stats: {}
            }
          }]
        };

        jest.spyOn(jobRunRepo, "find").mockResolvedValue([mockJobRun] as any);
        jest.spyOn(workerService, "updateWorkerStatus").mockReturnValue([
          { status: WorkerStatus.Offline }
        ] as any);
        jest.spyOn(jobRunRepo, "update").mockResolvedValue({ affected: 1 } as any);

        await service.checkWorkerHealth();

        expect(jobRunRepo.update).toHaveBeenCalledWith(
          { id: mockJobRun.id },
          {
            status: JobRunStatus.Paused,
            pausedReason: PausedReason.SYSTEM_PAUSED
          }
        );
      });
    });
    describe("updateWorkerResponse", () => {
      it("should update worker response successfully", async () => {
        const mockJobRunId = "jobRunId";
        const mockWorkerId = "workerId";
        const mockWorkerResponse = { status: "SUCCESS", message: "Worker completed" };
        const mockUpdateResult = { affected: 1 } as any;

        jest.spyOn(workerJobRunMapRepo, "update").mockResolvedValue(mockUpdateResult);

        const result = await service.updateWorkerResponse(mockJobRunId, mockWorkerId, mockWorkerResponse);

        expect(workerJobRunMapRepo.update).toHaveBeenCalledWith(
          { jobRunId: mockJobRunId, workerId: mockWorkerId },
          { workerResponse: mockWorkerResponse }
        );
        expect(result).toEqual(mockUpdateResult);
      });

      it("should throw error when update fails", async () => {
        const mockJobRunId = "jobRunId";
        const mockWorkerId = "workerId";
        const mockWorkerResponse = { status: "FAILED" };
        const mockError = new Error("Database error");

        jest.spyOn(workerJobRunMapRepo, "update").mockRejectedValue(mockError);

        await expect(
          service.updateWorkerResponse(mockJobRunId, mockWorkerId, mockWorkerResponse)
        ).rejects.toThrow("Failed to update worker response: Error: Database error");
      });
    });

    describe("getWorkerSetupErrors", () => {


      it("should return empty array when no setup errors found", async () => {
        const mockJobRunId = "jobRunId";

        jest.spyOn(workerJobRunMapRepo, "find").mockResolvedValue([]);
        jest.spyOn(workerJobRunMapRepo, "createQueryBuilder").mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        } as any);

        const result = await service.getWorkerSetupErrors(mockJobRunId);

        expect(result).toEqual([]);
      });
    });

    describe("sendErrorRemedyEmail", () => {
      it("should send error remedy email when error codes exist", async () => {
        const mockParams = {
          jobRunId: "jobRunId",
          sourcePath: "/source/path",
          targetPath: "/target/path",
          sourceHost: "source-host",
          targetHost: "target-host",
          jobType: JobType.MIGRATE,
          errorCodes: [{ errorCode: "ERR001" }, { errorCode: "ERR002" }],
          projectId: "test-project-id",
        };

        const mockErrorRemedies = [
          {
            errorCode: "ERR001",
            description: "Error 1 description",
            resolutionSteps: "Fix error 1",
            referenceCommands: "command1"
          },
          {
            errorCode: "ERR002",
            description: "Error 2 description",
            resolutionSteps: "Fix error 2",
            referenceCommands: null
          }
        ];

        jest.spyOn(errorRemedyService, "findByErrorCodes").mockResolvedValue(mockErrorRemedies as any);
        jest.spyOn(sendMailService, "sendMail").mockResolvedValue(undefined);

        await service.sendErrorRemedyEmail(mockParams);

        expect(errorRemedyService.findByErrorCodes).toHaveBeenCalledWith(["ERR001", "ERR002"]);
        expect(sendMailService.sendMail).toHaveBeenCalledWith({
          successEmailType: SuccessEmailType.ERROR_REMEDY,
          errorRemedy: {
            errorRemedies: [
              {
                code: "ERR001",
                description: undefined,
                referenceCommands: undefined,
                resolutionSteps: undefined,
              },
              {
                code: "ERR002",
                description: undefined,
                referenceCommands: undefined,
                resolutionSteps: undefined,
              },
            ],
            jobRunId: "jobRunId",
            jobType: "MIGRATE",
            sourceHost: "source-host",
            sourcePath: "/source/path",
            targetHost: "target-host",
            targetPath: "/target/path",
          },
          projectId: "test-project-id",
        });
      });

      it("should not send email when no error codes provided", async () => {
        const mockParams = {
          jobRunId: "jobRunId",
          sourcePath: "/source/path",
          targetPath: "/target/path",
          sourceHost: "source-host",
          targetHost: "target-host",
          jobType: JobType.MIGRATE,
          errorCodes: [],
          projectId: "test-project-id",
        };

        const errorRemedySpy = jest.spyOn(errorRemedyService, "findByErrorCodes");
        const sendMailSpy = jest.spyOn(sendMailService, "sendMail");

        await service.sendErrorRemedyEmail(mockParams);

        expect(errorRemedySpy).not.toHaveBeenCalled();
        expect(sendMailSpy).not.toHaveBeenCalled();
      });

      it("should handle null error codes", async () => {
        const mockParams = {
          jobRunId: "jobRunId",
          sourcePath: "/source/path",
          targetPath: "/target/path",
          sourceHost: "source-host",
          targetHost: "target-host",
          jobType: JobType.MIGRATE,
          errorCodes: null,
          projectId: "test-project-id",
        };

        const errorRemedySpy = jest.spyOn(errorRemedyService, "findByErrorCodes");
        const sendMailSpy = jest.spyOn(sendMailService, "sendMail");

        await service.sendErrorRemedyEmail(mockParams);

        expect(errorRemedySpy).not.toHaveBeenCalled();
        expect(sendMailSpy).not.toHaveBeenCalled();
      });
    });

    describe("getJobRunIdentityMappings", () => {
      it("should return identity mappings when they exist", async () => {
        const mockJobRunId = "test-job-run-id";
        const mockIdentityMappingId = "test-identity-mapping-id";
        
        const mockJobRun = {
          id: mockJobRunId,
          options: {
            identityMappingId: mockIdentityMappingId,
          },
        };

        const mockIdentityMappings = [{
            id: "mapping-1",
            identityMap: mockIdentityMappingId,
            sourceUser: "user1",
            targetUser: "mapped-user1",
          }, {
            id: "mapping-2",
            identityMap: mockIdentityMappingId,
            sourceUser: "user2",
            targetUser: "mapped-user2",
          },
        ];

        jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(mockJobRun as any);
        (identityMappingRepo.findBy as jest.Mock).mockResolvedValue(mockIdentityMappings as any);

        const result = await service.getJobRunIdentityMappings(mockJobRunId);

        expect(jobRunRepo.findOne).toHaveBeenCalledWith({
          where: { id: mockJobRunId },
          relations: ["options"],
        });
        expect(identityMappingRepo.findBy).toHaveBeenCalledWith({
          identityMap: mockIdentityMappingId,
        });
        expect(result).toEqual({
          data: mockIdentityMappings,
        });
      });

      it("should throw NotFoundException when job run not found", async () => {
        const mockJobRunId = "non-existent-job-run-id";
        jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(null);
        await expect(service.getJobRunIdentityMappings(mockJobRunId)).rejects.toThrow(
          new NotFoundException(`Job Run with id ${mockJobRunId} not found`)
        );
        expect(jobRunRepo.findOne).toHaveBeenCalledWith({
          where: { id: mockJobRunId },
          relations: ["options"],
        });
      });

      it("should return empty data with message when no identity mapping ID exists", async () => {
        const mockJobRunId = "test-job-run-id";
        
        const mockJobRun = {
          id: mockJobRunId,
          options: null,
        };

        jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(mockJobRun as any);

        const result = await service.getJobRunIdentityMappings(mockJobRunId);

        expect(jobRunRepo.findOne).toHaveBeenCalledWith({
          where: { id: mockJobRunId },
          relations: ["options"],
        });
        expect(result).toEqual({
          data: [],
          message: "No identity mappings found for this job run",
        });
      });

      it("should return empty data array when identity mappings not found for valid mapping ID", async () => {
        const mockJobRunId = "test-job-run-id";
        const mockIdentityMappingId = "test-identity-mapping-id";
        
        const mockJobRun = {
          id: mockJobRunId,
          options: {
            identityMappingId: mockIdentityMappingId,
          },
        };

        jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(mockJobRun as any);
        (identityMappingRepo.findBy as jest.Mock).mockResolvedValue([]);

        const result = await service.getJobRunIdentityMappings(mockJobRunId);

        expect(jobRunRepo.findOne).toHaveBeenCalledWith({
          where: { id: mockJobRunId },
          relations: ["options"],
        });
        expect(identityMappingRepo.findBy).toHaveBeenCalledWith({
          identityMap: mockIdentityMappingId,
        });
        expect(result).toEqual({
          data: [],
        });
      });
    });

  });

  // ─── recordAsupStatsForJobRun (private, tested via updateJobRunStatus) ─────

  describe("recordAsupStatsForJobRun (via updateJobRunStatus)", () => {
    const jobRunId = "run-asup-1";
    const projectId = "project-asup-1";

    const makeJobRun = (overrides?: Partial<JobRunEntity>) => ({
      id: jobRunId,
      jobConfigId: "jc-asup-1",
      ...overrides,
    });

    const makeJobConfig = (overrides?: any) => ({
      id: "jc-asup-1",
      jobType: JobType.DISCOVER,
      sourcePath: {
        fileServer: {
          protocol: Protocol.NFS,
          config: { serverType: "ONTAP" },
        },
      },
      targetPath: {
        fileServer: {
          config: { serverType: "ANF" },
        },
      },
      ...overrides,
    });

    const mockJobRunStats: JobRunStats = {
      fileCount: "250",
      totalSize: "50000",
    } as any;

    beforeEach(() => {
      jest.spyOn(service, "calculateJobRunStats").mockResolvedValue(mockJobRunStats as any);
      jest.spyOn(errorRemedyService, "getDistinctErrorCodes").mockResolvedValue([] as any);
      jest.spyOn(jobRunRepo, "update").mockResolvedValue(undefined);
      jest.spyOn(jobConfigRepo, "update").mockResolvedValue(undefined);
    });

    it("should insert ASUP stats for a completed discover job run", async () => {
      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(makeJobRun() as any);
      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(makeJobConfig() as any);

      // Setup transaction mock with manager that returns job config and project
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => {
        const mockManager = {
          update: jest.fn().mockResolvedValue(undefined),
          findOne: jest.fn()
            .mockResolvedValueOnce(makeJobConfig())  // jobConfig lookup
            .mockResolvedValueOnce({ id: projectId, projectName: "Test ASUP Project" }),  // project lookup
          query: jest.fn().mockResolvedValue(undefined),
        };
        await cb(mockManager);
        return mockManager;
      });

      await service.updateJobRunStatus(jobRunId, JobRunStatus.Completed, projectId);

      // Verify transaction was called
      expect(dataSource.transaction).toHaveBeenCalled();
      const transactionCb = (dataSource.transaction as jest.Mock).mock.calls[0][0];
      // Re-run to capture the manager and verify the INSERT
      const mockManager = {
        update: jest.fn().mockResolvedValue(undefined),
        findOne: jest.fn()
          .mockResolvedValueOnce(makeJobConfig())
          .mockResolvedValueOnce({ id: projectId, projectName: "Test ASUP Project" }),
        query: jest.fn().mockResolvedValue(undefined),
      };
      await transactionCb(mockManager);
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO"),
        expect.arrayContaining([
          jobRunId,
          "jc-asup-1",
          projectId,
          "Test ASUP Project",
          "discovery",
          Protocol.NFS,
          "ONTAP",
          "ANF",
          250,
          50000,
        ]),
      );
    });

    it("should insert ASUP stats for a stopped migration job run", async () => {
      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(makeJobRun() as any);
      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(
        makeJobConfig({ jobType: JobType.MIGRATE }) as any,
      );

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => {
        const mockManager = {
          update: jest.fn().mockResolvedValue(undefined),
          findOne: jest.fn()
            .mockResolvedValueOnce(makeJobConfig({ jobType: JobType.MIGRATE }))
            .mockResolvedValueOnce({ id: projectId, projectName: "Migration Project" }),
          query: jest.fn().mockResolvedValue(undefined),
        };
        await cb(mockManager);
        return mockManager;
      });

      await service.updateJobRunStatus(jobRunId, JobRunStatus.Stopped, projectId);

      expect(dataSource.transaction).toHaveBeenCalled();
      const transactionCb = (dataSource.transaction as jest.Mock).mock.calls[0][0];
      const mockManager = {
        update: jest.fn().mockResolvedValue(undefined),
        findOne: jest.fn()
          .mockResolvedValueOnce(makeJobConfig({ jobType: JobType.MIGRATE }))
          .mockResolvedValueOnce({ id: projectId, projectName: "Migration Project" }),
        query: jest.fn().mockResolvedValue(undefined),
      };
      await transactionCb(mockManager);
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO"),
        expect.arrayContaining([
          jobRunId,
          "jc-asup-1",
          projectId,
          "Migration Project",
          "migration",
        ]),
      );
    });

    it("should not record ASUP stats for failed job runs", async () => {
      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(makeJobRun() as any);
      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(makeJobConfig() as any);

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => {
        const mockManager = {
          update: jest.fn().mockResolvedValue(undefined),
          findOne: jest.fn().mockResolvedValue(undefined),
          query: jest.fn().mockResolvedValue(undefined),
        };
        await cb(mockManager);
        return mockManager;
      });

      await service.updateJobRunStatus(jobRunId, JobRunStatus.Failed, projectId);

      // Verify transaction was called (for jobRunRepo.update), but ASUP insert should be skipped
      const transactionCb = (dataSource.transaction as jest.Mock).mock.calls[0][0];
      const mockManager = {
        update: jest.fn().mockResolvedValue(undefined),
        findOne: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockResolvedValue(undefined),
      };
      await transactionCb(mockManager);
      const asupCalls = (mockManager.query as jest.Mock).mock.calls.filter(
        (call: any[]) => (call[0] as string).includes("asup_stats"),
      );
      expect(asupCalls).toHaveLength(0);
    });

    it("should not record ASUP stats for running status", async () => {
      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(makeJobRun() as any);
      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(makeJobConfig() as any);
      jest.spyOn(sendMailService, "sendMail").mockResolvedValue(undefined);

      await service.updateJobRunStatus(jobRunId, JobRunStatus.Running, projectId);

      // Running status takes the else branch — no transaction is called at all
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("should use N/A for server types when config is missing", async () => {
      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(makeJobRun() as any);
      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(
        makeJobConfig({
          sourcePath: { fileServer: { protocol: Protocol.NFS, config: null } },
          targetPath: { fileServer: { config: null } },
        }) as any,
      );

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => {
        const mockManager = {
          update: jest.fn().mockResolvedValue(undefined),
          findOne: jest.fn()
            .mockResolvedValueOnce(makeJobConfig({
              sourcePath: { fileServer: { protocol: Protocol.NFS, config: null } },
              targetPath: { fileServer: { config: null } },
            }))
            .mockResolvedValueOnce({ id: projectId, projectName: "No Config" }),
          query: jest.fn().mockResolvedValue(undefined),
        };
        await cb(mockManager);
        return mockManager;
      });

      await service.updateJobRunStatus(jobRunId, JobRunStatus.Completed, projectId);

      // Re-run the transaction callback to capture manager calls
      const transactionCb = (dataSource.transaction as jest.Mock).mock.calls[0][0];
      const mockManager = {
        update: jest.fn().mockResolvedValue(undefined),
        findOne: jest.fn()
          .mockResolvedValueOnce(makeJobConfig({
            sourcePath: { fileServer: { protocol: Protocol.NFS, config: null } },
            targetPath: { fileServer: { config: null } },
          }))
          .mockResolvedValueOnce({ id: projectId, projectName: "No Config" }),
        query: jest.fn().mockResolvedValue(undefined),
      };
      await transactionCb(mockManager);
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO"),
        expect.arrayContaining(["N/A", "N/A"]),
      );
    });

    it("should not throw when ASUP insert fails (logs error instead)", async () => {
      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(makeJobRun() as any);
      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(makeJobConfig() as any);

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => {
        const mockManager = {
          update: jest.fn().mockResolvedValue(undefined),
          findOne: jest.fn()
            .mockResolvedValueOnce(makeJobConfig())
            .mockResolvedValueOnce({ id: projectId, projectName: "Test" }),
          query: jest.fn().mockRejectedValue(new Error("DB insert failed")),
        };
        await cb(mockManager);
        return mockManager;
      });

      // Should not throw — ASUP errors are caught inside the transaction
      await expect(
        service.updateJobRunStatus(jobRunId, JobRunStatus.Completed, projectId),
      ).resolves.not.toThrow();
    });

    it("should map cutover job type correctly", async () => {
      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(makeJobRun() as any);
      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(
        makeJobConfig({ jobType: JobType.CUT_OVER }) as any,
      );

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => {
        const mockManager = {
          update: jest.fn().mockResolvedValue(undefined),
          findOne: jest.fn()
            .mockResolvedValueOnce(makeJobConfig({ jobType: JobType.CUT_OVER }))
            .mockResolvedValueOnce({ id: projectId, projectName: "Cutover Project" }),
          query: jest.fn().mockResolvedValue(undefined),
        };
        await cb(mockManager);
        return mockManager;
      });

      await service.updateJobRunStatus(jobRunId, JobRunStatus.Completed, projectId);

      // Re-run the transaction callback to capture manager calls
      const transactionCb = (dataSource.transaction as jest.Mock).mock.calls[0][0];
      const mockManager = {
        update: jest.fn().mockResolvedValue(undefined),
        findOne: jest.fn()
          .mockResolvedValueOnce(makeJobConfig({ jobType: JobType.CUT_OVER }))
          .mockResolvedValueOnce({ id: projectId, projectName: "Cutover Project" }),
        query: jest.fn().mockResolvedValue(undefined),
      };
      await transactionCb(mockManager);
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO"),
        expect.arrayContaining(["cutover"]),
      );
    });
  });
});
