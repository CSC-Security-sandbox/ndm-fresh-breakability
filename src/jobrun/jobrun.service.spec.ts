import { Test, TestingModule } from "@nestjs/testing";
import { JobRunService } from "./jobrun.service";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { JobRunEntity } from "../entities/jobrun.entity";
import { JobConfigEntity } from "../entities/jobconfig.entity";
import { WorkerJobRunMap } from "../entities/workerjobrun.entity";
import { CutOverStatus, JobRunStatus, JobStatus, JobType, Protocol, WorkFlows } from "src/constants/enums";
import { JobRunPageDto } from "./dto/jobrunpage.dto";
import { Any, In, Repository, UpdateResult } from "typeorm";
import { getRepositoryToken } from "@nestjs/typeorm";
import { InventoryEntity } from "src/entities/inventory.entity";
import { JobOptionsEntity } from "src/entities/joboptions.entity";
import { ConfigService } from "@nestjs/config";
import { WorkflowService } from "src/workflow/workflow.service";
import { ErrorType, JobContext, Task } from "@netapp-cloud-datamigrate/jobs-lib";
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
import { SpeedTestConfigEntity, SpeedTestConfigWorkerEntity } from "src/entities/speed-test-job-config.entity";
import { FileServerEntity } from "src/entities/fileserver.entity";
import { ApprovalRequestDTO, JobRunActions, JobRunActionsReq } from "./dto/jobrunactions.dto";
import { SignalWorkFlowPayload } from "src/workflow/workflow.types";
import { ScheduleStatus } from "src/constants/status";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { JobConfigService } from "src/jobconfig/jobconfig.service";
import { existsSync, createReadStream } from 'fs';
import { join } from 'path';
import { NetworkPerformanceResultEntity, SpeedLogEntity, SpeedLogEntryEntity, SpeedTestResultEntity } from "src/entities/speed-test-result.entity";
import { WorkerEntity } from "src/entities/worker.entity";
import { ProjectEntity } from "src/entities/project.entity";
import { JobErrorQueryDto } from "./dto/jobRunErrors.dto";
import { IdentityMappingEntity } from "src/entities/indentity-mapping.entity";
import { IdentityConfigCrossMappingEntity } from "src/entities/indentity-mapping-cross.entity";

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
        },{
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
        },{
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
        }
        ,
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
            delete:jest.fn()
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
        },{
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
            getWorkflowStatus : jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            getJobContext: jest.fn(),
            setJobContext: jest.fn(),
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
    operationErrorRepo = module.get<Repository<OperationErrorEntity>>(getRepositoryToken(OperationErrorEntity));
    identityMappingRepo = module.get<Repository<IdentityMappingEntity>>(getRepositoryToken(IdentityMappingEntity));
    identityCrossMappingRepo = module.get<Repository<IdentityConfigCrossMappingEntity>>(getRepositoryToken(IdentityConfigCrossMappingEntity));
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
  });

  it('should update job config and job run status when cutover is rejected', async () => {
    const mockJobRunId = 'jobRunId';
    const mockJobRun = {
      id: mockJobRunId,
      jobConfig: {
        sourcePathId: 'sourcePathId',
        targetPathId: 'targetPathId',
      },
    };

    jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(mockJobRun as any);
    jest.spyOn(jobConfigRepo, 'update').mockResolvedValue({ affected: 1 } as any);
    jest.spyOn(jobRunRepo, 'update').mockResolvedValue({ affected: 1 } as any);

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

  it('should update job config and job run status when cutover is approved', async () => {
    const mockJobRunId = 'jobRunId';
    const mockJobRun = {
      id: mockJobRunId,
      jobConfig: {
        sourcePathId: 'sourcePathId',
        targetPathId: 'targetPathId',
      },
    };

    jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(mockJobRun as any);
    jest.spyOn(jobConfigRepo, 'update').mockResolvedValue({ affected: 1 } as any);
    jest.spyOn(jobRunRepo, 'update').mockResolvedValue({ affected: 1 } as any);

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
      { status: JobStatus.InActive ,
        futureScheduleAt: null,
        scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED,
      }
    );
    expect(jobRunRepo.update).toHaveBeenCalledWith(
      { id: mockJobRunId },
      { status: JobRunStatus.Completed, subStatus: CutOverStatus.APPROVED }
    );
  });

  describe('addHocRun', () => {
    it('should create a job run if job config is valid', async () => {
      const mockJobConfigId = 'jobConfigId';
      const mockJobConfig = {
        id: mockJobConfigId,
        scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED,
        status: JobStatus.Active,
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
      jest.spyOn(jobRunInitService, 'createJobRun').mockResolvedValue('job run created' as any);

      const result = await service.addHocRun(mockJobConfigId);

      expect(result).toBe('job run created');
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({ where: { id: mockJobConfigId } });
      expect(jobRunInitService.createJobRun).toHaveBeenCalledWith(mockJobConfig.id, expect.any(Date));
    });

    it('should throw NotFoundException if job config does not exist', async () => {
      const mockJobConfigId = 'jobConfigId';

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(null);

      await expect(service.addHocRun(mockJobConfigId)).rejects.toThrow(NotFoundException);
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({ where: { id: mockJobConfigId } });
    });

    it('should throw BadRequestException if job run is already created', async () => {
      const mockJobConfigId = 'jobConfigId';
      const mockJobConfig = {
        id: mockJobConfigId,
        scheduler: ScheduleStatus.SCHEDULED,
        status: JobStatus.Active,
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);

      await expect(service.addHocRun(mockJobConfigId)).rejects.toThrow(BadRequestException);
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({ where: { id: mockJobConfigId } });
    });

    it('should throw BadRequestException if job config is inactive', async () => {
      const mockJobConfigId = 'jobConfigId';
      const mockJobConfig = {
        id: mockJobConfigId,
        scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED,
        status: JobStatus.InActive,
      };

      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);

      await expect(service.addHocRun(mockJobConfigId)).rejects.toThrow(BadRequestException);
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({ where: { id: mockJobConfigId } });
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
        expect.any(Date)
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

      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue({
        jobConfigId: "4567",
        jobConfig: {
          firstRunAt: "undefined",
        },
      } as any);

      await service.updateJobRunStatus("123", JobRunStatus.Completed);
    });

    it("should update status for non-Completed statuses", async () => {
      jest.spyOn(jobRunRepo, "findOne").mockResolvedValue({
        jobConfigId: "4567",
        jobConfig: {
          firstRunAt: "undefined",
        },
      } as any);

      await service.updateJobRunStatus("123", JobRunStatus.Failed);

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
            workers: [{ workerId: "worker-1" }, { workerId: "worker-2" }],
            protocolVersion: "2",
          },
        },
        targetPath: null,
        jobType: "DATA_TRANSFER",
      };

      jest
        .spyOn(jobConfigRepo, "findOne")
        .mockResolvedValue(mockJobConfig as any);

      const result = await initService.getJobConfig("123");

      expect(jest.spyOn(jobConfigRepo, "findOne")).toHaveBeenCalledWith({
        where: { id: "123" },
        relations: {
          sourcePath: {
            fileServer: { config: true, workers: true },
          },
          targetPath: {
            fileServer: { config: true, workers: true },
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
        workers: ["worker-1", "worker-2"],
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
            workers: [{ workerId: "worker-1" }, { workerId: "worker-2" }],
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
            workers: [{ workerId: "worker-2" }, { workerId: "worker-3" }],
            protocolVersion: "2",
          },
        },
        targetPathId: "target-id",
        jobType: "DATA_TRANSFER",
      };

      jest
        .spyOn(jobConfigRepo, "findOne")
        .mockResolvedValue(mockJobConfig as any);

      const result = await initService.getJobConfig("123");

      expect(jest.spyOn(jobConfigRepo, "findOne")).toHaveBeenCalledWith({
        where: { id: "123" },
        relations: {
          sourcePath: {
            fileServer: { config: true, workers: true },
          },
          targetPath: {
            fileServer: { config: true, workers: true },
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

      jest.spyOn(initService, "getJobConfig").mockResolvedValue(mockWorkers as any);
      jest
        .spyOn(workerJobRunMapRepo, "create")
        .mockImplementation((data) => data as any);
      jest
        .spyOn(jobRunRepo, "create")
        .mockImplementation((data) => data as any);
      jest.spyOn(jobRunRepo, "save").mockResolvedValue({ id: "1" } as any);
      jest.spyOn(initService, "buildJobContext").mockImplementation()
      const result = await initService.createJobRun(mockJob, new Date());
      expect(result).toEqual({ "id": "1"});
    });

    it("should log a warning if no workers exist", async () => {
      const mockJob = "1" as any;

      jest
        .spyOn(initService, "getJobConfig")
        .mockResolvedValue({ workers: [] } as any);

      const loggerSpy = jest.spyOn(initService["logger"], "warn");

      await initService.createJobRun(mockJob, new Date());

      expect(loggerSpy).toHaveBeenCalledWith(
        `Unable to create Job Run for Job Config ${mockJob} does not has workers`
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
        jobtype: "DISCOVER",
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

    const mockInventoryStats = {
      filecount: "10",
      directorycount: "2",
      totalsize: "2048",
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

    jest.spyOn( service,'getErrorCounts').mockImplementation().mockReturnValue([] as any)

    const result = await service.getJobAllRuns(filter);

    expect(result).toMatchObject([
      {
        status: "SUCCESS",
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
        totalMigratedSize: "0",
        errors: [],
      },
    ]);
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

    const mockInventoryStats = {
      filecount: "10",
      directorycount: "2",
      totalsize: "2048",
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

    jest.spyOn( service,'getErrorCounts').mockImplementation().mockReturnValue([] as any)

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
        scannedDirectoriesCount: "2",
        totalScannedSize: "",
        totalMigratedSize: "",
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
    jest.spyOn( service,'getErrorCounts').mockImplementation().mockReturnValue([] as any)

    const result = await service.getJobAllRuns(filter);

    expect(result).toBeDefined();
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
      jest.spyOn( service,'getErrorCounts').mockImplementation().mockReturnValue([] as any)
      
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
      expect(service["inventoryRepo"].createQueryBuilder).toHaveBeenCalledWith(
        "inventory"
      );
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
        totalMigratedSize: "0",
        errors: [],
        tasks: [],
      });
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

        jest.spyOn( service,'getErrorCounts').mockImplementation().mockReturnValue([] as any)
      


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
      expect(service["inventoryRepo"].createQueryBuilder).toHaveBeenCalledWith(
        "inventory"
      );
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
        totalScannedSize: "0",
        totalMigratedSize: "",
        errors: [],
        tasks: [],
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

  describe('covertBytes', () => {
    it('should convert bytes to appropriate units', () => {
      expect(service.covertBytes(500)).toBe('500 B');
      expect(service.covertBytes(1024)).toBe('1.00 KB');
      expect(service.covertBytes(1048576)).toBe('1.00 MB');
      expect(service.covertBytes(1073741824)).toBe('1.00 GB');
      expect(service.covertBytes(1099511627776)).toBe('1.00 TB');
      expect(service.covertBytes(1125899906842624)).toBe('1.00 PB');
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

      expect(jobConfigService.hasCommonWorkers(mockData)).toBe(true);
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

      expect(jobConfigService.hasCommonWorkers(mockData)).toBe(false);
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

      expect(jobConfigService.hasCommonWorkers(mockData)).toBe(false);
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

      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockJobConfigs),
      } as any);

      const result = await jobConfigService.findJobConfigs(mockConditions);

      expect(result).toEqual(mockJobConfigs);
      expect(jobConfigRepo.createQueryBuilder).toHaveBeenCalledWith('jobConfig');
    });

    it('should return empty array if no conditions are provided', async () => {
      const result = await jobConfigService.findJobConfigs([]);

      expect(result).toEqual([]);
      expect(jobConfigRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
  describe('getErrorOverview', () => {
    it('should return error counts for the given job run ID', async () => {
      const mockJobRunId = 'jobRunId';
      const mockErrorCounts = [
        { errorType: 'TypeError', count: '5' },
        { errorType: 'ValidationError', count: '3' },
      ];

      jest.spyOn(service, 'getErrorCounts').mockResolvedValue(mockErrorCounts);

      const result = await service.getErrorOverview(mockJobRunId);

      expect(result).toEqual(mockErrorCounts);
      expect(service.getErrorCounts).toHaveBeenCalledWith(mockJobRunId);
    });
  });

  describe('getErrorCounts', () => {
    it('should return error type counts for the given job run ID', async () => {
      const mockJobRunId = 'jobRunId';
      const mockErrorCounts = [
        { errorType: 'TypeError', count: '5' },
        { errorType: 'ValidationError', count: '3' },
      ];

      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockErrorCounts),
      };

      jest.spyOn(operationErrorRepo, 'createQueryBuilder').mockReturnValue(mockQueryBuilder as any);

      const result = await service.getErrorCounts(mockJobRunId);

      expect(result).toEqual(mockErrorCounts);
      expect(operationErrorRepo.createQueryBuilder).toHaveBeenCalledWith('oe');
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith('oe.operation', 'o');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('o.jobRunId = :jobRunId', { jobRunId: mockJobRunId });
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(['oe.errorType AS errorType', 'COUNT(*) AS count']);
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('oe.errorType');
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalled();
    });

    it('should handle errors while fetching error type counts', async () => {
      const mockJobRunId = 'jobRunId';
      const mockError = new Error('Test error');

      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockRejectedValue(mockError),
      };

      jest.spyOn(operationErrorRepo, 'createQueryBuilder').mockReturnValue(mockQueryBuilder as any);
      const loggerSpy = jest.spyOn(service["logger"], "error");
      const result = await service.getErrorCounts(mockJobRunId);

      expect(result).toEqual([]);
      expect(operationErrorRepo.createQueryBuilder).toHaveBeenCalledWith('oe');
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith('oe.operation', 'o');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('o.jobRunId = :jobRunId', { jobRunId: mockJobRunId });
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(['oe.errorType AS errorType', 'COUNT(*) AS count']);
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('oe.errorType');
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith(
       'Error occurred while fetching error type counts:', mockError
      );
    });
  });
  describe('getJobRunErrors', () => {
    it('should return job run errors based on the query', async () => {
      const mockTaskQuery: JobErrorQueryDto = {
        page: '1',
        limit: '10',
        sort: 'createdAt',
        order: 'DESC',
        jobRunId: 'jobRunId',
        errorType: ErrorType.FATAL_ERROR,
      };

      const mockErrors = [
        {
          id: 'errorId1',
          errorMessage: 'Error message 1',
          errorType: 'FATAL_ERROR',
          createdAt: new Date(),
          fileName: 'file1.txt',
          filePath: '/path/to/file1.txt',
          origin: 'origin1',
          operationType: 'operation1',
          errorCode: 'code1',
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

      jest.spyOn(operationErrorRepo, 'createQueryBuilder').mockReturnValue(mockQueryBuilder as any);

      const result = await service.getJobRunErrors(mockTaskQuery);

      expect(result).toEqual({ data: mockErrors, total: 1 });
      expect(operationErrorRepo.createQueryBuilder).toHaveBeenCalledWith('oe');
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('oe.operation', 'o');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('o.jobRunId = :jobRunId', { jobRunId: mockTaskQuery.jobRunId });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('oe.errorType = :errorType', { errorType: mockTaskQuery.errorType });
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('oe.createdAt', 'DESC');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        'oe.id', 'oe.errorMessage', 'oe.errorType', 'oe.createdAt', 'oe.fileName', 'oe.filePath', 'oe.origin', 'oe.operationType', 'oe.errorCode',
        'COALESCE(o.retryCount, 0) AS retryCount',
      ]);
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(parseInt(mockTaskQuery.limit));
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith((parseInt(mockTaskQuery.page) - 1) * parseInt(mockTaskQuery.limit));
      expect(mockQueryBuilder.getManyAndCount).toHaveBeenCalled();
    });

    it('should handle default values for page, limit, sort, and order', async () => {
      const mockTaskQuery: JobErrorQueryDto = {
        jobRunId: 'jobRunId',
        errorType: ErrorType.FATAL_ERROR,
      };

      const mockErrors = [
        {
          id: 'errorId1',
          errorMessage: 'Error message 1',
          errorType: 'FATAL_ERROR',
          createdAt: new Date(),
          fileName: 'file1.txt',
          filePath: '/path/to/file1.txt',
          origin: 'origin1',
          operationType: 'operation1',
          errorCode: 'code1',
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

      jest.spyOn(operationErrorRepo, 'createQueryBuilder').mockReturnValue(mockQueryBuilder as any);

      const result = await service.getJobRunErrors(mockTaskQuery);

      expect(result).toEqual({ data: mockErrors, total: 1 });
      expect(operationErrorRepo.createQueryBuilder).toHaveBeenCalledWith('oe');
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('oe.operation', 'o');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('o.jobRunId = :jobRunId', { jobRunId: mockTaskQuery.jobRunId });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('oe.errorType = :errorType', { errorType: mockTaskQuery.errorType });
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('oe.createdAt', 'DESC');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        'oe.id', 'oe.errorMessage', 'oe.errorType', 'oe.createdAt', 'oe.fileName', 'oe.filePath', 'oe.origin', 'oe.operationType', 'oe.errorCode',
        'COALESCE(o.retryCount, 0) AS retryCount',
      ]);
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.getManyAndCount).toHaveBeenCalled();
    });
  });
 
  
  it('should throw NotFoundException if jobRunId is not found', async () => {
    const mockJobRunId = 'nonexistent-jobRunId';
  
    jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(null);
  
    await expect(service.getJobRun(mockJobRunId)).rejects.toThrow(Error);
    expect(jobRunRepo.findOne).toHaveBeenCalledWith({  
      where:{
        id: mockJobRunId,

      },
      relations:  [
         "tasks",
         "tasks.worker",
       ],
       "select":  {
         "endTime": true,
         "id": true,
         "jobConfigId": true,
         "startTime": true,
         "status": true,
         "subStatus": true,
         "tasks":  {
           "createdAt": true,
           "id": true,
           "status": true,
           "taskType": true,
           "updatedAt": true,
           "worker":  {
             "workerName": true,
           },
           "workerId": true,
         },
       },
     } );
  });

  describe('actions', () => {
    it('should pause job runs', async () => {
      const jobRunActions: JobRunActionsReq = {
        action: JobRunActions.PAUSE,
        jobRuns: ['jobRun1', 'jobRun2'],
      };
      jest.spyOn(service, 'pauseJobRuns').mockResolvedValue({ details: 'Operation Completed Successfully' } as any);

      const result = await service.actions(jobRunActions);

      expect(result).toBeDefined();
      expect(result.details).toBe('Operation Completed Successfully');
    });

    it('should stop job runs', async () => {
      const jobRunActions: JobRunActionsReq = {
        action: JobRunActions.STOP,
        jobRuns: ['jobRun1', 'jobRun2'],
      };
        jest.spyOn(service, 'stopJobRuns').mockResolvedValueOnce({ details: 'Operation Completed Successfully' } as any);
      const result = await service.actions(jobRunActions);

      expect(result).toBeDefined();
      expect(result.details).toBe('Operation Completed Successfully');
    });

    it('should resume job runs', async () => {
      const jobRunActions: JobRunActionsReq = {
        action: JobRunActions.RESUME,
        jobRuns: ['jobRun1', 'jobRun2'],
      };
      jest.spyOn(service, 'resumeJobRuns').mockResolvedValueOnce({ details: 'Operation Completed Successfully' } as any);
      const result = await service.actions(jobRunActions);
      expect(result).toBeDefined();
      expect(result.details).toBe('Operation Completed Successfully');
    });
  });
  describe('pauseJobRuns', () => {
    it('should pause the job runs and update their status', async () => {
      const jobRuns = ['jobRunId1', 'jobRunId2'];
      const jobContextMock = { jobState: { status: JobRunStatus.Paused } };
      const workerJobRunMapUpdateSpy = jest.spyOn(workerJobRunMapRepo, 'update').mockResolvedValue(undefined);
      const jobRunRepoUpdateSpy = jest.spyOn(jobRunRepo, 'update').mockResolvedValue(undefined);
      jest.spyOn(redisService, 'getJobContext').mockResolvedValue(jobContextMock as any);

      await service.pauseJobRuns(jobRuns);

      expect(workerJobRunMapUpdateSpy).toHaveBeenCalledWith({ jobRunId: In(jobRuns) }, { isActive: false });
      expect(jobRunRepoUpdateSpy).toHaveBeenCalledWith({ id: In(jobRuns) }, { status: JobRunStatus.Paused });
    });

    it('should update the job context and return success message', async () => {
      const jobRuns = ['jobRunId1', 'jobRunId2'];
      const jobContextMock = { jobState: { status: JobRunStatus.Paused } };
      const getJobContextSpy = jest.spyOn(redisService, 'getJobContext').mockResolvedValue(jobContextMock as any);
      const setJobContextSpy = jest.spyOn(redisService, 'setJobContext').mockResolvedValue(undefined);
    
      const result = await service.pauseJobRuns(jobRuns);

      expect(getJobContextSpy).toHaveBeenCalledTimes(jobRuns.length);
      expect(setJobContextSpy).toHaveBeenCalledTimes(jobRuns.length);
      expect(result).toEqual({ details: 'Operation Completed Successfully' });
    });
  });
  describe('updateJobRunStatus', () => {
    it('should update the job run status and job config scheduler when status is not running', async () => {
      const jobRunId = '1';
      const status = JobRunStatus.Completed;
      const jobRunDetails = {
        id: jobRunId,
        jobConfigId: '1',
      };
      const jobConfigDetails = {
        id: '1',
        futureScheduleAt: '0 0 * * *',
        jobType: JobType.MIGRATE
      };

      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(jobRunDetails as any);
      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(jobConfigDetails as any);
      jest.spyOn(jobConfigRepo, 'update').mockResolvedValue(undefined);
      jest.spyOn(jobRunRepo, 'update').mockResolvedValue(undefined);

      await service.updateJobRunStatus(jobRunId, status);

      expect(jobRunRepo.findOne).toHaveBeenCalledWith({ where: { id: jobRunId } });
      expect(jobConfigRepo.findOne).toHaveBeenCalledWith({ where: { id: jobRunDetails.jobConfigId } });
      expect(jobConfigRepo.update).toHaveBeenCalledWith({ id: jobConfigDetails.id }, { firstRunAt: expect.any(Date), scheduler: ScheduleStatus.SCHEDULING });
      expect(jobRunRepo.update).toHaveBeenCalledWith({ id: jobRunId }, { status: status, endTime: expect.any(Date) });
    });

    it('should update the job run status when status is running', async () => {
      const jobRunId = '1';
      const status = JobRunStatus.Running;
      const jobRunDetails = {
        id: jobRunId,
        jobConfigId: '1',
      };

      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(jobRunDetails as any);
      jest.spyOn(jobRunRepo, 'update').mockResolvedValue(undefined);

      await service.updateJobRunStatus(jobRunId, status);

      expect(jobRunRepo.findOne).toHaveBeenCalledWith({ where: { id: jobRunId } });
      expect(jobRunRepo.update).toHaveBeenCalledWith({ id: jobRunId }, { status: status });
    });
  });  
  describe('stopJobRuns', () => {
    it('should stop job runs and update repositories correctly', async () => {
      const jobRuns = ['jobRun1', 'jobRun2'];
      const mappings = [
        { workerId: 'worker1', jobRunId: 'jobRun1' },
        { workerId: 'worker2', jobRunId: 'jobRun2' },
      ];
      const jobRunConfigs = [{ jobConfigId: 'config1' }, { jobConfigId: 'config2' }];
      const jobContextMock = {
        jobConfig: { jobType: 'SOME_JOB_TYPE' },
        jobState: { status: 'RUNNING' },
        appendToFileList: jest.fn(),
        cleanup: jest.fn(),
      };
      
      jest.spyOn(global, 'setTimeout').mockImplementation((fn) => (fn as any)());
      jest.spyOn(workerJobRunMapRepo, 'find').mockResolvedValue(mappings as any);  
      jest.spyOn(jobRunRepo, 'find').mockResolvedValue(jobRunConfigs as any);
      jest.spyOn(redisService, 'getJobContext').mockResolvedValue(jobContextMock as any);
      const result = await service.stopJobRuns(jobRuns);

  
      expect(workerJobRunMapRepo.find).toHaveBeenCalledWith({
        where: { jobRunId: In(jobRuns), isActive: true },
        select: { workerId: true, jobRunId: true },
      });
  
      expect(workerJobRunMapRepo.delete).toHaveBeenCalledWith({ jobRunId: In(jobRuns) });
  
      expect(jobRunRepo.find).toHaveBeenCalledWith({
        where: { id: In(jobRuns), status: In([JobRunStatus.Paused, JobRunStatus.Running]) },
        select: { jobConfigId: true },
      });
  
      expect(jobRunRepo.update).toHaveBeenCalledWith(
        { id: In(jobRuns), status: In([JobRunStatus.Paused, JobRunStatus.Running, JobRunStatus.Ready]) },
        { status: JobRunStatus.Stopped , endTime: expect.any(Date) }
      );
  
      expect(jobConfigRepo.update).toHaveBeenCalledWith(
        { id: In(jobRunConfigs.map((jobRun) => jobRun.jobConfigId)) },
        { scheduler: ScheduleStatus.READY_TO_BE_SCHEDULED }
      );
  
      expect(redisService.getJobContext).toHaveBeenCalledTimes(jobRuns.length);
      expect(workFlowService.terminateWorkflow).toHaveBeenCalledTimes(jobRuns.length);
      expect(redisService.setJobContext).toHaveBeenCalledTimes(jobRuns.length);
      expect(jobContextMock.appendToFileList).toHaveBeenCalledTimes(jobRuns.length);
      expect(jobContextMock.cleanup).toHaveBeenCalledTimes(jobRuns.length);
  
      expect(result).toEqual({ details: 'Operation Completed Successfully' });
  
      jest.restoreAllMocks();
    });
  }); 
  describe('resumeJobRuns', () =>{
   
    it('should resume job runs and update statuses correctly', async () => {
      const jobRuns = ['jobRunId1'];
      const jobContextMock = {
        jobConfig: { jobType: 'SOME_JOB_TYPE' },
        jobState: { status: 'RUNNING',tasks_total: 1 },
        appendToFileList: jest.fn(),
        cleanup: jest.fn(),
      };
    
     jest.spyOn(redisService, 'getJobContext').mockResolvedValue(jobContextMock as any);
     jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue({ id: 'jobRunId1', status: JobRunStatus.Paused } as any);
    
     jest.spyOn(jobRunInitService,'getJobConfig').mockResolvedValue({jobType:JobType.MIGRATE,workers:1} as any)   
      const result = await service.resumeJobRuns(jobRuns);   
      expect(workerJobRunMapRepo.find).toHaveBeenCalledWith({
        where: { jobRunId: In(jobRuns) },
        select: { workerId: true },
      });
      expect(workerJobRunMapRepo.update).toHaveBeenCalledWith(
        { jobRunId: In(jobRuns) },
        { isActive: true },
      );
      expect(jobRunRepo.update).toHaveBeenCalledWith(
        { id: In(jobRuns), status: JobRunStatus.Paused },
        { status: JobRunStatus.Running },
      );
  
      expect(redisService.getJobContext).toHaveBeenCalledTimes(jobRuns.length);
      expect(redisService.setJobContext).toHaveBeenCalledTimes(jobRuns.length);
      expect(result).toEqual({ details: 'Operation Completed Successfully' });

  });
});
});