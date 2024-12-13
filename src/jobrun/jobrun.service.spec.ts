import { Test, TestingModule } from '@nestjs/testing';
import { JobRunService } from './jobrun.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { WorkerJobRunMap } from '../entities/workerjobrun.entity';
import { JobRunStatus, JobStatus } from 'src/constants/enums';
import { EmitterEvents } from 'src/constants/events';
import { JobRunPageDto } from './dto/jobrunpage.dto';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InventoryEntity } from 'src/entities/inventory.entity';

describe('JobRunService', () => {
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
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(JobConfigEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(WorkerJobRunMap),
          useClass: Repository,
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
    jobRunRepo = module.get<Repository<JobRunEntity>>(getRepositoryToken(JobRunEntity));
    jobConfigRepo = module.get<Repository<JobConfigEntity>>(getRepositoryToken(JobConfigEntity));
    workerJobRunMapRepo = module.get<Repository<WorkerJobRunMap>>(getRepositoryToken(WorkerJobRunMap));
    inventoryRepo = module.get<Repository<InventoryEntity>>(getRepositoryToken(InventoryEntity));
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  describe('scheduleAJob', () => {
    it('should schedule jobs that match criteria', async () => {
      const mockJobs = [{ id: '1', status: JobStatus.Active, firstRunAt: new Date() }];
      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockJobs),
      } as any);

      const createJobRunSpy = jest.spyOn(service, 'createJobRun').mockResolvedValue(undefined);

      const result = await service.scheduleAJob();

      expect(result).toEqual(mockJobs);
      expect(createJobRunSpy).toHaveBeenCalledWith(mockJobs[0], expect.any(Date));
    });

    it('should return an empty array if no jobs match', async () => {
      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      } as any);

      const result = await service.scheduleAJob();

      expect(result).toEqual([]);
    });
  });
  
  describe('getSourceAndTargetWorkersByJobConfigId', () => {
    it('should return overlapping workers when targetPathId is present', async () => {
      const job = { id: '1', targetPathId: '2' } as JobConfigEntity;
      const mockJobConfig = {
        sourcePath: {
          fileServer: { workers: [{ workerId: 'worker1' }, { workerId: 'worker2' }] },
        },
        targetPath: {
          fileServer: { workers: [{ workerId: 'worker1' }, { workerId: 'worker3' }] },
        },
      };
  
      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockJobConfig),
      } as any);
  
      const result = await service.getSourceAndTargetWorkersByJobConfigId(job);
  
      expect(result).toEqual(['worker1']);
      expect(jobConfigRepo.createQueryBuilder).toHaveBeenCalledWith('jobConfig');
    });
  
    it('should return only source workers when targetPathId is not present', async () => {
      const job = { id: '1' } as JobConfigEntity; // targetPathId is not defined
      const mockJobConfig = {
        sourcePath: {
          fileServer: { workers: [{ workerId: 'worker1' }, { workerId: 'worker2' }] },
        },
        targetPath: null,
      };
  
      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockJobConfig),
      } as any);
  
      const result = await service.getSourceAndTargetWorkersByJobConfigId(job);
  
      expect(result).toEqual(['worker1', 'worker2']);
    });
  
    it('should return an empty array when jobConfig is null', async () => {
      const job = { id: '1', targetPathId: '2' } as JobConfigEntity;
  
      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      } as any);
  
      const result = await service.getSourceAndTargetWorkersByJobConfigId(job);
  
      expect(result).toEqual([]);
    });
  
    it('should return an empty array when no workers are present in source or target', async () => {
      const job = { id: '1', targetPathId: '2' } as JobConfigEntity;
      const mockJobConfig = {
        sourcePath: { fileServer: { workers: [] } },
        targetPath: { fileServer: { workers: [] } },
      };
  
      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockJobConfig),
      } as any);
  
      const result = await service.getSourceAndTargetWorkersByJobConfigId(job);
  
      expect(result).toEqual([]);
    });
  
    it('should handle workers in source but not in target when targetPathId is present', async () => {
      const job = { id: '1', targetPathId: '2' } as JobConfigEntity;
      const mockJobConfig = {
        sourcePath: {
          fileServer: { workers: [{ workerId: 'worker1' }, { workerId: 'worker2' }] },
        },
        targetPath: { fileServer: { workers: [] } },
      };
  
      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockJobConfig),
      } as any);
  
      const result = await service.getSourceAndTargetWorkersByJobConfigId(job);
  
      expect(result).toEqual([]);
    });
  
    it('should return only unique workers when both source and target are the same', async () => {
      const job = { id: '1', targetPathId: '2' } as JobConfigEntity;
      const mockJobConfig = {
        sourcePath: {
          fileServer: { workers: [{ workerId: 'worker1' }, { workerId: 'worker2' }] },
        },
        targetPath: {
          fileServer: { workers: [{ workerId: 'worker1' }, { workerId: 'worker2' }] },
        },
      };
  
      jest.spyOn(jobConfigRepo, 'createQueryBuilder').mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockJobConfig),
      } as any);
  
      const result = await service.getSourceAndTargetWorkersByJobConfigId(job);
  
      expect(result).toEqual(['worker1', 'worker2']);
    });
  });
  

  describe('createJobRun', () => {
    it('should create a job run if workers exist', async () => {
      const mockJob = { id: '1', sourcePath: { volumePath: 'src' }, targetPath: { volumePath: 'tgt' } } as any;
      const mockWorkers = ['worker1', 'worker2'];

      jest.spyOn(service, 'getSourceAndTargetWorkersByJobConfigId').mockResolvedValue(mockWorkers);
      jest.spyOn(workerJobRunMapRepo, 'create').mockImplementation((data) => data as any);
      jest.spyOn(jobRunRepo, 'create').mockImplementation((data) => data as any);
      jest.spyOn(jobRunRepo, 'save').mockResolvedValue({ id: '1' } as any);

      const emitSpy = jest.spyOn(eventEmitter, 'emit');

      await service.createJobRun(mockJob, new Date());

      expect(emitSpy).toHaveBeenCalledWith(EmitterEvents.TaskCreate, expect.any(Object));
    });

    it('should log a warning if no workers exist', async () => {
      const mockJob = { id: '1' } as any;

      jest.spyOn(service, 'getSourceAndTargetWorkersByJobConfigId').mockResolvedValue([]);

      const loggerSpy = jest.spyOn(service['logger'], 'warn');

      await service.createJobRun(mockJob, new Date());

      expect(loggerSpy).toHaveBeenCalledWith(`Unable to create Job Run for Job Config ${mockJob.id} does not has workers`);
    });
  });

  describe('getJobRun', () => {
    it('should return job runs when they exist', async () => {
      const mockJobRuns = [{ id: '1', status: JobRunStatus.Ready}];
      jest.spyOn(jobRunRepo, 'find').mockResolvedValue(mockJobRuns as any);
  
      const result = await service.getJobRun({ where: { status: JobRunStatus.Ready} });
  
      expect(result).toEqual(mockJobRuns);
      expect(jobRunRepo.find).toHaveBeenCalledWith({ where: { status: JobRunStatus.Ready } });
    });
  
    it('should throw an error when no job runs are found', async () => {
      jest.spyOn(jobRunRepo, 'find').mockResolvedValue([]);
  
      await expect(service.getJobRun({ where: { status:  JobRunStatus.Ready} })).rejects.toThrowError(
        `Job run not found`
      );
  
      expect(jobRunRepo.find).toHaveBeenCalledWith({ where: { status:  JobRunStatus.Ready} });
    });
  });
  
  describe('findAllJobRuns', () => {

    it('should return paginated data with count if undefined', async () => {

      const workers = [{ id: '1', name: 'Worker1' }, { id: '2', name: 'Worker2' }];
      const total = 2;

      jest.spyOn(jobRunRepo, 'find').mockResolvedValueOnce(workers as any);
      jest.spyOn(jobRunRepo, 'count').mockResolvedValueOnce(total);

      const result = await service.findAllJobRuns({} as any);

      expect(result).toEqual({ data: workers, total });
      expect(jobRunRepo.find).toHaveBeenCalled();
      expect(jobRunRepo.count).toHaveBeenCalled();
    });

    it('should return paginated data with count', async () => {
      const jobRunPageDto: JobRunPageDto = {
        page: '1',
        limit: '10',
        sort: 'name',
        order: 'asc',
        iterationNumber: 1,
        jobConfigId : "e45678",
        status: JobRunStatus.Ready,
      } as any;
      const workers = [{ id: '1', name: 'Worker1' }, { id: '2', name: 'Worker2' }];
      const total = 2;

      jest.spyOn(jobRunRepo, 'find').mockResolvedValueOnce(workers as any);
      jest.spyOn(jobRunRepo, 'count').mockResolvedValueOnce(total);

      const result = await service.findAllJobRuns(jobRunPageDto);

      expect(result).toEqual({ data: workers, total });
      expect(jobRunRepo.find).toHaveBeenCalled();
      expect(jobRunRepo.count).toHaveBeenCalled();
    });

    it('should return data without pagination if no page and limit are provided', async () => {
      const jobRunPageDto: JobRunPageDto = {
        sort: 'name',
        order: 'asc',
      }as any
      const jobRun = [{ id: '1', name: 'jobRun1' }, { id: '2', name: 'jobRun2' }];
      const total = 2;

      jest.spyOn(jobRunRepo, 'find').mockResolvedValueOnce(jobRun as any);
      jest.spyOn(jobRunRepo, 'count').mockResolvedValueOnce(total);

      const result = await service.findAllJobRuns(jobRunPageDto);

      expect(result).toEqual({ data: jobRun, total });
      expect(jobRunRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { name: 'asc' },
      });
      expect(jobRunRepo.count).toHaveBeenCalled();
    });

    it('should return an empty result when no workers are found', async () => {
      const jobRunPageDto: JobRunPageDto = { page: '1', limit: '10' }as any
      jest.spyOn(jobRunRepo, 'find').mockResolvedValueOnce([]);
      jest.spyOn(jobRunRepo, 'count').mockResolvedValueOnce(0);

      const result = await service.findAllJobRuns(jobRunPageDto);
      expect(result).toEqual({ data: [], total: 0 });
      expect(jobRunRepo.find).toHaveBeenCalled();
      expect(jobRunRepo.count).toHaveBeenCalled();
    });

    it('should handle jobRunRepo errors', async () => {
      const jobRunPageDto: JobRunPageDto = { page: '1', limit: '10' }as any
      jest.spyOn(jobRunRepo, 'find').mockRejectedValueOnce(new Error('Database error'));

      await expect(service.findAllJobRuns(jobRunPageDto)).rejects.toThrow('Database error');
      expect(jobRunRepo.find).toHaveBeenCalled();
    });
  });
  

  describe('updateJobRun', () => {
    it('should update and return the updated job run when it exists', async () => {
      const jobRunId = '1';
      const existingJobRun = { id: jobRunId, status: 'Ready', iterationNumber: 1 };
      const updateData = { status: 'In Progress' };
      const updatedJobRun = { ...existingJobRun, ...updateData };
  
      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(existingJobRun as any);
      jest.spyOn(jobRunRepo, 'save').mockResolvedValue(updatedJobRun as any);
  
      const result = await service.updateJobRun(jobRunId, updateData as any);
  
      expect(result).toEqual(updatedJobRun);
      expect(jobRunRepo.findOne).toHaveBeenCalledWith({ where: { id: jobRunId } });
      expect(jobRunRepo.save).toHaveBeenCalledWith({ ...existingJobRun, ...updateData });
    });
  
    it('should throw an error when the job run does not exist', async () => {
      const jobRunId = '1';
      const updateData = { status: 'In Progress' };
  
      jest.spyOn(jobRunRepo, 'findOne').mockResolvedValue(null);
  
      await expect(service.updateJobRun(jobRunId, updateData as any)).rejects.toThrowError(
        `Job run with id ${jobRunId} not found`
      );
  
      expect(jobRunRepo.findOne).toHaveBeenCalledWith({ where: { id: jobRunId } });
    });
  });
  
  
  it('should return job runs with calculated stats', async () => {
    const filter = { projectId: 'project123' };
    const mockJobRuns = [
      {
        jobtype: 'COPY',
        volumepath: '/source/path',
        sourcefileserverprotocol: 'HTTP',
        sourceconfigname: 'SourceServer',
        targetvolumepath: '/target/path',
        targetfileserverprotocol: 'FTP',
        targetconfigname: 'TargetServer',
        status: 'SUCCESS',
        starttime: new Date(Date.now() - 10000),
        endtime: new Date(),
      },
    ];
  
    const mockInventoryStats = {
      filecount: '10',
      directorycount: '2',
      totalsize: '2048',
    };

    jest.spyOn(jobRunRepo, 'createQueryBuilder').mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(mockJobRuns),
    } as any);


    jest.spyOn(inventoryRepo, 'createQueryBuilder').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(mockInventoryStats),
    } as any);
  
    const result = await service.getJobAllRuns(filter);
  
    expect(result).toMatchObject([
      {
        status: 'SUCCESS',
        startTime: mockJobRuns[0].starttime,
        endTime: mockJobRuns[0].endtime,
        jobType: 'COPY',
        sourceServer: {
          serverName: 'SourceServer',
          path: '/source/path',
          protocol: 'HTTP',
        },
        destinationServer: {
          serverName: 'TargetServer',
          path: '/target/path',
          protocol: 'FTP',
        },
        scannedFilesCount: '10',
        scannedDirectoriesCount: '2',
        totalScannedSize: '2048',
        errors: [],
      },
    ]);
  });
  
  it('should handle no job runs for the given filter', async () => {
    const filter = { projectId: 'nonexistent' };
  

    jest.spyOn(jobRunRepo, 'createQueryBuilder').mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    } as any);


    jest.spyOn(inventoryRepo, 'createQueryBuilder').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(null),
    } as any);
  
    
    const result = await service.getJobAllRuns(filter);
  
    expect(result).toEqual([]);
  });
  
  it('should handle missing inventory data for job runs', async () => {
    const filter = { projectId: 'project123' };
    const mockJobRuns = [
      {
        jobtype: 'COPY',
        jobconfigid: 'config1',
        volumepath: '/source/path',
        sourcefileserverprotocol: 'HTTP',
        sourceconfigname: 'SourceServer',
        targetvolumepath: null,
        targetfileserverprotocol: null,
        targetconfigname: null,
        status: 'SUCCESS',
        starttime: new Date(Date.now() - 10000),
        endtime: null,
      },
    ];
  


    jest.spyOn(jobRunRepo, 'createQueryBuilder').mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(mockJobRuns),
    } as any);


    jest.spyOn(inventoryRepo, 'createQueryBuilder').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(null),
    } as any);
  
    const result = await service.getJobAllRuns(filter);
  
    expect(result).toEqual([
      {
        status: 'SUCCESS',
        startTime: mockJobRuns[0].starttime,
        endTime: null,
        jobType: 'COPY',
        sourceServer: {
          serverName: 'SourceServer',
          path: '/source/path',
          protocol: 'HTTP',
        },
        destinationServer: {},
        timeElapsed: Date.now() - mockJobRuns[0].starttime.getTime(),
        scannedFilesCount: '0',
        scannedDirectoriesCount: '0',
        totalScannedSize: '0',
        errors: [],
      },
    ]);
  });
  

});
