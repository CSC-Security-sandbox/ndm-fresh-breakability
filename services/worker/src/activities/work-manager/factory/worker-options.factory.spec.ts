import { NativeConnection } from '@temporalio/worker';
import { WorkerConfiguration } from '../work-manager.types';
import { WorkFlowOptions } from './worker-options.factory';

// Mock all the activity imports to prevent DataCloneError
jest.mock('src/activities/list-path/list-path.service', () => ({
  ListPathActivity: jest.fn()
}));
jest.mock('src/activities/validate-connection/validate-connection.service', () => ({
  ValidateConnectionActivity: jest.fn()
}));
jest.mock('src/activities/discovery/discovery.activities', () => ({
  DiscoveryActivity: jest.fn()
}));
jest.mock('src/activities/discovery/discovery.core.activity', () => ({
  DiscoveryScanActivity: jest.fn()
}));
jest.mock('src/activities/setup-worker/setup.activity.service', () => ({
  SetupActivityService: jest.fn()
}));
jest.mock('src/activities/migrate/migrate.scan.service', () => ({
  MigrationScanService: jest.fn()
}));
jest.mock('src/activities/migrate/migrate.taskmanager.service', () => ({
  MigrationTaskService: jest.fn()
}));
jest.mock('src/activities/migrate/migrate.sync.service', () => ({
  MigrationSyncService: jest.fn()
}));
jest.mock('src/activities/working-directory/working-directory.service', () => ({
  ValidateWorkingDirectoryActivity: jest.fn()
}));
jest.mock('src/activities/precheck/precheck-activity', () => ({
  PrecheckActivity: jest.fn()
}));
jest.mock('src/activities/common/common.service', () => ({
  CommonActivityService: jest.fn()
}));
jest.mock('src/activities/speed-test/speed-test-activities', () => ({
  SpeedTestActivities: jest.fn()
}));
jest.mock('src/activities/redis/redis.mem.usage.check.activity', () => ({
  RedisMemoryCheckActivity: jest.fn()
}));
jest.mock('src/activities/validate-path/validate-path.service', () => ({
  ValidatePathActivity: jest.fn()
}));
jest.mock('src/activities/core/common/common-task.service', () => ({
  CommonTaskService: jest.fn()
}));
jest.mock('src/activities/core/scan/scan-activity.service', () => ({
  ScanService: jest.fn()
}));

jest.mock('../../../workflows/workflows', () => ({}), { virtual: true });

describe('WorkFlowOptions (SKIPPED - DataCloneError)', () => {
  const mockConnection = {} as NativeConnection;

  const baseConfig: WorkerConfiguration = {
    dynamicTaskQueue: false,
    taskQueueId: 'some-id',
    configName: 'default',
    workerId  : 'default-worker',
  };

  it('should initialize with dynamicTaskQueue false', () => {
    const mockActivities = { act: jest.fn(() => 'ok') };
    
    const options = new WorkFlowOptions(
      'identity-1',
      'worker-1',
      mockConnection,
      'taskQ',
      baseConfig,
      mockActivities,
      5
    );

    expect(options.identity).toBe('identity-1');
    expect(options.workerId).toBe('worker-1');
    expect(options.connection).toBe(mockConnection);
    expect(options.taskQueue).toBe('taskQ');
    expect(options.activities).toEqual(mockActivities);
    expect(options.maxConcurrentActivityTaskExecutions).toBe(5);
    expect(options.workflowsPath).toEqual(require.resolve('../../../workflows/workflows'));
  });

  it('should initialize with dynamicTaskQueue true and append taskQueueId', () => {
    const configWithDynamic: WorkerConfiguration = {
      ...baseConfig,
      dynamicTaskQueue: true
    };

    const options = new WorkFlowOptions(
      'identity-2',
      'worker-2',
      mockConnection,
      'originalQ',
      configWithDynamic
    );

    expect(options.taskQueue).toBe('some-id-originalQ');
  });

  it('should handle undefined activities and maxConcurrentActivityTaskExecutions', () => {
    const options = new WorkFlowOptions(
      'identity-3',
      'worker-3',
      mockConnection,
      'taskX',
      baseConfig
    );

    expect(options.activities).toBeUndefined();
    expect(options.maxConcurrentActivityTaskExecutions).toBeUndefined();
  });

  it('should set workflowsPath using require.resolve', () => {
    const options = new WorkFlowOptions(
      'identity-4',
      'worker-4',
      mockConnection,
      'queueZ',
      baseConfig
    );
    expect(options.workflowsPath).toBe(require.resolve('../../../workflows/workflows'));
  });

  it('should assign all constructor parameters correctly', () => {
    const activitiesMock = { foo: () => 'bar' };
    const maxConcurrent = 10;
    const options = new WorkFlowOptions(
      'identity-5',
      'worker-5',
      mockConnection,
      'queueA',
      baseConfig,
      activitiesMock,
      maxConcurrent
    );
    expect(options.identity).toBe('identity-5');
    expect(options.workerId).toBe('worker-5');
    expect(options.connection).toBe(mockConnection);
    expect(options.taskQueue).toBe('queueA');
    expect(options.activities).toBe(activitiesMock);
    expect(options.maxConcurrentActivityTaskExecutions).toBe(maxConcurrent);
    expect(options.workflowsPath).toBe(require.resolve('../../../workflows/workflows'));
  });

  it('should handle empty string taskQueue and dynamicTaskQueue true', () => {
    const configWithDynamic: WorkerConfiguration = {
      ...baseConfig,
      dynamicTaskQueue: true
    };
    const options = new WorkFlowOptions(
      'identity-6',
      'worker-6',
      mockConnection,
      '',
      configWithDynamic
    );
    expect(options.taskQueue).toBe('some-id-');
  });
});
