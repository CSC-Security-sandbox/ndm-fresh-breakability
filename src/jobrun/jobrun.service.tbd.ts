import { Test, TestingModule } from '@nestjs/testing';
import { JobRunService } from './jobrun.service';
import { JobRunEntity, JobRunStatus } from '../entities/jobrun.entity';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobConfigService } from '../jobconfig/jobconfig.service';
import { JobRunDto, JobRunFilterDto } from '../dto/jobrun.dto';

describe('JobRunService', () => {
  let jobRunService: JobRunService;
  let jobRunRepo: Repository<JobRunEntity>;
  let jobConfigService: JobConfigService;

  const mockJobRunRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
    })),
  };

  const mockJobConfigService = {
    getJobConfigById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobRunService,
        {
          provide: getRepositoryToken(JobRunEntity),
          useValue: mockJobRunRepo,
        },
        {
          provide: JobConfigService,
          useValue: mockJobConfigService,
        },
      ],
    }).compile();

    jobRunService = module.get<JobRunService>(JobRunService);
    jobRunRepo = module.get<Repository<JobRunEntity>>(getRepositoryToken(JobRunEntity));
    jobConfigService = module.get<JobConfigService>(JobConfigService);
  });

  it('should be defined', () => {
    expect(jobRunService).toBeDefined();
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobRunService,
        {
          provide: getRepositoryToken(JobRunEntity),
          useValue: mockJobRunRepo,
        },
        {
          provide: JobConfigService,
          useValue: mockJobConfigService,
        },
      ],
    }).compile();

    jobRunService = module.get<JobRunService>(JobRunService);
    jobRunRepo = module.get<Repository<JobRunEntity>>(getRepositoryToken(JobRunEntity));
    jobConfigService = module.get<JobConfigService>(JobConfigService);
  });

  it('should be defined', () => {
    expect(jobRunService).toBeDefined();
  });

  describe('createJobRun', () => {
    it('should create and save a job run', async () => {
      const jobRunData: JobRunDto = {
        id: '12345',
        status: JobRunStatus.Pending,
        startTime: new Date('2024-01-01'),
        endTime: new Date('2024-01-01'),
        iterationNumber: 1,
        jobConfigId: 'job-id-123',
      };
      const jobRunEntity = { ...jobRunData, id: 'jobrun-id-123' } as JobRunEntity;

      mockJobRunRepo.create.mockReturnValue(jobRunEntity);
      mockJobRunRepo.save.mockResolvedValue(jobRunEntity);

      // const result = await jobRunService.createJobRun(jobRunData);

      // expect(result).toEqual(jobRunEntity);
      expect(mockJobRunRepo.create).toHaveBeenCalledWith(jobRunData);
      expect(mockJobRunRepo.save).toHaveBeenCalledWith(jobRunEntity);
    });
  });

  describe('getJobRun', () => {
    it('should return job runs that match the condition', async () => {
      const condition = { where: { status: JobRunStatus.Ready } };
      const jobRuns = [{ id: 'jobrun-id-1' }, { id: 'jobrun-id-2' }];
      mockJobRunRepo.find.mockResolvedValue(jobRuns);
      const result = await jobRunService.getJobRun(condition);

      expect(result).toEqual(jobRuns);
      expect(mockJobRunRepo.find).toHaveBeenCalledWith(condition);
    });

    it('should throw an error if no job runs are found', async () => {
      const condition = { where: { status: JobRunStatus.Ready } };
      mockJobRunRepo.find.mockResolvedValue([]);

      await expect(jobRunService.getJobRun(condition)).rejects.toThrow('Job run not found');
    });
  });

  describe('getJobAllRuns', () => {
    it('should return paginated, sorted, and filtered job runs', async () => {
      const page = 1;
      const limit = 10;
      const sortField = 'start_time';
      const sortOrder = 'ASC';
      const filter: JobRunFilterDto = { status: JobRunStatus.Ready };
  
      const jobRuns = [{ id: 'jobrun-id-1' }, { id: 'jobrun-id-2' }];
      const total = 2;
  
      // Mock the Query Builder
      const mockQueryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([jobRuns, total]),
      };
  
      // Assign mockQueryBuilder to createQueryBuilder mock
      mockJobRunRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
  
      const result = await jobRunService.getJobAllRuns(page, limit, sortField, sortOrder, filter);
  
      // Validate the result
      expect(result).toEqual({
        total,
        page,
        limit,
        data: jobRuns,
      });
  
      // Validate method calls on the query builder
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'job_run.status LIKE :status',
        { status: `%${filter.status}%` },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('job_run.start_time', sortOrder);
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith((page - 1) * limit);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(limit);
      expect(mockQueryBuilder.getManyAndCount).toHaveBeenCalled();
    });
  });
  

  describe('updateJobRun', () => {
    it('should update a job run', async () => {
      const id = 'jobrun-id-123';
      const data: Partial<JobRunDto> = { status: JobRunStatus.Completed};
      const existingJobRun = { id, status: 'Active' };
      mockJobRunRepo.findOne.mockResolvedValue(existingJobRun);
      mockJobRunRepo.save.mockResolvedValue({ ...existingJobRun, ...data });
      const result = await jobRunService.updateJobRun(id, data);

      expect(result).toEqual({ ...existingJobRun, ...data });
      expect(mockJobRunRepo.findOne).toHaveBeenCalledWith({ where: { id } });
      expect(mockJobRunRepo.save).toHaveBeenCalledWith({ ...existingJobRun, ...data });
    });

    it('should throw an error if job run is not found', async () => {
      const id = 'nonexistent-id';
      const data: Partial<JobRunDto> = { status: JobRunStatus.Completed };
      mockJobRunRepo.findOne.mockResolvedValue(null);

      await expect(jobRunService.updateJobRun(id, data)).rejects.toThrow(`Job run with id ${id} not found`);
    });
  });
/*
  describe('deleteJobRun', () => {
    it('should delete a job run', async () => {
      const id = 'jobrun-id-123';
      const jobRun = { id };

      mockJobRunRepo.findOne.mockResolvedValue(jobRun);
      const result = await jobRunService.deleteJobRun(id);
      
      expect(result).toEqual({ message: `Job run with id ${id} has been deleted` });
      expect(mockJobRunRepo.remove).toHaveBeenCalledWith(jobRun);
    });

    it('should throw an error if job run is not found', async () => {
      const id = 'nonexistent-id';
      mockJobRunRepo.findOne.mockResolvedValue(null);
      
      await expect(jobRunService.deleteJobRun(id)).rejects.toThrow(`Job run with id ${id} not found`);
    });
  });
*/
  // describe('scheduleAJobRun', () => {
  //   it('should schedule a job run', async () => {
  //     const jobId = 'job-id-123';
  //     const job = { id: jobId };
  //     mockJobConfigService.getJobConfigById.mockResolvedValue(job);
  
  //     const jobRunData = {
  //       status: JobRunStatus.Ready,
  //       startTime: expect.any(Date),
  //       iterationNumber: 1,
  //       jobConfigId: job.id,
  //     };
  
  //     const savedJobRunData = { ...jobRunData, id: 'job-run-id-456' }; // Mocked saved object
  //     mockJobRunRepo.create.mockReturnValue(jobRunData);
  //     mockJobRunRepo.save.mockResolvedValue(savedJobRunData);
  
  //     const result = await jobRunService.scheduleAJobRun(jobId);
  
  //     expect(result).toEqual(savedJobRunData);
  //     expect(mockJobConfigService.getJobConfigById).toHaveBeenCalledWith(jobId);
  //     expect(mockJobRunRepo.create).toHaveBeenCalledWith(jobRunData);
  //     expect(mockJobRunRepo.save).toHaveBeenCalledWith(jobRunData);
  //   });
  
  //   it('should throw an error if the job is not found', async () => {
  //     const jobId = 'nonexistent-job-id';
  //     mockJobConfigService.getJobConfigById.mockResolvedValue(null);
  
  //     await expect(jobRunService.scheduleAJobRun(jobId)).rejects.toThrow(`Job with id ${jobId} not found`);
  //     expect(mockJobConfigService.getJobConfigById).toHaveBeenCalledWith(jobId);
  //   });
  // });  
});
