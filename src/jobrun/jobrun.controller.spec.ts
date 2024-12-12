import { Test, TestingModule } from '@nestjs/testing';
import { JobRunController } from './jobrun.controller';
import { JobRunService } from './jobrun.service';
import { JobRunFilterDto } from './jobrun.dto';
import { JobRunStatus } from 'src/constants/enums';
import { NotFoundException } from '@nestjs/common';

describe('JobRunController', () => {
  let controller: JobRunController;
  let jobRunService: JobRunService;

  const mockJobRunService = {
    getJobAllRuns: jest.fn(),
    getJobRun: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobRunController],
      providers: [
        {
          provide: JobRunService,
          useValue: mockJobRunService,
        },
      ],
    }).compile();

    controller = module.get<JobRunController>(JobRunController);
    jobRunService = module.get<JobRunService>(JobRunService);
  });

  it('should return paginated job runs with default parameters', async () => {
    const mockResponse = { data: [], total: 0 };
    mockJobRunService.getJobAllRuns.mockResolvedValueOnce(mockResponse);

    const result = await controller.getJobRuns(1, 10, 'start_time', 'ASC', {});

    expect(mockJobRunService.getJobAllRuns).toHaveBeenCalledWith(
      1, 
      10, 
      'start_time', 
      'ASC', 
      {},
    );
    expect(result).toEqual(mockResponse);
  });

  it('should return paginated job runs with default parameters for page 2 and desc', async () => {
    const mockResponse = { data: [], total: 0 };
    mockJobRunService.getJobAllRuns.mockResolvedValueOnce(mockResponse);

    const result = await controller.getJobRuns(2, 100, undefined, 'DESC', {});

    expect(mockJobRunService.getJobAllRuns).toHaveBeenCalled();
    expect(result).toEqual(mockResponse);
  });

  it('should return paginated job runs with default parameters for page 2 , desc and no limit', async () => {
    const mockResponse = { data: [], total: 0 };
    mockJobRunService.getJobAllRuns.mockResolvedValueOnce(mockResponse);

    const result = await controller.getJobRuns(2, undefined, undefined, 'DESC', {});

    expect(mockJobRunService.getJobAllRuns).toHaveBeenCalled();
    expect(result).toEqual(mockResponse);
  });

  it('should return paginated job runs with default parameters with no filter', async () => {
    const mockResponse = { data: [], total: 0 };
    mockJobRunService.getJobAllRuns.mockResolvedValueOnce(mockResponse);

    const result = await controller.getJobRuns(undefined, undefined, undefined, undefined, undefined);

    expect(mockJobRunService.getJobAllRuns).toHaveBeenCalled();
    expect(result).toEqual(mockResponse);
  });

  it('should return paginated job runs with custom parameters', async () => {
    const mockResponse = { data: [{ id: 1 }], total: 1 };
    mockJobRunService.getJobAllRuns.mockResolvedValue(mockResponse);

    const customFilter: JobRunFilterDto = { status: JobRunStatus.Completed };
    const result = await controller.getJobRuns(
      3, 
      10, 
      'end_time', 
      'DESC', 
      customFilter, 
    );

    expect(mockJobRunService.getJobAllRuns).toHaveBeenCalledWith(
      3,
      10,
      'end_time',
      'DESC',
      customFilter,
    );
    expect(result).toEqual(mockResponse);
  });

  it('should handle missing or invalid query parameters', async () => {
    const mockResponse = { data: [], total: 0 };
    mockJobRunService.getJobAllRuns.mockResolvedValue(mockResponse);

    const result = await controller.getJobRuns(
      null, 
      undefined, 
      '', 
      'INVALID' as 'ASC' | 'DESC',
      {}, 
    );

    expect(mockJobRunService.getJobAllRuns).toHaveBeenCalledWith(
      1, 
      10, 
      'start_time',
      'ASC', 
      {},
    );
    expect(result).toEqual(mockResponse);
  });

  it('should handle an empty filter', async () => {
    const mockResponse = { data: [], total: 0 };
    mockJobRunService.getJobAllRuns.mockResolvedValue(mockResponse);

    const result = await controller.getJobRuns(1, 10, 'start_time', 'ASC', {});

    expect(mockJobRunService.getJobAllRuns).toHaveBeenCalledWith(
      1,
      10,
      'start_time',
      'ASC',
      {}, // empty filter
    );
    expect(result).toEqual(mockResponse);
  });

  it('should return a job run by its ID', async () => {
    const jobRunId = '123';
    const mockJobRun = [
      {
        id: jobRunId,
        jobType: 'Backup',
        status: 'Completed',
        startTime: new Date(),
        endTime: new Date(),
      },
    ];

    mockJobRunService.getJobRun.mockResolvedValue(mockJobRun);

    const result = await controller.getJobById(jobRunId);

    expect(mockJobRunService.getJobRun).toHaveBeenCalledWith({ where: { id: jobRunId } });
    expect(result).toEqual(mockJobRun);
  });
});
