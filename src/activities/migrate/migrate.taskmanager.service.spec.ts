import { Test, TestingModule } from '@nestjs/testing';
import { MigrationTaskService } from './migrate.taskmanager.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import axios from 'axios';
import { CutOverStatus } from './migrate.type';
import { HttpService } from '@nestjs/axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('MigrationTaskService', () => {
  let service: MigrationTaskService;
  let logger: Logger;
  let redisService: RedisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MigrationTaskService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), update: jest.fn(), patch: jest.fn(), put: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config = {
                'worker.workerId': 'test-worker-id',
                'worker.workerJobServiceUrl': 'http://worker-job-service',
                'worker.workerReportServiceUrl': 'http://report-service',
                'worker.fetchTaskBatchMigration': 5,
                'worker.scanTaskDirBatch': 500,
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

    service = module.get<MigrationTaskService>(MigrationTaskService);
    logger = module.get<Logger>(Logger);
    redisService = module.get<RedisService>(RedisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('publishScanTask', () => {
    it('should handle errors during task publishing', async () => {
      const jobRunId = 'test-job-run-id';
      jest
        .spyOn(redisService, 'getJobContext')
        .mockRejectedValue(new Error('Redis error'));

      const result = await service.publishScanTask({ jobRunId });

      expect(logger.error).toHaveBeenCalledWith(
        `[${jobRunId}] Error in publishing task: Redis error`,
      );
      expect(result).toEqual({
        jobRunId,
        status: 'error',
        message: `Failed to publish task for Job run id ${jobRunId} : Error: Redis error`,
      });
    });
  });

  describe('fetchScanTask', () => {
    it('should handle errors during task fetching', async () => {
      const jobRunId = 'test-job-run-id';
      jest
        .spyOn(redisService, 'getJobContext')
        .mockRejectedValue(new Error('Redis error'));

      const result = await service.fetchScanTask({ jobRunId });

      expect(logger.error).toHaveBeenCalledWith(
        `[${jobRunId}] Failed to fetch the task: Error: Redis error`,
      );
      expect(result).toEqual({ tasks: [] });
    });
  });

  describe('generateCOCReport', () => {
    it('should trigger COC report generation successfully', async () => {
      const jobRunId = 'test-job-run-id';
      mockedAxios.get.mockResolvedValue({});

      const result = await service.generateCOCReport(jobRunId);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'http://report-service/api/v1/report/job-run/coc-report/test-job-run-id',
      );
      expect(result).toEqual({
        message:
          'Triggering generateCOCReport successful for job id: test-job-run-id',
      });
    });

    it('should handle errors during COC report generation', async () => {
      const jobRunId = 'test-job-run-id';
      mockedAxios.get.mockRejectedValue(new Error('Axios error'));

      const result = await service.generateCOCReport(jobRunId);

      expect(logger.error).toHaveBeenCalledWith(
        `[${jobRunId}] Failed to Trigger generateCOCReport: Error: Axios error | for url : http://report-service/api/v1/report/job-run/coc-report/test-job-run-id`,
      );
      expect(result).toEqual({
        message:
          'Error while Triggering generateCOCReport for the job id : test-job-run-id',
      });
    });
  });

  describe('updateCutOverStatus', () => {
    it('should update cutover status successfully', async () => {
      const jobRunId = 'test-job-run-id';
      const status = 'COMPLETED';
      mockedAxios.put.mockResolvedValue({});

      const result = await service.updateCutOverStatus({
        jobRunId,
        status: 'COMPLETED' as CutOverStatus,
      });

      expect(mockedAxios.put).toHaveBeenCalledWith(
        `http://worker-job-service/api/v1/job-run/cutover/${jobRunId}/${status}`,
      );
      expect(result).toEqual({
        message: 'Job status updated for job id: test-job-run-id',
      });
    });

    it('should handle errors during cutover status update', async () => {
      const jobRunId = 'test-job-run-id';
      const status = 'COMPLETED';
      mockedAxios.put.mockRejectedValue(new Error('Axios error'));

      const result = await service.updateCutOverStatus({
        jobRunId,
        status: status as CutOverStatus,
      });

      expect(logger.error).toHaveBeenCalledWith(
        `[${jobRunId}] Failed to update status: Error: Axios error`,
      );
      expect(result).toEqual({
        message:
          'Error while updating the status of the job id : test-job-run-id',
      });
    });

    describe('publishScanTask', () => {
      it('should handle errors during task publishing', async () => {
        const jobRunId = 'test-job-run-id';
        jest
          .spyOn(redisService, 'getJobContext')
          .mockRejectedValue(new Error('Redis error'));

        const result = await service.publishScanTask({ jobRunId });

        expect(logger.error).toHaveBeenCalledWith(
          `[${jobRunId}] Error in publishing task: Redis error`,
        );
        expect(result).toEqual({
          jobRunId,
          status: 'error',
          message: `Failed to publish task for Job run id ${jobRunId} : Error: Redis error`,
        });
      });

      describe('MigrationTaskService', () => {
        let service: MigrationTaskService;
        let logger: Logger;

        beforeEach(async () => {
          const module: TestingModule = await Test.createTestingModule({
            providers: [
              MigrationTaskService,
              { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), update: jest.fn(), patch: jest.fn(), put: jest.fn() } },
              {
                provide: ConfigService,
                useValue: {
                  get: jest.fn((key: string) => {
                    const config = {
                      'worker.workerId': 'test-worker-id',
                      'worker.workerJobServiceUrl': 'http://worker-job-service',
                      'worker.workerReportServiceUrl': 'http://report-service',
                      'worker.fetchTaskBatchMigration': 5,
                      'worker.scanTaskDirBatch': 500,
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

          service = module.get<MigrationTaskService>(MigrationTaskService);
          logger = module.get<Logger>(Logger);
          redisService = module.get<RedisService>(RedisService);
        });

        it('should be defined', () => {
          expect(service).toBeDefined();
        });

        describe('generateCOCReport', () => {
          it('should trigger COC report generation successfully', async () => {
            const jobRunId = 'test-job-run-id';
            mockedAxios.get.mockResolvedValue({});

            const result = await service.generateCOCReport(jobRunId);

            expect(mockedAxios.get).toHaveBeenCalledWith(
              'http://report-service/api/v1/report/job-run/coc-report/test-job-run-id',
            );
            expect(result).toEqual({
              message:
                'Triggering generateCOCReport successful for job id: test-job-run-id',
            });
          });

          it('should handle errors during COC report generation', async () => {
            const jobRunId = 'test-job-run-id';
            mockedAxios.get.mockRejectedValue(new Error('Axios error'));

            const result = await service.generateCOCReport(jobRunId);

            expect(logger.error).toHaveBeenCalledWith(
              `[${jobRunId}] Failed to Trigger generateCOCReport: Error: Axios error | for url : http://report-service/api/v1/report/job-run/coc-report/test-job-run-id`,
            );
            expect(result).toEqual({
              message:
                'Error while Triggering generateCOCReport for the job id : test-job-run-id',
            });
          });
        });
      });
    });
  });
});
