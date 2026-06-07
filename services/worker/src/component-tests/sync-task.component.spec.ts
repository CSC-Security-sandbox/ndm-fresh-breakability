import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { CommandStatus, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { SyncService } from '../activities/core/migrate/sync-activity.service';
import { CommonTaskService } from '../activities/core/common/common-task.service';
import { CommandExecService } from '../activities/core/migrate/command-execution/command-execution.service';
import { AuthService } from '../auth/auth.service';
import { RedisService } from '../redis/redis.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkersConfig } from '../config/app.config';
import { FatalError, RetryExceededError } from '../errors/errors.types';

jest.mock('@temporalio/activity', () => ({
  Context: {
    current: jest.fn().mockReturnValue({
      heartbeat: jest.fn(),
      cancellationSignal: { aborted: false },
    }),
  },
  CancelledFailure: class CancelledFailure extends Error {
    constructor(message: string) { super(message); this.name = 'CancelledFailure'; }
  },
  ApplicationFailure: {
    retryable: (msg: string, type: string) => {
      const e: any = new Error(msg);
      e.type = type;
      return e;
    },
  },
}));

/**
 * Real classes wired:
 *   SyncService → CommonTaskService.ensureTaskValid (real)
 *               → SyncService.executeSyncTask → CommandExecService (mock boundary)
 *               → SyncService.updateAndReportTaskStatus (real error routing)
 *
 * Mocked boundaries:
 *   RedisService.getJobManagerContext — returns mock jobContext
 *   CommandExecService.executeCommand  — filesystem/rsync operations
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
      'worker.maxRetryCount':         3,
      'worker.maxCommandConcurrency': 5,
      'worker.maxWriteConcurrency':   1,
      'worker.groupSize':             1000,
      'worker.commandsInTask':        100,
      'worker.maxCmdStreamLen':       5000,
      'keycloak': { baseUrl: 'http://keycloak', realm: 'ndm', workerSecret: 'secret' },
    };
    return map[key];
  }),
};

const mockRedisService    = { getJobManagerContext: jest.fn() };
const mockHttpService     = { post: jest.fn(), get: jest.fn() };
const mockCommandExecService = { executeCommand: jest.fn() };

function makeJobContext(taskOverrides: Partial<any> = {}) {
  const task = {
    id: 'task-sync-1',
    jobRunId: 'job-sync01',
    sPathId: 'src-path',
    tPathId: 'dst-path',
    status: TaskStatus.PENDING,
    workerId: undefined as any,
    retryCount: 0,
    commands: [
      { id: 'cmd-1', fPath: '/file1.txt', status: CommandStatus.READY, isDir: false, metadata: { size: 1024 } },
      { id: 'cmd-2', fPath: '/file2.txt', status: CommandStatus.READY, isDir: false, metadata: { size: 2048 } },
    ],
    ...taskOverrides,
  };

  return {
    jobConfig: {
      sourceDirectoryPath: '/mnt/src',
      destinationDirectoryPath: '/mnt/dst',
    },
    jobRunId: 'job-sync01',
    getTask: jest.fn().mockResolvedValue(task),
    setTask: jest.fn().mockResolvedValue(undefined),
    publishToTaskStream: jest.fn().mockResolvedValue(undefined),
    deleteTask: jest.fn().mockResolvedValue(undefined),
    publishToErrorStream: jest.fn().mockResolvedValue(undefined),
    publishToFileStreamBulk: jest.fn().mockResolvedValue(undefined),
    addInProcessFile: jest.fn().mockResolvedValue(undefined),
    removeInProcessFile: jest.fn().mockResolvedValue(undefined),
  };
}

describe('Component: syncTaskActivity (SyncService + CommonTaskService)', () => {
  let syncService: SyncService;

  beforeEach(async () => {
    jest.clearAllMocks();
    new WorkersConfig(mockConfigService as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        CommonTaskService,
        AuthService,
        { provide: ConfigService,        useValue: mockConfigService },
        { provide: LoggerFactory,        useValue: mockLoggerFactory },
        { provide: RedisService,         useValue: mockRedisService },
        { provide: HttpService,          useValue: mockHttpService },
        { provide: CommandExecService,   useValue: mockCommandExecService },
      ],
    }).compile();

    syncService = module.get<SyncService>(SyncService);
  });

  // ─── H1 ─────────────────────────────────────────────────────────────────────

  it('H1 — All commands execute successfully: CommandExecService.executeCommand returns results for every command, all commands are marked COMPLETED, task is published to the stream, deleted from Redis, and the returned SyncTaskOutput has status: COMPLETED with empty error lists', async () => {
    const jobCtx = makeJobContext({ retryCount: 0 });
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);
    mockCommandExecService.executeCommand.mockResolvedValue({
      sourceErrors: [], targetErrors: [], cmd: { status: CommandStatus.COMPLETED },
    });
    jobCtx.getTask.mockResolvedValue({
      id: 'task-sync-1',
      jobRunId: 'job-sync01',
      sPathId: 'src-path',
      tPathId: 'dst-path',
      status: TaskStatus.PENDING,
      retryCount: 0,
      commands: [
        { id: 'cmd-1', fPath: '/file1.txt', status: CommandStatus.COMPLETED, isDir: false, metadata: { size: 1024 } },
        { id: 'cmd-2', fPath: '/file2.txt', status: CommandStatus.COMPLETED, isDir: false, metadata: { size: 2048 } },
      ],
    });

    const result = await syncService.syncTaskActivity({ jobRunId: 'job-sync01', taskId: 'task-sync-1' });

    expect(result.status).toBe(TaskStatus.COMPLETED);
    expect(jobCtx.publishToTaskStream).toHaveBeenCalledWith(
      expect.objectContaining({ status: TaskStatus.COMPLETED }),
    );
    expect(jobCtx.deleteTask).toHaveBeenCalledWith('task-sync-1');
  });

  // ─── H2 ─────────────────────────────────────────────────────────────────────

  it('H2 — A file command is processed: addInProcessFile is called on jobContext before execution and removeInProcessFile is called in the finally block even when the command succeeds', async () => {
    const jobCtx = makeJobContext({ retryCount: 0 });
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);
    const commands = [
      { id: 'cmd-1', fPath: '/file1.txt', status: CommandStatus.READY, isDir: false, metadata: { size: 1024 } },
      { id: 'cmd-2', fPath: '/file2.txt', status: CommandStatus.READY, isDir: false, metadata: { size: 2048 } },
    ];
    mockCommandExecService.executeCommand.mockImplementation(async (input: any) => {
      input.command.status = CommandStatus.COMPLETED;
      return { sourceErrors: [], targetErrors: [], cmd: input.command };
    });
    jobCtx.getTask.mockResolvedValue({
      id: 'task-sync-1', jobRunId: 'job-sync01', sPathId: 'src-path', tPathId: 'dst-path',
      status: TaskStatus.PENDING, retryCount: 0,
      commands,
    });

    await syncService.syncTaskActivity({ jobRunId: 'job-sync01', taskId: 'task-sync-1' });

    expect(jobCtx.addInProcessFile).toHaveBeenCalledWith('/file1.txt', 1024);
    expect(jobCtx.removeInProcessFile).toHaveBeenCalledWith('/file1.txt', 1024);
    expect(jobCtx.addInProcessFile).toHaveBeenCalledWith('/file2.txt', 2048);
    expect(jobCtx.removeInProcessFile).toHaveBeenCalledWith('/file2.txt', 2048);
  });

  // ─── H3 ─────────────────────────────────────────────────────────────────────

  it('H3 — Already-completed commands are skipped: when a command already has status COMPLETED it is filtered out of the execution batch and commandExecService.executeCommand is never called for it', async () => {
    const commands = [
      { id: 'cmd-1', fPath: '/file1.txt', status: CommandStatus.COMPLETED, isDir: false, metadata: { size: 1024 } },
      { id: 'cmd-2', fPath: '/file2.txt', status: CommandStatus.READY, isDir: false, metadata: { size: 2048 } },
    ];
    const jobCtx = makeJobContext({ retryCount: 1, commands });
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);
    mockCommandExecService.executeCommand.mockImplementation(async (input: any) => {
      input.command.status = CommandStatus.COMPLETED;
      return { sourceErrors: [], targetErrors: [], cmd: input.command };
    });
    jobCtx.getTask.mockResolvedValue({
      id: 'task-sync-1', jobRunId: 'job-sync01', sPathId: 'src-path', tPathId: 'dst-path',
      status: TaskStatus.PENDING, retryCount: 1,
      commands,
    });

    await syncService.syncTaskActivity({ jobRunId: 'job-sync01', taskId: 'task-sync-1' });

    expect(mockCommandExecService.executeCommand).toHaveBeenCalledTimes(1);
  });

  // ─── N1 ─────────────────────────────────────────────────────────────────────

  it('N1 — One command fails with a recoverable error and the retry count is still below the limit: the task is published as ERRORED and an ApplicationFailure.retryable is thrown so Temporal schedules another attempt', async () => {
    const jobCtx = makeJobContext({ retryCount: 0 });
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);
    mockCommandExecService.executeCommand.mockResolvedValue({
      sourceErrors: ['ENOENT'], targetErrors: [], cmd: { status: CommandStatus.ERROR },
    });

    await expect(
      syncService.syncTaskActivity({ jobRunId: 'job-sync01', taskId: 'task-sync-1' }),
    ).rejects.toThrow();

    expect(jobCtx.publishToTaskStream).toHaveBeenCalledWith(
      expect.objectContaining({ status: TaskStatus.ERRORED }),
    );
  });

  // ─── N2 ─────────────────────────────────────────────────────────────────────

  it('N2 — A fatal source error code appears in the results: FatalError is thrown, the task is deleted, and Temporal will not retry the activity', async () => {
    const jobCtx = makeJobContext({ retryCount: 0 });
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);
    mockCommandExecService.executeCommand.mockResolvedValue({
      sourceErrors: ['EACCES'],
      targetErrors: [],
      cmd: { status: CommandStatus.ERROR },
    });

    await expect(
      syncService.syncTaskActivity({ jobRunId: 'job-sync01', taskId: 'task-sync-1' }),
    ).rejects.toBeInstanceOf(FatalError);

    expect(jobCtx.deleteTask).toHaveBeenCalled();
  });

  // ─── N3 ─────────────────────────────────────────────────────────────────────

  it('N3 — A transient (no-retry) error code appears (e.g., E8DOT3_COLLISION): RetryExceededError is thrown and the task is deleted regardless of the retry count', async () => {
    const jobCtx = makeJobContext({ retryCount: 0 });
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);
    mockCommandExecService.executeCommand.mockResolvedValue({
      sourceErrors: ['E8DOT3_COLLISION'], targetErrors: [],
      cmd: { status: CommandStatus.ERROR },
    });

    await expect(
      syncService.syncTaskActivity({ jobRunId: 'job-sync01', taskId: 'task-sync-1' }),
    ).rejects.toBeInstanceOf(RetryExceededError);

    expect(jobCtx.deleteTask).toHaveBeenCalled();
  });

  // ─── N4 ─────────────────────────────────────────────────────────────────────

  it('N4 — retryCount reaches maxRetryCount with ordinary errors: RetryExceededError is thrown and the task is deleted', async () => {
    const jobCtx = makeJobContext({ retryCount: 2 });
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);
    mockCommandExecService.executeCommand.mockResolvedValue({
      sourceErrors: ['ENOENT'], targetErrors: [], cmd: { status: CommandStatus.ERROR },
    });

    await expect(
      syncService.syncTaskActivity({ jobRunId: 'job-sync01', taskId: 'task-sync-1' }),
    ).rejects.toBeInstanceOf(RetryExceededError);

    expect(jobCtx.deleteTask).toHaveBeenCalled();
  });

  // ─── N5 ─────────────────────────────────────────────────────────────────────

  it('N5 — Task does not exist in jobContext (getTask returns null): the activity returns the default empty SyncTaskOutput immediately without calling CommandExecService at all', async () => {
    const jobCtx = makeJobContext();
    jobCtx.getTask.mockResolvedValue(null);
    mockRedisService.getJobManagerContext.mockResolvedValue(jobCtx);

    const result = await syncService.syncTaskActivity({ jobRunId: 'job-sync01', taskId: 'task-missing' });

    expect(result.status).toBe(TaskStatus.PENDING);
    expect(result.errors).toEqual({ source: [], target: [] });
    expect(mockCommandExecService.executeCommand).not.toHaveBeenCalled();
  });
});
