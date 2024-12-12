import { Test, TestingModule } from '@nestjs/testing';
import { JobRunService } from './jobrun.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { WorkerJobRunMap } from '../entities/workerjobrun.entity';
import { JobRunStatus, JobStatus } from 'src/constants/enums';
import { EmitterEvents } from 'src/constants/events';

describe('JobRunService', () => {
  let service: JobRunService;
  let jobRunRepo: Repository<JobRunEntity>;
  let jobConfigRepo: Repository<JobConfigEntity>;
  let workerJobRunMapRepo: Repository<WorkerJobRunMap>;
  let eventEmitter: EventEmitter2;

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
        EventEmitter2,
      ],
    }).compile();

    service = module.get<JobRunService>(JobRunService);
    jobRunRepo = module.get<Repository<JobRunEntity>>(getRepositoryToken(JobRunEntity));
    jobConfigRepo = module.get<Repository<JobConfigEntity>>(getRepositoryToken(JobConfigEntity));
    workerJobRunMapRepo = module.get<Repository<WorkerJobRunMap>>(getRepositoryToken(WorkerJobRunMap));
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
  

});
