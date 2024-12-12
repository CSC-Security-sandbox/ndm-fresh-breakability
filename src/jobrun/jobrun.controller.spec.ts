import { Test, TestingModule } from '@nestjs/testing';
import { JobRunService } from './jobrun.service';
import { JobRunController } from './jobrun.controller';
import { JobRunPageDto } from './dto/jobrunpage.dto';

describe('JobRunController', () => {
  let controller: JobRunController;
  let service: JobRunService;

  const mockJobRunService = {
    findAllJobRuns: jest.fn(),
    getJobRun: jest.fn(),
    scheduleAJob: jest.fn(),
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
    service = module.get<JobRunService>(JobRunService);
  });

  describe('getJobRuns', () => {
    it('should return a list of job runs', async () => {
      const jobRuns = [{ id: '1', name: 'Job 1' }];
      mockJobRunService.findAllJobRuns.mockResolvedValue(jobRuns);

      const jobRunPageDto = new JobRunPageDto();
      const result = await controller.getJobRuns(jobRunPageDto);

      expect(result).toEqual(jobRuns);
      expect(mockJobRunService.findAllJobRuns).toHaveBeenCalledWith(jobRunPageDto);
    });
  });

  describe('getJobById', () => {
    it('should return a job run by ID', async () => {
      const jobRun = { id: '1', name: 'Job 1' };
      mockJobRunService.getJobRun.mockResolvedValue([jobRun]);

      const result = await controller.getJobById('1');

      expect(result).toEqual([jobRun]);
      expect(mockJobRunService.getJobRun).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });
  });

  describe('handleCron', () => {
    it('should call the scheduleAJob method on the service', async () => {
      mockJobRunService.scheduleAJob.mockResolvedValue(undefined);

      await controller.handleCron();

      expect(mockJobRunService.scheduleAJob).toHaveBeenCalled();
    });
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
