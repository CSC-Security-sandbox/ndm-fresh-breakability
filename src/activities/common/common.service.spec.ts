import { Test, TestingModule } from '@nestjs/testing';

import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import { JobRunStatus } from '../discovery/enums';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import { JobStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { CommonActivityService } from './common.service';

jest.mock('axios');

describe('CommonActivityService', () => {
  let service: CommonActivityService;
  let redisService: RedisService;
  let configService: ConfigService;
  let logger: Logger;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonActivityService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key) => {
              const config = {
                'worker.workerId': 'test-worker-id',
                'worker.workerJobServiceUrl': 'http://worker-service',
                'worker.workerReportServiceUrl': 'http://report-service',
              };
              return config[key];
            }),
          },
        },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            getJobContext: jest.fn(),
            setJobContext: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CommonActivityService>(CommonActivityService);
    redisService = module.get<RedisService>(RedisService);
    configService = module.get<ConfigService>(ConfigService);
    logger = module.get<Logger>(Logger);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('updateLastEntry', () => {
    it('should update last entry and return success message', async () => {
      const traceId = 'test-trace';
      const jobContextMock = {
        appendToFileList: jest.fn().mockResolvedValue('file-id'),
        errorsInfo: {},
      };
      jest.spyOn(redisService,'getJobContext').mockResolvedValue(jobContextMock as any);

      const result = await service.updateLastEntry(traceId);
      expect(result).toEqual({ message: `Job completed for job id: ${traceId}` });
      expect(redisService.setJobContext).toHaveBeenCalledWith(traceId, jobContextMock);
    });
  });

  describe('updateStatus', () => {
    it('should update job status successfully', async () => {
      (axios.patch as jest.Mock).mockResolvedValue({});
      const result = await service.updateStatus({ jobRunId: 'job-1', status: JobRunStatus.Running });
      expect(result).toEqual({ message: 'Job status updated for job id: job-1' });
    });
  });

  describe('generateJobsReport', () => {
    it('should trigger job report generation successfully', async () => {
      (axios.post as jest.Mock).mockResolvedValue({});
      const result = await service.generateJobsReport('job-1');
      expect(result).toEqual({ message: 'Triggering generateJobsReport successful for job id: job-1' });
    });
  });

  describe('updateJobErrorStatus', () => {
    it('should update job status to errored and update last entry', async () => {
      jest.spyOn(service, 'updateStatus').mockResolvedValue(undefined);
      jest.spyOn(service, 'updateLastEntry').mockResolvedValue(undefined);
      await service.updateJobErrorStatus('job-1');
      expect(service.updateStatus).toHaveBeenCalledWith({ jobRunId: 'job-1', status: JobRunStatus.Errored });
      expect(service.updateLastEntry).toHaveBeenCalledWith('job-1');
    });
  });

  describe('getJobState', () => {
    it('should return job state', async () => {
      const jobStateMock = { getJobState: jest.fn().mockResolvedValue('job-state') };
      jest.spyOn(redisService,'getJobContext').mockResolvedValue(jobStateMock as any);
      const result = await service.getJobState('trace-1');
      expect(result).toEqual('job-state');
    });
  });

  describe('setJobState', () => {
    it('should set job state', async () => {
      const jobContextMock = { jobState: null };
      jest.spyOn(redisService,'getJobContext').mockResolvedValue(jobContextMock as any);
      await service.setJobState('trace-1', new JobState([], 1, 2, [], JobStatus.Completed, []));
      expect(redisService.setJobContext).toHaveBeenCalled();
    });
  });
});
