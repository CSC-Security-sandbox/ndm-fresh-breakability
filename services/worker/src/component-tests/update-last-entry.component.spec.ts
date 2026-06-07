import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { CommonActivityService } from '../activities/common/common.service';
import { AuthService } from '../auth/auth.service';
import { RedisService } from '../redis/redis.service';
import { WorkersConfig } from '../config/app.config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

/**
 * Real classes wired:
 *   CommonActivityService → AuthService → HttpService (Keycloak)
 *
 * Mocked boundaries:
 *   RedisService.getJobManagerContext — jobContext methods for updateLastEntry
 */

const mockLogger = {
  log: jest.fn(), error: jest.fn(), warn: jest.fn(),
  debug: jest.fn(), verbose: jest.fn(), setContext: jest.fn(),
};
const mockLoggerFactory: LoggerFactory = {
  create: jest.fn().mockReturnValue(mockLogger),
} as any;

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, any> = {
      'worker.workerId':                          'worker-1',
      'worker.maxRetryCount':                     3,
      'worker.connection.workerJobServiceUrl':    'http://jobs-service',
      'worker.connection.workerReportServiceUrl': 'http://report-service',
      'worker.projectId':                         'proj-abc',
      'keycloak': { baseUrl: 'http://keycloak', realm: 'ndm', workerSecret: 'secret' },
    };
    return map[key];
  }),
};

const mockRedisService = { getJobManagerContext: jest.fn() };

function makeJobContext() {
  return {
    publishToFileStream:  jest.fn().mockResolvedValue(undefined),
    publishToTaskStream:  jest.fn().mockResolvedValue(undefined),
    publishToErrorStream: jest.fn().mockResolvedValue(undefined),
    cleanup:              jest.fn().mockResolvedValue(undefined),
  };
}

describe('Component: updateLastEntry (CommonActivityService)', () => {
  let service: CommonActivityService;

  beforeEach(async () => {
    jest.clearAllMocks();
    new WorkersConfig(mockConfigService as any);

    const mockHttpService = {
      post: jest.fn().mockReturnValue(
        of({ data: { access_token: 'token-abc', expires_in: 300 } }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonActivityService,
        AuthService,
        { provide: ConfigService,  useValue: mockConfigService },
        { provide: LoggerFactory,  useValue: mockLoggerFactory },
        { provide: HttpService,    useValue: mockHttpService },
        { provide: RedisService,   useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<CommonActivityService>(CommonActivityService);
  });

  it('H1 — Job context is fetched from Redis and dummy sentinel entries are published to all three streams — file stream, task stream, and error stream — in sequence, signalling the db-writer that the job is complete', async () => {
    const jobCtx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    const result = await service.updateLastEntry('job-e01');

    expect(jobCtx.publishToFileStream).toHaveBeenCalledTimes(1);
    expect(jobCtx.publishToTaskStream).toHaveBeenCalledTimes(1);
    expect(jobCtx.publishToErrorStream).toHaveBeenCalledTimes(1);
    expect(result.message).toContain('job-e01');
  });

  it('N1 — getJobManagerContext throws — verify the error is caught, wrapped as "Error while marking the job as completed", and re-thrown', async () => {
    mockRedisService.getJobManagerContext.mockRejectedValue(new Error('Redis connection lost'));

    await expect(service.updateLastEntry('job-e02')).rejects.toThrow(
      'Error while marking the job as completed',
    );
  });
});
