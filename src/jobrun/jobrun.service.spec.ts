import { Test, TestingModule } from "@nestjs/testing";
import { JobRunService } from "./jobrun.service";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { JobRunEntity } from "../entities/jobrun.entity";
import { JobConfigEntity } from "../entities/jobconfig.entity";
import { WorkerJobRunMap } from "../entities/workerjobrun.entity";
import { JobRunStatus, JobStatus, JobType } from "src/constants/enums";
import { EmitterEvents } from "src/constants/events";
import { JobRunPageDto } from "./dto/jobrunpage.dto";
import { Repository } from "typeorm";
import { getRepositoryToken } from "@nestjs/typeorm";
import { InventoryEntity } from "src/entities/inventory.entity";

describe("JobRunService", () => {
  let service: JobRunService;
  let jobRunRepo: Repository<JobRunEntity>;
  let jobConfigRepo: Repository<JobConfigEntity>;
  let workerJobRunMapRepo: Repository<WorkerJobRunMap>;
  let eventEmitter: EventEmitter2;
  let inventoryRepo: Repository<InventoryEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobRunService,
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
        EventEmitter2,
      ],
    }).compile();

    service = module.get<JobRunService>(JobRunService);
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
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  describe("scheduleAJob", () => {
    it("should schedule jobs that match criteria", async () => {
      const mockJobs = [
        { id: "1", status: JobStatus.Active, firstRunAt: new Date() },
      ];
      jest.spyOn(jobConfigRepo, "createQueryBuilder").mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockJobs),
      } as any);

      const createJobRunSpy = jest
        .spyOn(service, "createJobRun")
        .mockResolvedValue(undefined);

      const result = await service.scheduleAJob();

      expect(result).toEqual(mockJobs);
      expect(createJobRunSpy).toHaveBeenCalledWith(
        mockJobs[0].id,
        expect.any(Date)
      );
    });

    it("should return an empty array if no jobs match", async () => {
      jest.spyOn(jobConfigRepo, "createQueryBuilder").mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      } as any);

      const result = await service.scheduleAJob();

      expect(result).toEqual([]);
    });
  });


  describe('jobRunUpdateStatus', ()=> {
    it('should update endTime and status to Completed, and call auxiliary methods for Completed status', async () => {
      const payload = {
        jobRunId: '123',
        status: JobRunStatus.Completed,
      };

      jest.spyOn(jobRunRepo,'findOne').mockResolvedValue({jobConfigId: "4567"} as any)
  
      await service.jobRunStatusUpdate(payload);

    });
  
    it('should update status for non-Completed statuses', async () => {
      const payload = {
        jobRunId: '456',
        status: JobRunStatus.Failed, 
      };
  
      await service.jobRunStatusUpdate(payload);
  
    })
  })

  describe('getJobConfig', ()=>{
    it('should retrieve and process job configuration without targetPathId', async () => {
      const mockJobConfig = {
        id: '123',
        sourcePath: {
          volumePath: '/source/path',
          id: 'source-id',
          fileServer: {
            protocol: 'FTP',
            userName: 'source-user',
            password: 'source-pass',
            host: 'source-host',
            config: { workingDirectory: '/source/working' },
            workers: [{ workerId: 'worker-1' }, { workerId: 'worker-2' }],
          },
        },
        targetPath: null,
        jobType: 'DATA_TRANSFER',
      };
  
      
      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
  
      const result = await service.getJobConfig('123');
  
      expect(jest.spyOn(jobConfigRepo, 'findOne')).toHaveBeenCalledWith({
        where: { id: '123' },
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
            path: '/source/path',
            pathId: 'source-id',
            protocol: 'FTP',
            username: 'source-user',
            password: 'source-pass',
            host: 'source-host',
            workingDirectory: '/source/working',
          },
        },
        workers: ['worker-1', 'worker-2'],
        jobType: 'DATA_TRANSFER',
      });
    });
  
    it('should retrieve and process job configuration with targetPathId', async () => {
      const mockJobConfig = {
        id: '123',
        sourcePath: {
          volumePath: '/source/path',
          id: 'source-id',
          fileServer: {
            protocol: 'FTP',
            userName: 'source-user',
            password: 'source-pass',
            host: 'source-host',
            config: { workingDirectory: '/source/working' },
            workers: [{ workerId: 'worker-1' }, { workerId: 'worker-2' }],
          },
        },
        targetPath: {
          volumePath: '/target/path',
          id: 'target-id',
          fileServer: {
            protocol: 'SFTP',
            userName: 'target-user',
            password: 'target-pass',
            host: 'target-host',
            config: { workingDirectory: '/target/working' },
            workers: [{ workerId: 'worker-2' }, { workerId: 'worker-3' }],
          },
        },
        targetPathId: 'target-id',
        jobType: 'DATA_TRANSFER',
      };
  
      jest.spyOn(jobConfigRepo, 'findOne').mockResolvedValue(mockJobConfig as any);
  
      const result = await service.getJobConfig('123');
  
      expect(jest.spyOn(jobConfigRepo, 'findOne')).toHaveBeenCalledWith({
        where: { id: '123' },
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
            path: '/source/path',
            pathId: 'source-id',
            protocol: 'FTP',
            username: 'source-user',
            password: 'source-pass',
            host: 'source-host',
            workingDirectory: '/source/working',
          },
          targetCredential: {
            path: '/target/path',
            pathId: 'target-id',
            protocol: 'SFTP',
            username: 'target-user',
            password: 'target-pass',
            host: 'target-host',
            workingDirectory: '/target/working',
          },
        },
        workers: ['worker-2'],
        jobType: 'DATA_TRANSFER',
      });
    });
  })


  describe("createJobRun", () => {
    it("should create a job run if workers exist", async () => {
      const mockJob = {
        id: "1",
        sourcePath: { volumePath: "src" },
        targetPath: { volumePath: "tgt" },
      } as any;
      const mockWorkers ={
          connection: {
            sourceCredential: {
              path:"asdfghjk",
            }
          },
        workers: ["worker1", "worker2"]
      };

      jest
        .spyOn(service, "getJobConfig")
        .mockResolvedValue(mockWorkers as any);
      jest
        .spyOn(workerJobRunMapRepo, "create")
        .mockImplementation((data) => data as any);
      jest
        .spyOn(jobRunRepo, "create")
        .mockImplementation((data) => data as any);
      jest.spyOn(jobRunRepo, "save").mockResolvedValue({ id: "1" } as any);

      const emitSpy = jest.spyOn(eventEmitter, "emit");

      await service.createJobRun(mockJob, new Date());

      expect(emitSpy).toHaveBeenCalledWith(
        EmitterEvents.TaskCreate,
        expect.any(Object)
      );
    });

    it("should log a warning if no workers exist", async () => {
      const mockJob = "1" as any;

      jest
        .spyOn(service, "getJobConfig" )
        .mockResolvedValue({workers: []} as any);

      const loggerSpy = jest.spyOn(service["logger"], "warn");

      await service.createJobRun(mockJob, new Date());

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
        jobtype: "COPY",
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

    const result = await service.getJobAllRuns(filter);

    expect(result).toMatchObject([
      {
        status: "SUCCESS",
        startTime: mockJobRuns[0].starttime,
        endTime: mockJobRuns[0].endtime,
        jobType: "COPY",
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

    const result = await service.getJobAllRuns(filter);
  
    expect(result).toBeDefined();
  });
  describe('getJobRun', () => {
    it('should return job run details when it exists', async () => {
      // Arrange
      const jobId = '1';
      const jobRunId = '123';
      const jobConfigId = '456';
      const jobType = JobType.DISCOVER;
      const sourceServerName = 'SourceServer';
      const sourcePath = '/source/path';
      const sourceProtocol = 'HTTP';
      const targetServerName = 'TargetServer';
      const targetPath = '/target/path';
      const targetProtocol = 'FTP';
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + 1000);
      const fileCount = '0';
      const directoryCount = '0';
      const totalSize = '0';

      jest.spyOn(service['jobRunRepo'], 'findOne').mockResolvedValueOnce({
        id: jobRunId,
        status: JobRunStatus.Completed,
        startTime,
        endTime,
        jobConfigId,
        tasks: [],
      } as JobRunEntity);

      jest.spyOn(service['jobConfigRepo'], 'findOne').mockResolvedValueOnce({
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
        futureScheduleAt: '0 0 0 * * *',
        excludeOlderThan: new Date(),
        excludeFilePatterns: 'test',
        status: JobStatus.Active,
        createdBy: 'test',
        sourcePathId: '1',
        targetPathId: '2',
        jobRuns: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: 'test',
      } as unknown as JobConfigEntity);

      jest.spyOn(service['inventoryRepo'], 'createQueryBuilder').mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValueOnce({
          fileCount,
          directoryCount,
          totalSize,
        }),
      } as any);
      const result = await service.getJobRun(jobId);
    
      expect(service["jobConfigRepo"].findOne).toHaveBeenCalledWith({
        where: { id: jobConfigId },
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
      expect(service["inventoryRepo"].createQueryBuilder).toHaveBeenCalledWith('inventory');
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
        errors: [],
        tasks: [],
      });
    });
  });

  describe('service.covertBytes', () => {
    it('should return bytes for values less than 1024', () => {
        expect(service.covertBytes(500)).toBe('500 B');
        expect(service.covertBytes(0)).toBe('0 B');
    });

    it('should return kilobytes for values between 1024 and 1 MB', () => {
        expect(service.covertBytes(1024)).toBe('1.00 KB');
        expect(service.covertBytes(1536)).toBe('1.50 KB');
    });

    it('should return megabytes for values between 1 MB and 1 GB', () => {
        expect(service.covertBytes(1048576)).toBe('1.00 MB'); // 1 MB
        expect(service.covertBytes(2097152)).toBe('2.00 MB'); // 2 MB
        expect(service.covertBytes(1572864)).toBe('1.50 MB'); // 1.5 MB
    });

    it('should return gigabytes for values between 1 GB and 1 TB', () => {
        expect(service.covertBytes(1073741824)).toBe('1.00 GB'); // 1 GB
        expect(service.covertBytes(2147483648)).toBe('2.00 GB'); // 2 GB
        expect(service.covertBytes(1610612736)).toBe('1.50 GB'); // 1.5 GB
    });

    it('should return terabytes for values between 1 TB and 1 PB', () => {
        expect(service.covertBytes(1099511627776)).toBe('1.00 TB'); // 1 TB
        expect(service.covertBytes(2199023255552)).toBe('2.00 TB'); // 2 TB
        expect(service.covertBytes(1649267441664)).toBe('1.50 TB'); // 1.5 TB
    });

    it('should return petabytes for values greater than or equal to 1 PB', () => {
        expect(service.covertBytes(1125899906842624)).toBe('1.00 PB'); // 1 PB
        expect(service.covertBytes(2251799813685248)).toBe('2.00 PB'); // 2 PB
        expect(service.covertBytes(1693247244558336)).toBe('1.50 PB'); // 1.5 PB
    });

    it('should handle very large numbers gracefully', () => {
        expect(service.covertBytes(1125899906842624000)).toBe('1000.00 PB'); // 1000 PB
    });
  });

});
