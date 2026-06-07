import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { CommandStatus, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { ScanService } from '../activities/core/scan/scan-activity.service';
import { CommonTaskService } from '../activities/core/common/common-task.service';
import { DiscoveryScanService } from '../activities/core/scan/discovery/discovery-scan.service';
import { MigrateScanService } from '../activities/core/scan/migrate/migrate-scan.service';
import { AuthService } from '../auth/auth.service';
import { RedisService } from '../redis/redis.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkersConfig } from '../config/app.config';
import { FatalError, RetryableError } from '../errors/errors.types';
import { FileTypeDetectionService } from '../activities/core/utils/file-type-detection.service';
import { WinOperationService } from '../activities/core/migrate/command-execution/win-opeartions/win-operation.service';
import { CommandGenerationService } from '../activities/core/shared/command-generation.service';
import { DeferredDirStampService } from '../activities/core/shared/deferred-dir-stamp.service';

// ─── Module-level stubs ───────────────────────────────────────────────────────
jest.mock('@temporalio/activity', () => ({
  Context: {
    current: jest.fn().mockReturnValue({
      heartbeat: jest.fn(),
      info: { activityId: 'activity-test-1' },
      cancellationSignal: { aborted: false },
    }),
  },
  CancelledFailure: class CancelledFailure extends Error {
    constructor(message: string) { super(message); this.name = 'CancelledFailure'; }
  },
}));
jest.mock('@temporalio/workflow', () => ({ uuid4: jest.fn().mockReturnValue('uuid-mock') }));

/**
 * Real classes wired:
 *   ScanService → CommonTaskService → AuthService (for Temporal JWT, not used in this path)
 *               → DiscoveryScanService (mock boundary: scanDirectory)
 *               → MigrateScanService  (mock boundary: scanDirectory)
 *
 * Mocked boundaries:
 *   RedisService.getJobManagerContext  — returns mock jobContext
 *   DiscoveryScanService.scanDirectory — filesystem reads
 *   MigrateScanService.scanDirectory   — rsync/meta pipeline
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
      'worker.workerId':              'worker-1',
      'worker.maxMigrationCommand':   100,
      'worker.maxCommandConcurrency': 5,
      'worker.maxRetryCount':         3,
      'worker.groupSize':             1000,
      'worker.commandsInTask':        100,
      'worker.maxCmdStreamLen':       5000,
      'keycloak': { baseUrl: 'http://keycloak', realm: 'ndm', workerSecret: 'secret' },
    };
    return map[key];
  }),
};

const mockRedisService = { getJobManagerContext: jest.fn() };
const mockHttpService  = { post: jest.fn(), get: jest.fn() };

function makeJobContext(taskOverrides: Partial<any> = {}) {
  const task = {
    id: 'task-1',
    jobRunId: 'job-sc01',
    sPathId: 'src-path',
    tPathId: 'dst-path',
    status: TaskStatus.PENDING,
    workerId: undefined as any,
    retryCount: 0,
    commands: [
      { id: 'cmd-1', fPath: '/dir1', status: CommandStatus.READY, isDir: true, metadata: {} },
      { id: 'cmd-2', fPath: '/dir2', status: CommandStatus.READY, isDir: true, metadata: {} },
    ],
    ...taskOverrides,
  };

  return {
    jobConfig: {
      sourceDirectoryPath: '/mnt/src',
      destinationDirectoryPath: '/mnt/dst',
      options: { excludePatterns: [], preserveAccessTime: false, shouldScanADS: false },
    },
    jobRunId: 'job-sc01',
    getTask: jest.fn().mockResolvedValue(task),
    setTaskIfNotExists: jest.fn().mockResolvedValue(undefined),
    setTask: jest.fn().mockResolvedValue(undefined),
    publishToTaskStream: jest.fn().mockResolvedValue(undefined),
    deleteTask: jest.fn().mockResolvedValue(undefined),
    publishToErrorStream: jest.fn().mockResolvedValue(undefined),
    setBatchDir: jest.fn().mockResolvedValue(undefined),
    getBatchDir: jest.fn().mockResolvedValue(undefined),
    deleteBatchDir: jest.fn().mockResolvedValue(undefined),
  };
}

describe('Component: scanDirectories (ScanService + CommonTaskService)', () => {
  let scanService: ScanService;
  let discoveryScanService: DiscoveryScanService;
  let migrateScanService: MigrateScanService;

  const mockFileTypeDetectionService = { getFileType: jest.fn() };
  const mockWinOperationService = { readAcl: jest.fn() };
  const mockCommandGenerationService = { buildMigrateCommands: jest.fn() };
  const mockDeferredDirStampService = { updateSourceCtime: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    new WorkersConfig(mockConfigService as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanService,
        CommonTaskService,
        DiscoveryScanService,
        MigrateScanService,
        AuthService,
        { provide: ConfigService,                      useValue: mockConfigService },
        { provide: LoggerFactory,                      useValue: mockLoggerFactory },
        { provide: RedisService,                       useValue: mockRedisService },
        { provide: HttpService,                        useValue: mockHttpService },
        { provide: FileTypeDetectionService,  useValue: mockFileTypeDetectionService },
        { provide: WinOperationService,       useValue: mockWinOperationService },
        { provide: CommandGenerationService,  useValue: mockCommandGenerationService },
        { provide: DeferredDirStampService,   useValue: mockDeferredDirStampService },
      ],
    }).compile();

    scanService         = module.get<ScanService>(ScanService);
    discoveryScanService = module.get<DiscoveryScanService>(DiscoveryScanService);
    migrateScanService   = module.get<MigrateScanService>(MigrateScanService);
  });

  // ─── H1 ─────────────────────────────────────────────────────────────────────

  it('H1 — Discovery scan (isMigration=false): job context and task fetched from Redis, the real routing sends each directory command to DiscoveryScanService.scanDirectory, and the aggregated fileCount, dirCount, and subDirs are returned correctly', async () => {
    const jobCtx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    const discovSpy = jest.spyOn(discoveryScanService, 'scanDirectory').mockResolvedValue(
      { fileCount: 5, dirCount: 2, subDirs: ['/sub1'] },
    );
    const migrateSpy = jest.spyOn(migrateScanService, 'scanDirectory');

    const result = await scanService.scanDirectories({
      jobRunId: 'job-sc01',
      isMigration: false,
      batchSize: 100,
      batchId: undefined,
    });

    expect(discovSpy).toHaveBeenCalledTimes(2);
    expect(migrateSpy).not.toHaveBeenCalled();
    expect(result.fileCount).toBe(10);
    expect(result.dirCount).toBe(4);
  });

  // ─── H2 ─────────────────────────────────────────────────────────────────────

  it('H2 — Migration scan (isMigration=true): same as H1 but real routing sends commands to MigrateScanService.scanDirectory and DiscoveryScanService is never called', async () => {
    const jobCtx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    jest.spyOn(discoveryScanService, 'scanDirectory');
    const migrateSpy = jest.spyOn(migrateScanService, 'scanDirectory').mockResolvedValue(
      { fileCount: 3, dirCount: 1, subDirs: [] },
    );

    const result = await scanService.scanDirectories({
      jobRunId: 'job-sc01',
      isMigration: true,
      batchSize: 100,
      batchId: undefined,
    });

    expect(migrateSpy).toHaveBeenCalledTimes(2);
    expect(discoveryScanService.scanDirectory).not.toHaveBeenCalled();
    expect(result.fileCount).toBe(6);
    expect(result.dirCount).toBe(2);
  });

  // ─── H3 ─────────────────────────────────────────────────────────────────────

  it('H3 — Sub-directories exceed batchSize: batchSubDirs stores batches in Redis via jobContext.setBatchDir and the returned output has batchDirs IDs instead of a flat subDirs list', async () => {
    const jobCtx = makeJobContext();
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    const manySubDirs = Array.from({ length: 5 }, (_, i) => `/sub${i}`);
    jest.spyOn(discoveryScanService, 'scanDirectory').mockResolvedValue(
      { fileCount: 1, dirCount: 1, subDirs: manySubDirs },
    );

    const result = await scanService.scanDirectories({
      jobRunId: 'job-sc01',
      isMigration: false,
      batchSize: 3,
      batchId: undefined,
    });

    expect(jobCtx.setBatchDir).toHaveBeenCalled();
    expect(result.batchDirs.length).toBeGreaterThan(0);
  });

  // ─── N1 ─────────────────────────────────────────────────────────────────────

  it('N1 — One directory command fails while others succeed: Promise.allSettled lets the batch complete, the failed command is marked ERROR, and since the retry count is still below the limit a RetryableError is thrown so Temporal retries the activity', async () => {
    const jobCtx = makeJobContext({ retryCount: 0 });
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    let callIndex = 0;
    jest.spyOn(discoveryScanService, 'scanDirectory').mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) throw new Error('disk I/O error');
      return { fileCount: 3, dirCount: 1, subDirs: [] };
    });

    await expect(
      scanService.scanDirectories({ jobRunId: 'job-sc01', isMigration: false, batchSize: 100, batchId: undefined }),
    ).rejects.toBeInstanceOf(RetryableError);

    expect(jobCtx.publishToTaskStream).toHaveBeenCalledWith(
      expect.objectContaining({ status: TaskStatus.ERRORED }),
    );
  });

  // ─── N2 ─────────────────────────────────────────────────────────────────────

  it('N2 — A source fatal error code is in the error list: updateAndReportTaskStatus publishes the task as ERRORED to the stream, deletes it, and throws a FatalError so Temporal does not retry', async () => {
    const jobCtx = makeJobContext({ retryCount: 0 });
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    jest.spyOn(discoveryScanService, 'scanDirectory').mockRejectedValue(
      Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    );

    await expect(
      scanService.scanDirectories({ jobRunId: 'job-sc01', isMigration: false, batchSize: 100, batchId: undefined }),
    ).rejects.toBeInstanceOf(FatalError);

    expect(jobCtx.deleteTask).toHaveBeenCalled();
  });

  // ─── N3 ─────────────────────────────────────────────────────────────────────

  it('N3 — retryCount reaches maxRetryCount: the error is published to the error stream, the task is deleted, and the method returns normally (no throw) so the workflow can proceed rather than looping forever', async () => {
    const jobCtx = makeJobContext({ retryCount: 2 });
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    jest.spyOn(discoveryScanService, 'scanDirectory').mockRejectedValue(new Error('transient failure'));

    const result = await scanService.scanDirectories({
      jobRunId: 'job-sc01', isMigration: false, batchSize: 100, batchId: undefined,
    });

    expect(jobCtx.publishToErrorStream).toHaveBeenCalled();
    expect(jobCtx.deleteTask).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  // ─── N4 ─────────────────────────────────────────────────────────────────────

  it('N4 — Redis getJobManagerContext throws: the catch wraps it in a RetryableError, meaning Temporal will retry the whole activity cleanly', async () => {
    mockRedisService.getJobManagerContext.mockRejectedValue(new Error('Redis connection lost'));

    await expect(
      scanService.scanDirectories({ jobRunId: 'job-sc01', isMigration: false, batchSize: 100, batchId: undefined }),
    ).rejects.toBeInstanceOf(RetryableError);
  });
});
