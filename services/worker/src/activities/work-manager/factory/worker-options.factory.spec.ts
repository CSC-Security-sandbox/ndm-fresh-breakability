import { NativeConnection } from '@temporalio/worker';
import { WorkerConfiguration } from '../work-manager.types';
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
import { MigrateSyncService } from 'src/activities/core/migrate/migrate-sync.service';
import { CommonTaskService } from 'src/activities/core/common/common-task.service';
import { ScanService } from 'src/activities/core/scan/scan-activity.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from 'src/auth/auth.service.spec';

jest.mock('../../../workflows/workflows', () => ({}), { virtual: true });

describe('WorkFlowOptions', () => {
  const mockConnection = {} as NativeConnection;

  const baseConfig: WorkerConfiguration = {
    dynamicTaskQueue: false,
    taskQueueId: 'some-id',
    configName: 'default',
    workerId  : 'default-worker',
  };
  const migrateSyncServiceMock = {
    syncTaskActivity: jest.fn(),
  };

  const commonTaskServiceMock = {
    performCommonTask: jest.fn(), // Add any methods you expect to call
  };

  const configServiceMock = {
    get: jest.fn((key: string) => {
      if (key === 'worker.maxActivityConcurrency') return 5;
      return null;
    }),
  };

  const scanServiceMock = {
    scan: jest.fn(), // Add expected methods here too
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
        { provide: ConfigService, useValue: configServiceMock },
        { provide: ValidatePathActivity, useValue: {  validatePath: {},  postValidationResult: {} } },
        { provide: MigrateSyncService, useValue: migrateSyncServiceMock },
        { provide: CommonTaskService, useValue: commonTaskServiceMock },
        { provide: ScanService, useValue: scanServiceMock },
        {provide: LoggerFactory, useValue: mockLoggerFactory },
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
