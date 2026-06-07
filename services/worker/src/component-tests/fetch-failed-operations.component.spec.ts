import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import * as path from 'path';
import { FetchFailedOperationsActivity } from '../activities/core/retry/fetch-failed-operations.activity';
import { AuthService } from '../auth/auth.service';
import { RedisService } from '../redis/redis.service';
import { WorkersConfig } from '../config/app.config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { RetryableError } from '../errors/errors.types';
import { calculateHash } from '../activities/utils/checksum-utils';
import { basePrefix } from '../activities/utils/utils';

jest.mock('axios');
import axios from 'axios';

/**
 * Real class chain:
 *   FetchFailedOperationsActivity → AuthService → HttpService (Keycloak)
 *                                 → real groupByParentDirectory (path.dirname grouping)
 *                                 → real calculateHash (checksum-utils)
 *
 * Mocked boundaries:
 *   HttpService.post   — Keycloak token
 *   axios.get          — jobs-service failed-operations API
 *   RedisService       — getJobManagerContext
 */

const mockLogger = {
  log: jest.fn(), error: jest.fn(), warn: jest.fn(),
  debug: jest.fn(), verbose: jest.fn(), setContext: jest.fn(),
};
const mockLoggerFactory: LoggerFactory = { create: jest.fn().mockReturnValue(mockLogger) } as any;

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, any> = {
      'worker.connection.workerJobServiceUrl': 'http://jobs-service',
      'worker.retryFetchBatchSize':            4000,
      'worker.projectId':                      'proj-abc',
      'keycloak': { baseUrl: 'http://keycloak', realm: 'ndm', workerSecret: 'secret' },
    };
    return map[key];
  }),
};

const mockHttpService = {
  post: jest.fn().mockReturnValue(
    of({ data: { access_token: 'retry-token', expires_in: 300 } }),
  ),
};

const JOB_RUN_ID  = 'retry-job-01';
const ORIG_JOB_ID = 'orig-job-01';

function makeJobContext(extra: Partial<any> = {}) {
  return {
    jobConfig: {
      sourceFileServer: {
        pathId:    'src-path-id',
        protocols: [{ type: 'NFS' }],
      },
      destinationFileServer: { pathId: 'dst-path-id' },
      sourceDirectoryPath:      '/src/data',
      destinationDirectoryPath: '/dst/data',
      options: {
        skipsFilesModifiedInLast: '24h',
        excludeFilePattern:        '*.tmp,*.bak',
      },
    },
    getRetryCursor: jest.fn().mockResolvedValue(null),
    setRetryCursor: jest.fn().mockResolvedValue(undefined),
    setRetryBatch:  jest.fn().mockResolvedValue(undefined),
    ...extra,
  };
}

function makeOps(paths: string[]) {
  return paths.map((p, i) => ({ fPath: p, operationId: `op-${i}` }));
}

function apiResponse(operations: any[], nextCursor: string | null) {
  return {
    data: {
      data: {
        items: { data: operations, nextCursor },
      },
    },
  };
}

describe('Component: FetchFailedOperationsActivity', () => {
  let service: FetchFailedOperationsActivity;
  let mockRedisService: { getJobManagerContext: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    new WorkersConfig(mockConfigService as any);

    mockRedisService = { getJobManagerContext: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FetchFailedOperationsActivity, // REAL
        AuthService,                   // REAL
        { provide: ConfigService,  useValue: mockConfigService },
        { provide: LoggerFactory,  useValue: mockLoggerFactory },
        { provide: HttpService,    useValue: mockHttpService },
        { provide: RedisService,   useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<FetchFailedOperationsActivity>(FetchFailedOperationsActivity);
  });

  it('H1 — groups ops by parent dir via real path.dirname, stores each group in Redis, returns opsBatchIds', async () => {
    const ops = makeOps(['/parent/a/file1.txt', '/parent/a/file2.txt', '/parent/b/file3.txt']);
    const ctx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);
    (axios.get as jest.Mock).mockResolvedValue(apiResponse(ops, null));

    const result = await service.fetchFailedOperations({ jobRunId: JOB_RUN_ID, originalJobRunId: ORIG_JOB_ID });

    // Real AuthService fetched token from mocked Keycloak
    expect(mockHttpService.post).toHaveBeenCalledWith(
      expect.stringContaining('/protocol/openid-connect/token'),
      expect.any(String),
      expect.any(Object),
    );
    // axios.get called with Bearer token
    expect(axios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer retry-token',
        }),
      }),
    );
    expect(result.hasMore).toBe(false);
    expect(result.opsBatchIds).toHaveLength(2);
    expect(ctx.setRetryBatch).toHaveBeenCalledTimes(2);

    const groupA = ops.filter(o => path.dirname(o.fPath) === '/parent/a').map(o => o.fPath);
    const groupB = ops.filter(o => path.dirname(o.fPath) === '/parent/b').map(o => o.fPath);
    expect(result.opsBatchIds).toEqual(expect.arrayContaining([calculateHash(groupA), calculateHash(groupB)]));
  });

  it('H2 — non-null nextCursor → hasMore:true and setRetryCursor called with new cursor', async () => {
    const ctx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);
    (axios.get as jest.Mock).mockResolvedValue(apiResponse(makeOps(['/src/dir1/f.txt']), 'cursor-abc'));

    const result = await service.fetchFailedOperations({ jobRunId: JOB_RUN_ID, originalJobRunId: ORIG_JOB_ID });

    expect(result.hasMore).toBe(true);
    expect(ctx.setRetryCursor).toHaveBeenCalledWith('cursor-abc');
  });

  it('H3 — settings.sourcePrefix, targetPrefix, skipFile, excludePatterns, isSMB derived correctly', async () => {
    const ctx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);
    (axios.get as jest.Mock).mockResolvedValue(apiResponse(makeOps(['/src/dir/file.txt']), null));

    const result = await service.fetchFailedOperations({ jobRunId: JOB_RUN_ID, originalJobRunId: ORIG_JOB_ID });

    expect(result.settings.sourcePrefix).toBe(basePrefix(JOB_RUN_ID, 'src-path-id', '/src/data'));
    expect(result.settings.targetPrefix).toBe(basePrefix(JOB_RUN_ID, 'dst-path-id', '/dst/data'));
    expect(result.settings.skipFile).toBe('24h');
    expect(result.settings.excludePatterns).toEqual(['*.tmp', '*.bak']);
    expect(result.settings.isSMB).toBe(false);
  });

  it('H4 — API returns zero operations → { opsBatchIds: [], hasMore: false } without any Redis writes', async () => {
    const ctx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);
    (axios.get as jest.Mock).mockResolvedValue(apiResponse([], null));

    const result = await service.fetchFailedOperations({ jobRunId: JOB_RUN_ID, originalJobRunId: ORIG_JOB_ID });

    expect(result).toMatchObject({ opsBatchIds: [], hasMore: false });
    expect(result.settings).toBeDefined();
    expect(result.settings.sourcePrefix).toBeDefined();
    expect(ctx.setRetryBatch).not.toHaveBeenCalled();
  });

  it('N1 — Keycloak returns no access_token → RetryableError thrown before axios.get', async () => {
    mockHttpService.post.mockReturnValue(of({ data: { access_token: null, expires_in: 300 } }));
    const ctx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);

    let caughtError: any;
    try {
      await service.fetchFailedOperations({ jobRunId: JOB_RUN_ID, originalJobRunId: ORIG_JOB_ID });
    } catch (err) {
      caughtError = err;
    }
    expect(caughtError).toBeInstanceOf(RetryableError);
    expect(caughtError.message).toContain('Failed to get access token');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('N2 — axios.get HTTP 404 → RetryableError wrapping HTTP status', async () => {
    const ctx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);
    const axiosError: any = new Error('Request failed with status 404');
    axiosError.isAxiosError = true;
    axiosError.response     = { status: 404, data: { message: 'Not found' } };
    (axios.get as jest.Mock).mockRejectedValue(axiosError);
    (axios.isAxiosError as unknown as jest.Mock) = jest.fn().mockReturnValue(true);

    await expect(
      service.fetchFailedOperations({ jobRunId: JOB_RUN_ID, originalJobRunId: ORIG_JOB_ID }),
    ).rejects.toBeInstanceOf(RetryableError);
  });

  it('N3 — network failure (ECONNREFUSED) → wrapped as RetryableError', async () => {
    const ctx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);
    const netError: any = new Error('connect ECONNREFUSED');
    netError.isAxiosError = true;
    netError.response     = undefined;
    (axios.get as jest.Mock).mockRejectedValue(netError);
    (axios.isAxiosError as unknown as jest.Mock) = jest.fn().mockReturnValue(true);

    await expect(
      service.fetchFailedOperations({ jobRunId: JOB_RUN_ID, originalJobRunId: ORIG_JOB_ID }),
    ).rejects.toBeInstanceOf(RetryableError);
  });
});
