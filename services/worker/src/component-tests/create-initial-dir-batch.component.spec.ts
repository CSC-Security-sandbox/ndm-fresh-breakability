import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { CommonTaskService } from '../activities/core/common/common-task.service';
import { AuthService } from '../auth/auth.service';
import { RedisService } from '../redis/redis.service';
import { WorkersConfig } from '../config/app.config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { calculateHash } from '../activities/utils/checksum-utils';

/**
 * Real classes wired:
 *   CommonTaskService → real `calculateHash` (from checksum-utils)
 *
 * Mocked boundaries:
 *   RedisService.getJobManagerContext → returns a fake JobManagerContext with setBatchDir
 */

const mockLogger = {
  log: jest.fn(), error: jest.fn(), warn: jest.fn(),
  debug: jest.fn(), verbose: jest.fn(), setContext: jest.fn(),
};
const mockLoggerFactory: LoggerFactory = { create: jest.fn().mockReturnValue(mockLogger) } as any;

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, any> = {
      'worker.workerId':          'worker-1',
      'worker.maxRetryCount':     3,
      'worker.groupSize':         100,
      'worker.commandsInTask':    3,
      'worker.maxCmdStreamLen':   5000,
      'temporal.address':         'localhost:7233',
      'worker.projectId':         'proj-abc',
      'keycloak': { baseUrl: 'http://keycloak', realm: 'ndm', workerSecret: 'secret' },
    };
    return map[key];
  }),
};

const mockHttpService = {
  post: jest.fn().mockReturnValue(
    of({ data: { access_token: 'token-abc', expires_in: 300 } }),
  ),
};

describe('Component: createInitialDirBatch (CommonTaskService)', () => {
  let service: CommonTaskService;
  let mockRedisService: { getJobManagerContext: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    new WorkersConfig(mockConfigService as any);

    mockRedisService = { getJobManagerContext: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonTaskService,
        AuthService,
        { provide: ConfigService,  useValue: mockConfigService },
        { provide: LoggerFactory,  useValue: mockLoggerFactory },
        { provide: HttpService,    useValue: mockHttpService },
        { provide: RedisService,   useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<CommonTaskService>(CommonTaskService);
  });

  it('H1 — List of root directories to scan is provided — verify calculateHash produces a deterministic batch ID, the directories are stored in Redis via setBatchDir, and the batch ID is returned', async () => {
    const dirs = ['/mnt/src/data', '/mnt/src/logs'];
    const ctx  = { setBatchDir: jest.fn().mockResolvedValue(undefined), jobConfig: {} };
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);

    const batchId = await service.createInitialDirBatch({ dirsToScan: dirs, jobRunId: 'job-b01' });

    const expectedId = calculateHash(dirs);
    expect(batchId).toBe(expectedId);
    expect(ctx.setBatchDir).toHaveBeenCalledWith(expectedId, dirs);
  });

  it('H2 — Same list of directories called twice — verify the same batch ID is produced both times (hash is deterministic), confirming idempotent batch creation', async () => {
    const dirs = ['/mnt/src/data', '/mnt/src/logs'];
    const ctx  = { setBatchDir: jest.fn().mockResolvedValue(undefined), jobConfig: {} };
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);

    const id1 = await service.createInitialDirBatch({ dirsToScan: dirs, jobRunId: 'job-b02' });
    const id2 = await service.createInitialDirBatch({ dirsToScan: dirs, jobRunId: 'job-b02' });

    expect(id1).toBe(id2);
  });
});
