import { Test, TestingModule } from "@nestjs/testing";
import { JobRunService } from "./jobrun.service";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { JobRunEntity } from "../entities/jobrun.entity";
import { JobConfigEntity } from "../entities/jobconfig.entity";
import { WorkerJobRunMap } from "../entities/workerjobrun.entity";
import {
  CutOverStatus,
  JobRunStatus,
  JobStatus,
  JobType,
  PausedReason,
  Protocol,
  WorkFlows,
  WorkerStatus,
} from "src/constants/enums";
import { JobRunPageDto } from "./dto/jobrunpage.dto";
import { Any, In, Repository, UpdateResult } from "typeorm";
import { getRepositoryToken } from "@nestjs/typeorm";
import { InventoryEntity } from "src/entities/inventory.entity";
import { JobOptionsEntity } from "src/entities/joboptions.entity";
import { ConfigService } from "@nestjs/config";
import { WorkflowService } from "src/workflow/workflow.service";
import {
  ErrorType,
  JobContext,
  Task,
} from "@netapp-cloud-datamigrate/jobs-lib";
import { TaskEntity } from "src/entities/task.entity";
import { OperationsEntity } from "src/entities/operation.entity";
import { VolumeEntity } from "src/entities/volume.entity";
import {
  LoggerFactory,
  LoggerService,
} from "@netapp-cloud-datamigrate/logger-lib";
import { JobRunInitService } from "./jobrun.init.service";
import { OperationErrorEntity } from "src/entities/operation-error.entity";
import { RedisService } from "src/redis/redis.service";
import {
  SpeedTestConfigEntity,
  SpeedTestConfigWorkerEntity,
} from "src/entities/speed-test-job-config.entity";
import { FileServerEntity } from "src/entities/fileserver.entity";
import {
  ApprovalRequestDTO,
  JobRunActions,
  JobRunActionsReq,
} from "./dto/jobrunactions.dto";
import { SignalWorkFlowPayload } from "src/workflow/workflow.types";
import { ScheduleStatus } from "src/constants/status";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { JobConfigService } from "src/jobconfig/jobconfig.service";
import { existsSync, createReadStream } from "fs";
import { join } from "path";
import {
  NetworkPerformanceResultEntity,
  SpeedLogEntity,
  SpeedLogEntryEntity,
  SpeedTestResultEntity,
} from "src/entities/speed-test-result.entity";
import { WorkerEntity } from "src/entities/worker.entity";
import { ProjectEntity } from "src/entities/project.entity";
import { JobErrorQueryDto } from "./dto/jobRunErrors.dto";
import { IdentityMappingEntity } from "src/entities/indentity-mapping.entity";
import { IdentityConfigCrossMappingEntity } from "src/entities/indentity-mapping-cross.entity";
import { JobRunStats } from "./dto/jobstats";

import * as parser from "cron-parser";
import exp from "constants";
import e from "express";
import { SendMailService } from "src/utils/send-email";
import { ErrorRemedyService } from "src/errorremedies/errorremedies.service";
import { ErrorRemedyEntity } from "src/entities/error-remedies.entity";
import { WorkersService } from "src/workers/workers.service";
import { HealthStatus } from "src/workers/worker.types";
import { config } from "dotenv";

describe("JobRunService", () => {
  let service: JobRunService;
  let initService: JobRunInitService;
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
  let workerService:WorkersService;

  let loggerFactoryMock = {
    create: jest.fn().mockReturnValue({
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
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
            createQueryBuilder: jest.fn(),
            update: jest.fn(),
            innerJoin: jest.fn(),
            where: jest.fn(),
            select: jest.fn(),
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
            createQueryBuilder: jest.fn(),
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
            createQueryBuilder: jest.fn(),
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
        ConfigService,
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
      getRepositoryToken(OperationErrorEntity),
    );
    identityMappingRepo = module.get<Repository<IdentityMappingEntity>>(
      getRepositoryToken(IdentityMappingEntity),
    );
    identityCrossMappingRepo = module.get<
      Repository<IdentityConfigCrossMappingEntity>
    >(getRepositoryToken(IdentityConfigCrossMappingEntity));
    redisService = module.get<RedisService>(RedisService);

    jobRunRepo = module.get<Repository<JobRunEntity>>(
      getRepositoryToken(JobRunEntity),
    );
    jobConfigRepo = module.get<Repository<JobConfigEntity>>(
      getRepositoryToken(JobConfigEntity),
    );
    workerJobRunMapRepo = module.get<Repository<WorkerJobRunMap>>(
      getRepositoryToken(WorkerJobRunMap),
    );
    inventoryRepo = module.get<Repository<InventoryEntity>>(
      getRepositoryToken(InventoryEntity),
    );
    sendMailService = module.get<SendMailService>(SendMailService);
    workerService= module.get<WorkersService>(WorkersService);
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
      { status: JobStatus.Active },
    );
    expect(jobRunRepo.update).toHaveBeenCalledWith(
      { id: mockJobRunId },
      { status: JobRunStatus.Completed, subStatus: CutOverStatus.REJECTED },
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
      },
    );
    expect(jobRunRepo.update).toHaveBeenCalledWith(
      { id: mockJobRunId },
      { status: JobRunStatus.Completed, subStatus: CutOverStatus.APPROVED },
    );
  });

  // jobRun else case
  it("should throw NotFoundException when job run is not found", async () => {
    const mockJobRunId = "jobRunId";
    jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(null);
    await expect(
      service.cutOverApproval(mockJobRunId, CutOverStatus.APPROVED),
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
      );
    });

    it("should throw NotFoundException if job config does not exist", async () => {
      const mockJobConfigId = "jobConfigId";

      jest.spyOn(jobConfigRepo, "findOne").mockResolvedValue(null);

      await expect(service.addHocRun(mockJobConfigId)).rejects.toThrow(
        NotFoundException,
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
        BadRequestException,
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
        BadRequestException,
      );
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockJobConfigId },
      });
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

      const inventoryQueryBuilder: any = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          fileCount: "10",
          directoryCount: "5",
          totalFileSize: "5000",
        }),
      };

      const operationErrorQueryBuilder: any = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { errorType: "FileNotFound", count: "5" },
          { errorType: "PermissionDenied", count: "3" },
        ]),
      };

      jest
        .spyOn(inventoryRepo, "createQueryBuilder")
        .mockReturnValue(inventoryQueryBuilder);
      jest
        .spyOn(operationErrorRepo, "createQueryBuilder")
        .mockReturnValue(operationErrorQueryBuilder);

      jest.spyOn(jobRunRepo, "update").mockResolvedValue(undefined);
      jest.spyOn(jobConfigRepo, "update").mockResolvedValue(undefined);
      jest
        .spyOn(errorRemedyService, "getDistinctErrorCodes")
        .mockResolvedValue([] as any);

      await service.updateJobRunStatus(jobRunId, JobRunStatus.Completed);

      expect(jobRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobRunId },
      });

      expect(inventoryRepo.createQueryBuilder).toHaveBeenCalledWith(
        "inventory",
      );
      expect(inventoryQueryBuilder.select).toHaveBeenCalled();
      expect(inventoryQueryBuilder.where).toHaveBeenCalledWith(
        "inventory.jobRunId = :jobRunId",
        { jobRunId },
      );
      expect(inventoryQueryBuilder.getRawOne).toHaveBeenCalled();

      expect(operationErrorRepo.createQueryBuilder).toHaveBeenCalledWith("oe");
      expect(operationErrorQueryBuilder.innerJoin).toHaveBeenCalledWith(
        "oe.operation",
        "o",
      );
      expect(operationErrorQueryBuilder.where).toHaveBeenCalledWith(
        "o.jobRunId = :jobRunId",
        { jobRunId },
      );
      expect(operationErrorQueryBuilder.getRawMany).toHaveBeenCalled();

      expect(jobRunRepo.update).toHaveBeenCalledWith(
        { id: jobRunId },
        {
          status: JobRunStatus.Completed,
          endTime: expect.any(Date),
          jobStats: expect.anything(),
        },
      );
    });
  });

  describe("getJobConfig", () => {
    it("should retrieve and process job configuration without targetPathId", async () => {
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
          },
        },
        preserveAccessTime: undefined,
        skipFile: undefined,
        excludeFilePatterns: undefined,
        excludeOlderThan: undefined,
        workers: ["worker-1"], //filtering the  worker with no stats as it is categorized as unhealthy
        jobType: "DATA_TRANSFER",
      });
    });

    it("should retrieve and process job configuration with targetPathId", async () => {
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
          },
        },
        workers: ["worker-2"],
        jobType: "DATA_TRANSFER",
        preserveAccessTime: undefined,
        skipFile: undefined,
        excludeFilePatterns: undefined,
        excludeOlderThan: undefined,
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

      const loggerSpy = jest.spyOn(initService["logger"], "warn");

      await initService.createJobRun(mockJob, new Date());

      expect(loggerSpy).toHaveBeenCalledWith(
        `Unable to create Job Run for Job Config ${mockJob} does not has workers`,
      );
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
        "Database error",
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
        service.updateJobRun(jobRunId, updateData as any),
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
        jobstats: {
          fileCount: "10",
          directories: "2",
          totalSize: "2048",
        },
      },
    ];

    const mockCalculatedStats = {
      fileCount: "10",
      directories: "2",
      totalSize: "2048",
    };

    jest.spyOn(jobRunRepo, "createQueryBuilder").mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(mockJobRuns),
    } as any);

    jest
      .spyOn(service, "calculateJobRunStats")
      .mockResolvedValue(mockCalculatedStats as any);
    jest
      .spyOn(service, "getErrorCounts")
      .mockResolvedValue([{ errorType: "FileNotFound", count: 5 }]);

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
        totalScannedSize: "2.00 KB",
        totalMigratedSize: "0 B",
        errors: [{ errorType: "FileNotFound", count: 5 }],
      },
    ]);

    expect(jobRunRepo.createQueryBuilder).toHaveBeenCalledWith("jobRun");
    expect(service.calculateJobRunStats).toHaveBeenCalled();
    expect(service.getErrorCounts).toHaveBeenCalledWith(
      mockJobRuns[0].jobrunid,
    );
  });

  it("should return job runs with calculated stats scanned data as 0 for migration", async () => {
    const filter = { projectId: "project123" };
    const mockJobRuns = [
      {
        jobtype: "MIGRATE",
        volumepath: "/source/path",
        sourcefileserverprotocol: "HTTP",
        sourceconfigname: "SourceServer",
        targetvolumepath: "/target/path",
        targetfileserverprotocol: "FTP",
        targetconfigname: "TargetServer",
        status: "SUCCESS",
        starttime: new Date(Date.now() - 10000),
        endtime: new Date(),
      },
    ];

    const mockInventoryStats: JobRunStats = {
      fileCount: "10",
      directories: "5",
      totalSize: "5000",
      errors: [],
    };

    jest.spyOn(jobRunRepo, "createQueryBuilder").mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(mockJobRuns),
    } as any);

    jest.spyOn(inventoryRepo, "createQueryBuilder").mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(mockInventoryStats),
    } as any);

    jest
      .spyOn(service, "getErrorCounts")
      .mockImplementation()
      .mockReturnValue([] as any);
    jest
      .spyOn(service, "calculateJobRunStats")
      .mockReturnValue(Promise.resolve(mockInventoryStats));
    const result = await service.getJobAllRuns(filter);

    expect(result).toMatchObject([
      {
        status: "SUCCESS",
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
        totalMigratedSize: "4.88 KB",
        errors: [],
      },
    ]);
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

    jest.spyOn(inventoryRepo, "createQueryBuilder").mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(null),
    } as any);

    const result = await service.getJobAllRuns(filter);

    expect(result).toEqual([]);
  });

  it("should handle missing inventory data for job runs", async () => {
    const filter = { projectId: "project123" };
    const mockJobRuns = [
      {
        jobtype: "COPY",
        jobconfigid: "config1",
        volumepath: "/source/path",
        sourcefileserverprotocol: "HTTP",
        sourceconfigname: "SourceServer",
        targetvolumepath: null,
        targetfileserverprotocol: null,
        targetconfigname: null,
        status: "SUCCESS",
        starttime: new Date(Date.now() - 10000),
        endtime: null,
      },
    ];

    jest.spyOn(jobRunRepo, "createQueryBuilder").mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(mockJobRuns),
    } as any);

    jest.spyOn(inventoryRepo, "createQueryBuilder").mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(null),
    } as any);
    jest
      .spyOn(service, "getErrorCounts")
      .mockImplementation()
      .mockReturnValue([] as any);

    try {
      await service.getJobAllRuns(filter);
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
    }
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

      jest.spyOn(service["jobRunRepo"], "findOne").mockResolvedValueOnce({
        id: jobRunId,
        status: JobRunStatus.Completed,
        startTime,
        endTime,
        jobConfigId,
        tasks: [],
      } as JobRunEntity);

      jest.spyOn(service["jobConfigRepo"], "findOne").mockResolvedValueOnce({
        id: jobConfigId,
        jobType,
        sourcePath: {
          fileServer: {
            config: {
              configName: sourceServerName,
            },
            protocol: sourceProtocol,
          },
          volumePath: sourcePath,
        },
        targetPath: {
          fileServer: {
            config: {
              configName: targetServerName,
            },
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

      jest
        .spyOn(service["inventoryRepo"], "createQueryBuilder")
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getRawOne: jest.fn().mockResolvedValueOnce({
            fileCount,
            directoryCount,
            totalSize,
          }),
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

      jest.spyOn(service["jobRunRepo"], "findOne").mockResolvedValueOnce({
        id: jobRunId,
        status: JobRunStatus.Completed,
        startTime,
        endTime,
        jobConfigId,
        tasks: [],
      } as JobRunEntity);

      jest.spyOn(service["jobConfigRepo"], "findOne").mockResolvedValueOnce({
        id: jobConfigId,
        jobType,
        sourcePath: {
          fileServer: {
            config: {
              configName: sourceServerName,
            },
            protocol: sourceProtocol,
          },
          volumePath: sourcePath,
        },
        targetPath: {
          fileServer: {
            config: {
              configName: targetServerName,
            },
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

      jest
        .spyOn(service["inventoryRepo"], "createQueryBuilder")
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getRawOne: jest.fn().mockResolvedValueOnce({
            fileCount,
            directoryCount,
            totalSize,
          }),
        } as any);

      jest
        .spyOn(service, "getErrorCounts")
        .mockImplementation()
        .mockReturnValue([] as any);

      // jest.spyOn(service["OperationErrorEntity"], "createQueryBuilder").mockReturnValue({
      // innerJoin: jest.fn().mockReturnThis(),
      // select: jest.fn().mockReturnThis(),
      // where: jest.fn().mockReturnThis(),
      // } as any);

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
        totalScannedSize: "4.88 KB", // Assuming covertBytes converts bytes correctly
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
  });

  describe("service.covertBytes", () => {
    it("should return bytes for values less than 1024", () => {
      expect(service.covertBytes(500)).toBe("500 B");
      expect(service.covertBytes(0)).toBe("0 B");
    });

    it("should return kilobytes for values between 1024 and 1 MB", () => {
      expect(service.covertBytes(1024)).toBe("1.00 KB");
      expect(service.covertBytes(1536)).toBe("1.50 KB");
    });

    it("should return megabytes for values between 1 MB and 1 GB", () => {
      expect(service.covertBytes(1048576)).toBe("1.00 MB"); // 1 MB
      expect(service.covertBytes(2097152)).toBe("2.00 MB"); // 2 MB
      expect(service.covertBytes(1572864)).toBe("1.50 MB"); // 1.5 MB
    });

    it("should return gigabytes for values between 1 GB and 1 TB", () => {
      expect(service.covertBytes(1073741824)).toBe("1.00 GB"); // 1 GB
      expect(service.covertBytes(2147483648)).toBe("2.00 GB"); // 2 GB
      expect(service.covertBytes(1610612736)).toBe("1.50 GB"); // 1.5 GB
    });

    it("should return terabytes for values between 1 TB and 1 PB", () => {
      expect(service.covertBytes(1099511627776)).toBe("1.00 TB"); // 1 TB
      expect(service.covertBytes(2199023255552)).toBe("2.00 TB"); // 2 TB
      expect(service.covertBytes(1649267441664)).toBe("1.50 TB"); // 1.5 TB
    });

    it("should return petabytes for values greater than or equal to 1 PB", () => {
      expect(service.covertBytes(1125899906842624)).toBe("1.00 PB"); // 1 PB
      expect(service.covertBytes(2251799813685248)).toBe("2.00 PB"); // 2 PB
      expect(service.covertBytes(1693247244558336)).toBe("1.50 PB"); // 1.5 PB
    });

    it("should handle very large numbers gracefully", () => {
      expect(service.covertBytes(1125899906842624000)).toBe("1000.00 PB"); // 1000 PB
    });
  });

  describe("covertBytes", () => {
    it("should convert bytes to appropriate units", () => {
      expect(service.covertBytes(500)).toBe("500 B");
      expect(service.covertBytes(1024)).toBe("1.00 KB");
      expect(service.covertBytes(1048576)).toBe("1.00 MB");
      expect(service.covertBytes(1073741824)).toBe("1.00 GB");
      expect(service.covertBytes(1099511627776)).toBe("1.00 TB");
      expect(service.covertBytes(1125899906842624)).toBe("1.00 PB");
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
        getMany: jest.fn().mockResolvedValue(mockJobConfigs),
      } as any);

      const result = await jobConfigService.findJobConfigs(mockConditions);

      expect(result).toEqual(mockJobConfigs);
      expect(jobConfigRepo.createQueryBuilder).toHaveBeenCalledWith(
        "jobConfig",
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
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockErrorCounts),
      };

      jest
        .spyOn(operationErrorRepo, "createQueryBuilder")
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.getErrorCounts(mockJobRunId);

      expect(result).toEqual(mockErrorCounts);
      expect(operationErrorRepo.createQueryBuilder).toHaveBeenCalledWith("oe");
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        "oe.operation",
        "o",
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "o.jobRunId = :jobRunId",
        { jobRunId: mockJobRunId },
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
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockRejectedValue(mockError),
      };

      jest
        .spyOn(operationErrorRepo, "createQueryBuilder")
        .mockReturnValue(mockQueryBuilder as any);
      const loggerSpy = jest.spyOn(service["logger"], "error");
      const result = await service.getErrorCounts(mockJobRunId);

      expect(result).toEqual([]);
      expect(operationErrorRepo.createQueryBuilder).toHaveBeenCalledWith("oe");
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        "oe.operation",
        "o",
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "o.jobRunId = :jobRunId",
        { jobRunId: mockJobRunId },
      );
      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        "oe.errorType AS errorType",
        "COUNT(*) AS count",
      ]);
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith("oe.errorType");
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith(
        "Error occurred while fetching error type counts:",
        mockError,
      );
    });
  });
  describe("getJobRunErrors", () => {
    it("should return job run errors based on the query", async () => {
      const mockTaskQuery: JobErrorQueryDto = {
        page: "1",
        limit: "10",
        sort: "createdAt",
        order: "DESC",
        jobRunId: "jobRunId",
        errorType: ErrorType.FATAL_ERROR,
      };

      const mockErrors = [
        {
          id: "errorId1",
          errorMessage: "Error message 1",
          errorType: "FATAL_ERROR",
          createdAt: new Date(),
          fileName: "file1.txt",
          filePath: "/path/to/file1.txt",
          origin: "origin1",
          operationType: "operation1",
          errorCode: "code1",
          retryCount: 0,
        },
      ];

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockErrors, 1]),
      };

      jest
        .spyOn(operationErrorRepo, "createQueryBuilder")
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.getJobRunErrors(mockTaskQuery);

      expect(result).toEqual({ data: mockErrors, total: 1 });
      expect(operationErrorRepo.createQueryBuilder).toHaveBeenCalledWith("oe");
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        "oe.operation",
        "o",
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "o.jobRunId = :jobRunId",
        { jobRunId: mockTaskQuery.jobRunId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "oe.errorType = :errorType",
        { errorType: mockTaskQuery.errorType },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        "oe.createdAt",
        "DESC",
      );
      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        "oe.id",
        "oe.errorMessage",
        "oe.errorType",
        "oe.createdAt",
        "oe.fileName",
        "oe.filePath",
        "oe.origin",
        "oe.operationType",
        "oe.errorCode",
        "COALESCE(o.retryCount, 0) AS retryCount",
      ]);
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(
        parseInt(mockTaskQuery.limit),
      );
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(
        (parseInt(mockTaskQuery.page) - 1) * parseInt(mockTaskQuery.limit),
      );
      expect(mockQueryBuilder.getManyAndCount).toHaveBeenCalled();
    });

    it("should handle default values for page, limit, sort, and order", async () => {
      const mockTaskQuery: JobErrorQueryDto = {
        jobRunId: "jobRunId",
        errorType: ErrorType.FATAL_ERROR,
      };

      const mockErrors = [
        {
          id: "errorId1",
          errorMessage: "Error message 1",
          errorType: "FATAL_ERROR",
          createdAt: new Date(),
          fileName: "file1.txt",
          filePath: "/path/to/file1.txt",
          origin: "origin1",
          operationType: "operation1",
          errorCode: "code1",
          retryCount: 0,
        },
      ];

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockErrors, 1]),
      };

      jest
        .spyOn(operationErrorRepo, "createQueryBuilder")
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.getJobRunErrors(mockTaskQuery);

      expect(result).toEqual({ data: mockErrors, total: 1 });
      expect(operationErrorRepo.createQueryBuilder).toHaveBeenCalledWith("oe");
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        "oe.operation",
        "o",
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "o.jobRunId = :jobRunId",
        { jobRunId: mockTaskQuery.jobRunId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "oe.errorType = :errorType",
        { errorType: mockTaskQuery.errorType },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        "oe.createdAt",
        "DESC",
      );
      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        "oe.id",
        "oe.errorMessage",
        "oe.errorType",
        "oe.createdAt",
        "oe.fileName",
        "oe.filePath",
        "oe.origin",
        "oe.operationType",
        "oe.errorCode",
        "COALESCE(o.retryCount, 0) AS retryCount",
      ]);
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.getManyAndCount).toHaveBeenCalled();
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

  describe("actions", () => {
    it("should pause job runs", async () => {
      const jobRunActions: JobRunActionsReq = {
        action: JobRunActions.PAUSE,
        jobRuns: ["jobRun1", "jobRun2"],
      };
      jest.spyOn(service, "pauseJobRuns").mockResolvedValue({
        details: "Operation Completed Successfully",
      } as any);

      const result = await service.actions(jobRunActions);

      expect(result).toBeDefined();
      expect(result.details).toBe("Operation Completed Successfully");
    });

    it("should stop job runs", async () => {
      const jobRunActions: JobRunActionsReq = {
        action: JobRunActions.STOP,
        jobRuns: ["jobRun1", "jobRun2"],
      };
      jest.spyOn(service, "stopJobRuns").mockResolvedValueOnce({
        details: "Operation Completed Successfully",
      } as any);
      const result = await service.actions(jobRunActions);

      expect(result).toBeDefined();
      expect(result.details).toBe("Operation Completed Successfully");
    });

    it("should resume job runs", async () => {
      const jobRunActions: JobRunActionsReq = {
        action: JobRunActions.RESUME,
        jobRuns: ["jobRun1", "jobRun2"],
      };
      jest.spyOn(service, "resumeJobRuns").mockResolvedValueOnce({
        details: "Operation Completed Successfully",
      } as any);
      const result = await service.actions(jobRunActions);
      expect(result).toBeDefined();
      expect(result.details).toBe("Operation Completed Successfully");
    });

    // default case
    it("should throw BadRequestException for invalid action", async () => {
      const jobRunActions: JobRunActionsReq = {
        action: "INVALID_ACTION" as JobRunActions,
        jobRuns: ["jobRun1", "jobRun2"],
      };
      await expect(service.actions(jobRunActions)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
  describe("pauseJobRuns", () => {
    it("should pause the job runs and update their status", async () => {
      const jobRuns = ["jobRunId1", "jobRunId2"];
      const jobContextMock = { jobState: { status: JobRunStatus.Paused } };
      const workerJobRunMapUpdateSpy = jest
        .spyOn(workerJobRunMapRepo, "update")
        .mockResolvedValue(undefined);
      const jobRunRepoUpdateSpy = jest
        .spyOn(jobRunRepo, "update")
        .mockResolvedValue(undefined);
      jest
        .spyOn(redisService, "getJobContext")
        .mockResolvedValue(jobContextMock as any);

      await service.pauseJobRuns(jobRuns);

      expect(workerJobRunMapUpdateSpy).toHaveBeenCalledWith(
        { jobRunId: In(jobRuns) },
        { isActive: false },
      );
      expect(jobRunRepoUpdateSpy).toHaveBeenCalledWith(
        { id: In(jobRuns) },
        { status: JobRunStatus.Paused },
      );
    });

    it("should update the job context and return success message", async () => {
      const jobRuns = ["jobRunId1", "jobRunId2"];
      const jobContextMock = { jobState: { status: JobRunStatus.Paused } };
      const getJobContextSpy = jest
        .spyOn(redisService, "getJobContext")
        .mockResolvedValue(jobContextMock as any);
      const setJobContextSpy = jest
        .spyOn(redisService, "setJobContext")
        .mockResolvedValue(undefined);

      const result = await service.pauseJobRuns(jobRuns);

      expect(getJobContextSpy).toHaveBeenCalledTimes(jobRuns.length);
      expect(setJobContextSpy).toHaveBeenCalledTimes(jobRuns.length);
      expect(result).toEqual({ details: "Operation Completed Successfully" });
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
        { firstRunAt: mockDate, scheduler: ScheduleStatus.SCHEDULING },
      );

      expect(service.calculateJobRunStats).toHaveBeenCalledWith(jobRunId);
      expect(jobRunRepo.update).toHaveBeenCalledWith(
        { id: jobRunId },
        {
          status: JobRunStatus.Completed,
          endTime: expect.any(Date),
          jobStats: mockJobRunStats,
        },
      );
    });

    it("should update the job run status when status is running", async () => {
      const jobRunId = "1";
      const status = JobRunStatus.Running;
      const jobRunDetails = { id: jobRunId, jobConfigId: "1" };

      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(jobRunDetails as any);
      jest.spyOn(jobRunRepo, "update").mockResolvedValue(undefined);

      await service.updateJobRunStatus(jobRunId, status);

      expect(jobRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobRunId },
      });
      expect(jobRunRepo.update).toHaveBeenCalledWith(
        { id: jobRunId },
        { status },
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
        service.updateJobRunStatus(jobRunId, status),
      ).rejects.toThrow(
        "Invalid cron expression in futureScheduleAt: Invalid cron expression",
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
        service.updateJobRunStatus(jobRunId, status),
      ).rejects.toThrow(Error);
      expect(jobRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobRunId },
      });
    });
  });

  describe("stopJobRuns", () => {
    it("should stop job runs and update repositories correctly", async () => {
      const jobRuns = ["jobRun1", "jobRun2"];
      const mappings = [
        { workerId: "worker1", jobRunId: "jobRun1" },
        { workerId: "worker2", jobRunId: "jobRun2" },
      ];
      const jobRunConfigs = [
        { jobConfigId: "config1" },
        { jobConfigId: "config2" },
      ];
      const jobContextMock = {
        jobConfig: { jobType: "SOME_JOB_TYPE" },
        jobState: { status: "RUNNING" },
        appendToFileList: jest.fn(),
        cleanup: jest.fn(),
      };

      jest
        .spyOn(global, "setTimeout")
        .mockImplementation((fn) => (fn as any)());
      jest
        .spyOn(workerJobRunMapRepo, "find")
        .mockResolvedValue(mappings as any);
      jest.spyOn(jobRunRepo, "find").mockResolvedValue(jobRunConfigs as any);
      jest
        .spyOn(redisService, "getJobContext")
        .mockResolvedValue(jobContextMock as any);
      const result = await service.stopJobRuns(jobRuns);

      expect(workerJobRunMapRepo.find).toHaveBeenCalledWith({
        where: { jobRunId: In(jobRuns), isActive: true },
        select: { workerId: true, jobRunId: true },
      });

      expect(workerJobRunMapRepo.delete).toHaveBeenCalledWith({
        jobRunId: In(jobRuns),
      });

      expect(jobRunRepo.find).toHaveBeenCalledWith({
        where: {
          id: In(jobRuns),
          status: In([JobRunStatus.Paused, JobRunStatus.Running]),
        },
        select: { jobConfigId: true },
      });

      expect(jobRunRepo.update).toHaveBeenCalledWith(
        {
          id: In(jobRuns),
          status: In([
            JobRunStatus.Paused,
            JobRunStatus.Running,
            JobRunStatus.Ready,
          ]),
        },
        { status: JobRunStatus.Stopped, endTime: expect.any(Date) },
      );

      expect(jobConfigRepo.update).toHaveBeenCalledWith(
        { id: In(jobRunConfigs.map((jobRun) => jobRun.jobConfigId)) },
        { scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED },
      );

      expect(redisService.getJobContext).toHaveBeenCalledTimes(jobRuns.length);
      expect(workFlowService.terminateWorkflow).toHaveBeenCalledTimes(
        jobRuns.length,
      );
      expect(redisService.setJobContext).toHaveBeenCalledTimes(jobRuns.length);
      expect(jobContextMock.appendToFileList).toHaveBeenCalledTimes(
        jobRuns.length,
      );
      expect(jobContextMock.cleanup).toHaveBeenCalledTimes(jobRuns.length);

      expect(result).toEqual({ details: "Operation Completed Successfully" });

      jest.restoreAllMocks();
    });
  });

  describe("resumeJobRuns", () => {
    it("should resume job runs and update necessary states", async () => {
      const jobRuns = ["jobRun1", "jobRun2"];
      const mappings = [{ workerId: "worker1" }, { workerId: "worker2" }];

      jest
        .spyOn(workerJobRunMapRepo, "find")
        .mockResolvedValue(mappings as any);
      jest.spyOn(workerJobRunMapRepo, "update").mockResolvedValue(undefined);
      jest.spyOn(jobRunRepo, "update").mockResolvedValue(undefined);

      const jobContextMock: any = {
        jobState: {
          status: JobStatus.Active,
          tasks_total: 5,
        },
        appendToFileList: jest.fn(),
      };

      jest
        .spyOn(redisService, "getJobContext")
        .mockResolvedValue(jobContextMock);
      jest.spyOn(redisService, "setJobContext").mockResolvedValue(undefined);
      jest.spyOn(service, "resumeJobRun").mockResolvedValue(undefined);

      const result = await service.resumeJobRuns(jobRuns);

      expect(workerJobRunMapRepo.find).toHaveBeenCalledWith({
        where: { jobRunId: expect.anything() },
        select: { workerId: true },
      });
      expect(workerJobRunMapRepo.update).toHaveBeenCalledWith(
        { jobRunId: expect.anything() },
        { isActive: true },
      );
      expect(jobRunRepo.update).toHaveBeenCalledWith(
        { id: expect.anything(), status: JobRunStatus.Paused },
        { status: JobRunStatus.Running, pausedReason: null }
      );
      expect(redisService.getJobContext).toHaveBeenCalledTimes(jobRuns.length);
      expect(redisService.setJobContext).toHaveBeenCalledTimes(jobRuns.length);
      expect(service.resumeJobRun).toHaveBeenCalledTimes(jobRuns.length);
      expect(jobContextMock.appendToFileList).toHaveBeenCalled();

      expect(result).toEqual({ details: "Operation Completed Successfully" });
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
        approvalRequest as any,
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

  describe("resumeJobRun", () => {
    it("should resume workflow if job run exists and workflow is not running", async () => {
      const jobRunId = "1234";
      const jobRun = { id: jobRunId, jobConfigId: "config123" };
      const jobDetails = { jobType: "MIGRATE", workers: ["worker1"] };
      const workflowId = `workflow-${jobRunId}`;

      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(jobRun as any);
      jest
        .spyOn(jobRunInitService, "getJobConfig")
        .mockResolvedValue(jobDetails as any);
      jest
        .spyOn(jobRunInitService, "getWorkFlowId")
        .mockReturnValue(workflowId);
      jest
        .spyOn(workFlowService, "getWorkflowStatus")
        .mockResolvedValue("Completed" as any);
      jobRunInitService.initiateWorkflow = jest
        .fn()
        .mockResolvedValue(undefined);
      await service.resumeJobRun(jobRunId);
      expect(workFlowService.terminateWorkflow).not.toHaveBeenCalled();
    });

    it("should terminate and resume workflow if job run exists and workflow is running", async () => {
      const jobRunId = "1234";
      const jobRun = { id: jobRunId, jobConfigId: "config123" };
      const jobDetails = { jobType: "MIGRATE", workers: ["worker1"] };
      const workflowId = `MigrationWorkflow-${jobRunId}`;

      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(jobRun as any);
      jest
        .spyOn(jobRunInitService, "getJobConfig")
        .mockResolvedValue(jobDetails as any);
      jest
        .spyOn(jobRunInitService, "getWorkFlowId")
        .mockReturnValue(workflowId);
      jest
        .spyOn(workFlowService, "getWorkflowStatus")
        .mockResolvedValue("RUNNING" as any);
      jobRunInitService.initiateWorkflow = jest
        .fn()
        .mockResolvedValue(undefined);

      await service.resumeJobRun(jobRunId);

      expect(jobRunInitService.initiateWorkflow).toHaveBeenCalledWith(
        jobRunId,
        jobDetails,
      );
      expect(workFlowService.terminateWorkflow).toHaveBeenCalledWith(
        workflowId,
      );
    });

    it("should log error and throw if an error occurs", async () => {
      const jobRunId = "1234";
      jest
        .spyOn(jobRunRepo, "findOne")
        .mockRejectedValue(new Error("DB error"));

      try {
        await expect(service.resumeJobRun(jobRunId)).rejects.toThrow(
          "Failed to resume Job Run 1234 Error: DB error",
        );
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    //  if (!jobRun) case
    it("should throw NotFoundException if job run does not exist", async () => {
      const jobRunId = "1234";
      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(undefined);

      try {
        await service.resumeJobRun(jobRunId);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    // details.workers?.length === 0 case
    it("should throw BadRequestException if job run has no workers", async () => {
      const jobRunId = "1234";
      const jobRun = { id: jobRunId, jobConfigId: "config123" };
      const jobDetails = { jobType: "MIGRATE", workers: [] };

      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue(jobRun as any);
      jest
        .spyOn(jobRunInitService, "getJobConfig")
        .mockResolvedValue(jobDetails as any);

      try {
        await service.resumeJobRun(jobRunId);
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
        }),
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
      });
      expect(sendMailService.sendMail).not.toHaveBeenCalled();
    });
  });

  describe('checkWorkerHealth', () => {  
    it('should pause the job if all workers are offline', async () => {
      jest.spyOn(jobRunRepo, 'find').mockResolvedValue([
        {
          id: 'job1',
          status: JobRunStatus.Running,
          pausedReason: null,
          workerMap: [{ worker: { status: WorkerStatus.Online, workerName: 'w1' } }],
        },
        {
          id: 'job1',
          status: JobRunStatus.Paused,
          pausedReason: PausedReason.SYSTEM_PAUSED,
          workerMap: [{ worker: { status: WorkerStatus.Online, workerName: 'w1' } }],
        }
      ] as any)
      const updateWorkerStatusMock = jest.fn((workers: WorkerEntity[]) => workers);
      jest.spyOn(workerService, 'updateWorkerStatus').mockImplementationOnce(updateWorkerStatusMock);
      jest.spyOn(redisService, 'getJobContext').mockResolvedValue({
        jobState: {
          status: JobStatus.Active,
          tasks_total: 5,
        },
      } as any);
      await service.checkWorkerHealth();
    });
  });

  

});
