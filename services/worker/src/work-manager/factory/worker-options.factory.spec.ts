import { WorkFlowOptions } from './worker-options.factory';
import { ListPathActivity } from 'src/activities/list-path/list-path.service';
import { ValidateConnectionActivity } from 'src/activities/validate-connection/validate-connection.service';
import { DiscoveryActivity } from 'src/activities/discovery/discovery.activities';
import { DiscoveryScanActivity } from 'src/activities/discovery/discovery.core.activity';
import { SetupActivityService } from 'src/activities/setup-worker/setup.activity.service';
import { MigrationScanService } from 'src/activities/migrate/migrate.scan.service';
import { MigrationTaskService } from 'src/activities/migrate/migrate.taskmanager.service';
import { MigrationSyncService } from 'src/activities/migrate/migrate.sync.service';
import { ValidateWorkingDirectoryActivity } from 'src/activities/working-directory/working-directory.service';
import { PrecheckActivity } from 'src/activities/precheck/precheck-activity';
import { CommonActivityService } from 'src/activities/common/common.service';
import { SpeedTestActivities } from 'src/activities/speed-test/speed-test-activities';
import { RedisMemoryCheckActivity } from 'src/activities/redis/redis.mem.usage.check.activity';
import { ValidatePathActivity } from 'src/activities/validate-path/validate-path.service';
import { ConfigService } from '@nestjs/config';
import { WorkerOptionsService } from './worker-options.factory.service';
import { Test, TestingModule } from '@nestjs/testing';
import { NativeConnection } from '@temporalio/worker';

jest.mock('@temporalio/worker', () => ({
  NativeConnection: jest.fn(),
}));

// Mock require.resolve for workflowsPath
const mockWorkflowsPath = '/mocked/path/to/workflows.js';
jest.spyOn(require, 'resolve').mockImplementation((path: string) => {
  if (path === '../../workflows/workflows') {
    return mockWorkflowsPath;
  }
  throw new Error('Unexpected path');
});

describe('WorkFlowOptions', () => {
  const identity = 'test-identity';
  const workerId = 'worker-123';
  const connection = {} as NativeConnection;
  const taskQueue = 'test-queue';

  const baseConfig: WorkerConfiguration = {
    dynamicTaskQueue: false,
    taskQueueId: 'some-id',
    configName: 'default',
    workerId  : 'default-worker',
  };
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerOptionsService,
        { provide: ListPathActivity, useValue: {}},
        { provide: ValidateConnectionActivity, useValue: {} },
        { provide: DiscoveryActivity, useValue: {} },
        { provide: DiscoveryScanActivity, useValue: {} },
        { provide: SetupActivityService, useValue: {} },
        { provide: MigrationScanService, useValue: {} },
        { provide: MigrationTaskService, useValue: {} },
        { provide: MigrationSyncService, useValue: {} },
        { provide: ValidateWorkingDirectoryActivity, useValue: {} },
        { provide: PrecheckActivity, useValue: {} },
        { provide: CommonActivityService, useValue: {} },
        { provide: SpeedTestActivities, useValue: {} },
        { provide: RedisMemoryCheckActivity, useValue: {} },
        { provide: ConfigService, useValue: {} },
        { provide:  ValidatePathActivity, useValue: {  validatePath: {},  postValidationResult: {} } },
      ],
    }).compile();
  });

  it('should initialize with dynamicTaskQueue false', () => {
    const options = new WorkFlowOptions(
      'identity-1',
      'worker-1',
      mockConnection,
      'taskQ',
      baseConfig,
      { act: () => 'ok' },
      5
    );

    expect(options.identity).toBe('identity-1');
    expect(options.workerId).toBe('worker-1');
    expect(options.connection).toBe(mockConnection);
    expect(options.taskQueue).toBe('taskQ');
    expect(options.activities).toEqual({ act: expect.any(Function) });
    expect(options.maxConcurrentActivityTaskExecutions).toBe(5);
    expect(options.workflowsPath).toEqual(require.resolve('../../workflows/workflows'));
  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('should set taskQueue with prefix when dynamicTaskQueue is true', () => {
    const config = { dynamicTaskQueue: true, taskQueueId: 'id-2' } as any;

    const options = new WorkFlowOptions(
      identity,
      workerId,
      connection,
      taskQueue,
      config
    );

    expect(options.taskQueue).toBe('id-2-test-queue');
  });

  it('should set activities and maxConcurrentActivityTaskExecutions to undefined by default', () => {
    const config = { dynamicTaskQueue: false, taskQueueId: 'id-3' } as any;

    const options = new WorkFlowOptions(
      identity,
      workerId,
      connection,
      taskQueue,
      config
    );

    expect(options.activities).toBeUndefined();
    expect(options.maxConcurrentActivityTaskExecutions).toBeUndefined();
  });
});