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
 *   RedisService.getJobManagerContext — jobContext.cleanup()
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

describe('Component: cleanupJobContext (CommonActivityService)', () => {
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

  it('H1 — Job context is fetched from Redis and jobContext.cleanup() is called — all Redis keys for the job are removed cleanly', async () => {
    const jobCtx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    await service.cleanupJobContext('job-c01');

    expect(jobCtx.cleanup).toHaveBeenCalledTimes(1);
  });

  it('N1 — jobContext.cleanup() throws — verify the error is caught, wrapped as "Error while cleaning up the job context", and re-thrown', async () => {
    const jobCtx = makeJobContext();
    jobCtx.cleanup.mockRejectedValue(new Error('Redis pipeline failed'));
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    await expect(service.cleanupJobContext('job-c02')).rejects.toThrow(
      'Error while cleaning up the job context',
    );
  });
});
