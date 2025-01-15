import { Test, TestingModule } from '@nestjs/testing';
import { JobRunService } from './job-run.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { TaskEntity } from 'src/entities/task.entity';
import { ReportsEntity } from 'src/entities/reports.entity';
import { Repository } from 'typeorm';
import { ReportType, JobRunStatus } from 'src/constants/enums';

const mockJobRunEntity = {
  id: '1',
  startTime: new Date(),
  status: JobRunStatus.Completed,
  endTime: new Date(),
  workerMap: [{ workerId: 'worker1' }],
  jobConfig: {
    jobType: 'type1',
    sourcePath: { fileServer: { config: { configName: 'source' } } },
    targetPath: { fileServer: { config: { configName: 'target' } } }
  }
};

const mockInventorySummary = [
  { isDirectory: true, counts: 5, totalFileSize: 1000 },
  { isDirectory: false, counts: 10, totalFileSize: 5000 }
];

const mockTaskStatusCounts = [
  { status: 'Completed', count: 5 },
  { status: 'Failed', count: 2 }
];

const mockReportData = { jobRunId: '1', reportData: '{}' };

const mockJobRunRepo = {
  findOne: jest.fn().mockResolvedValue(mockJobRunEntity),
};

const mockInventoryRepo = {
  createQueryBuilder: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  getRawMany: jest.fn().mockResolvedValue(mockInventorySummary),
};

const mockTaskRepo = {
  createQueryBuilder: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  getRawMany: jest.fn().mockResolvedValue(mockTaskStatusCounts),
};

const mockReportsRepo = {
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockReturnValue(mockReportData),
  save: jest.fn().mockResolvedValue(mockReportData),
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

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return job stats from the report if it exists', async () => {
    mockReportsRepo.findOne = jest.fn().mockResolvedValue({
      reportData: JSON.stringify({ jobRunId: '1', status: 'Completed' })
    });

    const result = await service.getJobStatsId('1');
    expect(result).toHaveProperty('jobRunId');
    expect(mockReportsRepo.findOne).toHaveBeenCalledWith({ where: { jobRunId: '1', reportType: ReportType.JOB_RUN_STATS }, select: { reportData: true } });
  });

  it('should fetch job stats and save a report if not found in the database', async () => {
    mockReportsRepo.findOne = jest.fn().mockResolvedValue(null);
    
    const result = await service.getJobStatsId('1');
    

    expect(result).toHaveProperty('task');
    expect(mockReportsRepo.save).toHaveBeenCalledWith({
      jobRunId: '1',
      reportData: JSON.stringify(result),
      reportType: ReportType.JOB_RUN_STATS,
    });
  });

  it('should map inventory summary correctly', async () => {
    const result = await service.getJobStatsId('1');
    expect(result).toHaveProperty('scannedDirectoriesCount', '5');
    expect(result).toHaveProperty('scannedFileCount', '10');
    expect(result).toHaveProperty('totalScannedSize');
  });

  it('should map task status counts correctly', async () => {
    const result = await service.getJobStatsId('1');
    expect(result.task.completed).toBe(5);
    expect(result.task.failed).toBe(2);
  });

  it('should handle cases when the inventoryRepo returns empty data', async () => {
    mockInventoryRepo.getRawMany = jest.fn().mockResolvedValue([]);
    const result = await service.getJobStatsId('1');
    expect(result).toHaveProperty('scannedDirectoriesCount', undefined);
    expect(result).toHaveProperty('scannedFileCount', undefined);
    expect(result).toHaveProperty('totalScannedSize', undefined);
  });
});
