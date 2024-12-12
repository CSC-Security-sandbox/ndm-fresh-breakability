import { Test, TestingModule } from '@nestjs/testing';
import { JobRunController } from './jobrun.controller';
import { JobRunService } from './jobrun.service';
import { JobRunEntity } from './../entities/jobrun.entity';
import { JobRunDto, JobRunFilterDto } from './jobrun.dto';
import { JobRunStatus } from 'src/constants/enums';

describe('JobRunController', () => {
  let jobRunController: JobRunController;
  let jobRunService: JobRunService;

  const mockJobRunService = {
    createJobRun: jest.fn(),
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

    jobRunController = module.get<JobRunController>(JobRunController);
    jobRunService = module.get<JobRunService>(JobRunService);
  });

  it('should be defined', () => {
    expect(jobRunController).toBeDefined();
  });

  describe('getJobRuns', () => {
    it('should return paginated, sorted, and filtered job runs', async () => {
      const page = 1;
      const limit = 10;
      const sortField = 'start_time';
      const sortOrder = 'ASC';
      const filter: JobRunFilterDto = { status: JobRunStatus.Running };
      const jobRuns = [
        { id: 'jobrun-id-1', status: 'Active' },
        { id: 'jobrun-id-2', status: 'Active' },
      ];

      mockJobRunService.getJobAllRuns.mockResolvedValue(jobRuns);

      const result = await jobRunController.getJobRuns(page, limit, sortField, sortOrder, filter);

      expect(result).toEqual(jobRuns);
      expect(mockJobRunService.getJobAllRuns).toHaveBeenCalledWith(page, limit, sortField, sortOrder, filter);
    });
  });

  describe('getJobById', () => {
    it('should return a job run by ID', async () => {
      const id = 'jobrun-id-123';
      const jobRun = [{ id: 'jobrun-id-123', status: 'Active' }];

      mockJobRunService.getJobRun.mockResolvedValue(jobRun);

      const result = await jobRunController.getJobById(id);

      expect(result).toEqual(jobRun);
      expect(mockJobRunService.getJobRun).toHaveBeenCalledWith({ where: { id } });
    });

    it('should return an empty array if job run not found', async () => {
      const id = 'nonexistent-id';

      mockJobRunService.getJobRun.mockResolvedValue([]);

      const result = await jobRunController.getJobById(id);

      expect(result).toEqual([]);
      expect(mockJobRunService.getJobRun).toHaveBeenCalledWith({ where: { id } });
    });
  });
});
