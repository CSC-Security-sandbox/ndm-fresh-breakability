import { Test, TestingModule } from '@nestjs/testing';
import { JobRunService } from './jobrun.service';
import { JobRunController } from './jobrun.controller';
import { JobRunPageDto } from './dto/jobrunpage.dto';
import { JobRunInitService } from './jobrun.init.service';
import { BadRequestException } from '@nestjs/common';
import { CutOverStatus } from 'src/constants/enums';

describe('JobRunController', () => {
  let controller: JobRunController;
  let service: JobRunService;

  const mockJobRunService = {
    findAllJobRuns: jest.fn(),
    getJobRun: jest.fn(),
    scheduleAJob: jest.fn(),
    getJobAllRuns: jest.fn(),
    cutOverApproval: jest.fn(),
    getErrorOverview: jest.fn()
  };
  

  const mockJobRunInitService = {
    findAllJobRuns: jest.fn(),
    getJobRun: jest.fn(),
    scheduleAJob: jest.fn(),
    getJobAllRuns: jest.fn()
  };
  

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobRunController],
      providers: [
        {
          provide: JobRunService,
          useValue: mockJobRunService,
        },
        {
          provide: JobRunInitService,
          useValue: mockJobRunInitService,
        },

      ],
    }).compile();

    controller = module.get<JobRunController>(JobRunController);
    service = module.get<JobRunService>(JobRunService);
  });

  describe('getJobRuns', () => {
    it('should return a list of job runs', async () => {
      const jobRuns = [{ id: '1', name: 'Job 1' }];
      mockJobRunService.getJobAllRuns.mockResolvedValue(jobRuns);

      const jobRunPageDto = new JobRunPageDto();
      const result = await controller.getJobRuns(jobRunPageDto);

      expect(result).toEqual(jobRuns);
      expect(mockJobRunService.getJobAllRuns).toHaveBeenCalledWith(jobRunPageDto);
    });
  });

  describe('getJobById', () => {
    it('should return a job run by ID', async () => {
      const jobRun = { id: '1', name: 'Job 1' };
      mockJobRunService.getJobRun.mockResolvedValue([jobRun]);

      const result = await controller.getJobById('1');

      expect(result).toEqual([jobRun]);
      expect(mockJobRunService.getJobRun).toHaveBeenCalledWith("1");
    });
  });

  describe('handleCron', () => {
    it('should call the scheduleAJob method on the service', async () => {
      mockJobRunService.scheduleAJob.mockResolvedValue(undefined);

      await controller.handleCron();

      expect(mockJobRunInitService.scheduleAJob).toHaveBeenCalled();
    });
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
  describe('cutoverApproval', () => {
    it('should handle errors thrown by jobRunService.cutOverApproval', async () => {
      const mockJobRunId = 'jobRunId';
      const mockStatus = CutOverStatus.REJECTED;

      jest.spyOn(service, 'cutOverApproval').mockRejectedValue(new Error('Test error'));

      await expect(controller.cutoverApproval(mockJobRunId, mockStatus)).rejects.toThrow('Test error');
      expect(service.cutOverApproval).toHaveBeenCalledWith(mockJobRunId, mockStatus);
    });
  });

  describe('getErrorOverview', () => {
    it('should call jobRunService.getErrorOverview with correct parameters', async () => {
      const mockJobRunId = 'jobRunId';
      const mockErrorOverview = { errorType: 'TypeError', count: 5 };

      jest.spyOn(service, 'getErrorOverview').mockResolvedValue(mockErrorOverview);

      const result = await controller.getErrorOverview(mockJobRunId);

      expect(result).toEqual(mockErrorOverview);
      expect(service.getErrorOverview).toHaveBeenCalledWith(mockJobRunId);
    });

    it('should handle errors thrown by jobRunService.getErrorOverview', async () => {
      const mockJobRunId = 'jobRunId';

      jest.spyOn(service, 'getErrorOverview').mockRejectedValue(new Error('Test error'));

      await expect(controller.getErrorOverview(mockJobRunId)).rejects.toThrow('Test error');
      expect(service.getErrorOverview).toHaveBeenCalledWith(mockJobRunId);
    });
  });
});
