import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobRunService } from './job-run.service';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { TaskEntity } from 'src/entities/task.entity';
import { ReportsEntity } from 'src/entities/reports.entity';
import { JobRunStatus, JobType, ReportType } from 'src/constants/enums';
import { JobRunStats } from './dto/job-rundetails.dto';

// Mock data and repositories
const mockJobRunRepo = {
  findOne: jest.fn(),
};

const mockInventoryRepo = {
  createQueryBuilder: jest.fn(),
};

const mockTaskRepo = {
  createQueryBuilder: jest.fn(),
};

const mockReportsRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

describe('JobRunService', () => {
  let service: JobRunService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobRunService,
        { provide: getRepositoryToken(JobRunEntity), useValue: mockJobRunRepo },
        { provide: getRepositoryToken(InventoryEntity), useValue: mockInventoryRepo },
        { provide: getRepositoryToken(TaskEntity), useValue: mockTaskRepo },
        { provide: getRepositoryToken(ReportsEntity), useValue: mockReportsRepo },
      ],
    }).compile();

    service = module.get<JobRunService>(JobRunService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getJobStatsId', () => {
    const jobId = '12345';

    it('should return saved report if it exists', async () => {
      const savedReport = { reportData: JSON.stringify({ test: 'data' }) };
      mockReportsRepo.findOne.mockResolvedValue(savedReport);

      const result = await service.getJobStatsId(jobId);

      expect(mockReportsRepo.findOne).toHaveBeenCalledWith({
        where: { jobRunId: jobId, reportType: ReportType.JOB_RUN_STATS },
        select: { reportData: true },
      });
      expect(result).toEqual(JSON.parse(savedReport.reportData));
    });

    it('should throw NotFoundException if job run does not exist', async () => {
      mockReportsRepo.findOne.mockResolvedValue(null);
      mockJobRunRepo.findOne.mockResolvedValue(null);

      await expect(service.getJobStatsId(jobId)).rejects.toThrow(NotFoundException);

      expect(mockJobRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: jobId },
        select: expect.any(Object),
        relations: expect.any(Object),
      });
    });

    it('should return job stats if no saved report exists', async () => {
      mockReportsRepo.findOne.mockResolvedValue(null);
      const mockJobRun = {
        id: jobId,
        startTime: new Date(),
        status: JobRunStatus.Completed,
        jobConfig: {
          id: 'configId',
          jobType: JobType.Discover,
          sourcePath: { fileServer: { protocol: 'http', config: { configName: 'sourceServer' } }, volumePath: '/source' },
          destinationPath: { fileServer: { protocol: 'ftp', config: { configName: 'destServer' } }, volumePath: '/destination' },
        },
        worker: { workerId: 'worker1' },
      };
      mockJobRunRepo.findOne.mockResolvedValue(mockJobRun);
      mockInventoryRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });
      mockTaskRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      const result = await service.getJobStatsId(jobId);

      expect(mockJobRunRepo.findOne).toHaveBeenCalled();
      expect(mockInventoryRepo.createQueryBuilder).toHaveBeenCalled();
      expect(mockTaskRepo.createQueryBuilder).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        id: jobId,
        jobConfig: expect.any(Object),
        worker: 0,
      }));
    });
  });
});
