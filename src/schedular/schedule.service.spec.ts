import { Test, TestingModule } from '@nestjs/testing';
import { SchedularService } from './schedule.service';
import { JobConfigService } from '../jobconfig/jobconfig.service';
import { JobRunService } from '../jobrun/jobrun.service';
import { Between } from 'typeorm';

describe('SchedularService', () => {
  let schedularService: SchedularService;
  let jobConfigService: Partial<Record<keyof JobConfigService, jest.Mock>>;
  let jobRunService: Partial<Record<keyof JobRunService, jest.Mock>>;

  beforeEach(async () => {
    jobConfigService = {
      getJobs: jest.fn(),
    };

    jobRunService = {
      createJobRun: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedularService,
        { provide: JobConfigService, useValue: jobConfigService },
        { provide: JobRunService, useValue: jobRunService },
      ],
    }).compile();

    schedularService = module.get<SchedularService>(SchedularService);
  });

  it('should be defined', () => {
    expect(schedularService).toBeDefined();
  });

  describe('handleCron', () => {
    it('should create job runs for active jobs within the time window', async () => {
      // Mock current time
      const currentTime = new Date('2024-11-18T10:00:00.000Z');
      jest.spyOn(global, 'Date').mockImplementation(() => currentTime);

      const mockJobs = [
        { id: 'job-id-1', schedule_time: currentTime },
        { id: 'job-id-2', schedule_time: currentTime },
      ];

      const expectedJobRun = {
        id: expect.any(String),
        status: 'RUNNING',
        start_time: currentTime,
        end_time: null,
        iteration_number: 1,
        job_id: expect.any(String),
      };

      // Mock JobConfigService and JobRunService
      jobConfigService.getJobs.mockResolvedValue(mockJobs);
      jobRunService.createJobRun.mockResolvedValue(expectedJobRun);

      // Call handleCron
      const result = await schedularService.handleCron();

      // Assertions
      expect(result).toEqual('success');
      expect(jobConfigService.getJobs).toHaveBeenCalledWith({
        where: {
          status: 'Active',
          schedule_time: Between(
            new Date(currentTime.getTime() - 5 * 60 * 1000),
            new Date(currentTime.getTime() + 5 * 60 * 1000),
          ),
        },
      });
      expect(jobRunService.createJobRun).toHaveBeenCalledTimes(2);
      expect(jobRunService.createJobRun).toHaveBeenCalledWith(
        expect.objectContaining({ job_id: 'job-id-1', status: 'RUNNING' }),
      );
      expect(jobRunService.createJobRun).toHaveBeenCalledWith(
        expect.objectContaining({ job_id: 'job-id-2', status: 'RUNNING' }),
      );
    });

    it('should log a message for each created job run', async () => {
      const loggerSpy = jest.spyOn(schedularService['logger'], 'log');

      const currentTime = new Date('2024-11-18T10:00:00.000Z');
      jest.spyOn(global, 'Date').mockImplementation(() => currentTime);

      const mockJobs = [{ id: 'job-id-1', schedule_time: currentTime }];
      jobConfigService.getJobs.mockResolvedValue(mockJobs);
      jobRunService.createJobRun.mockResolvedValue({});

      await schedularService.handleCron();

      expect(loggerSpy).toHaveBeenCalledWith(
        `Job run created for job ID: job-id-1 at ${currentTime}`,
      );
    });

    it('should return "success" even if no jobs are found', async () => {
      jobConfigService.getJobs.mockResolvedValue([]);
      const result = await schedularService.handleCron();

      expect(result).toEqual('success');
      expect(jobRunService.createJobRun).not.toHaveBeenCalled();
    });

    it('should throw an error if creating a job run fails', async () => {
      const currentTime = new Date('2024-11-18T10:00:00.000Z');
      jest.spyOn(global, 'Date').mockImplementation(() => currentTime);

      const mockJobs = [{ id: 'job-id-1', schedule_time: currentTime }];
      jobConfigService.getJobs.mockResolvedValue(mockJobs);
      jobRunService.createJobRun.mockRejectedValue(new Error('Database Error'));

      await expect(schedularService.handleCron()).rejects.toThrow('Database Error');
      expect(jobRunService.createJobRun).toHaveBeenCalledWith(
        expect.objectContaining({ job_id: 'job-id-1' }),
      );
    });
  });
});
