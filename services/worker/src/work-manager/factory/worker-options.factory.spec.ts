import { Test, TestingModule } from '@nestjs/testing';
import { WorkFlowType } from './worker-options.types';
import { WorkFlowOptions } from './worker-options.factory';
import { ConfigService } from '@nestjs/config';
import { NativeConnection } from '@temporalio/worker';
import { WorkerOptionsService } from './worker-options.factory.service';
import { WorkerConfiguration } from '../work-manager.types';
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

const bindMock = jest.fn().mockReturnValue({
  bind: jest.fn(),
})

const listPathActivityServiceMock = {
  listPath: bindMock,
}
const validateConnectionServiceMock = {
  validate: bindMock
}

const discoveryActivityMock = {
  getWorkerId: bindMock,
  generateDiscoveryReport: bindMock,
  publishTask: bindMock,
  discoveryStatusUpdate: bindMock,
  discoveryProcess: bindMock,
  scanActivity: bindMock,
  publishLastEntry: bindMock,
  fetchTasks: bindMock,
}
const discoveryScanActivityMock = {
  scanActivity: bindMock,
}
const setupActivityServiceMock = {
  setup: bindMock,
  cleanup: bindMock,
  speedTestSetup: bindMock,
  speedTestCleanup: bindMock,
}
const migrationScanServiceMock = {
  scanPath: bindMock,
}
const migrationTaskServiceMock = {
  updateCutOverStatus: bindMock,
  generateCOCReport: bindMock,
  publishScanTask: bindMock,
  fetchScanTask: bindMock,
  fetchMigrationTask: bindMock,
  updateStatus: bindMock,
}

const migrationSyncServiceMock = {
  syncTask:  bindMock
}

const validateWorkingDirectoryActivityMock = {
  validateWorkingDirectory:  bindMock,
  isValidDirectory: bindMock,
  updateConfigStatus: bindMock,
}

const precheckActivityMock = {
  preCheckPath: bindMock,
}

const commonActivityServiceMock = {
  getJobState: bindMock,
  setJobState: bindMock,
  updateStatus: bindMock,
  updateLastEntry: bindMock,
  generateJobsReport: bindMock,
  updateJobErrorStatus: bindMock,
  updateWorkerResponse: bindMock,
  cleanupJobContext: bindMock,
  getJobStateWithStreamLoad: bindMock,
  getJobStateAndUpdateTaskList: bindMock,
  isScanTaskRunningEmpty: bindMock,
  isSyncTaskRunningEmpty: bindMock,
}

const speedTestReadActivityMock = {
  readActivity: bindMock,
  networkPerformanceActivity: bindMock,
  writeActivity: bindMock,
  postResultsActivity: bindMock,
  speedTestSetup: bindMock
}

const mockConfigService = {
  get: jest.fn().mockReturnValue(5),
};

const redismeorycheckactivityMock = {
  checkMemoryUsage: bindMock,
}

describe('WorkerOptionsService', () => {
  let service: WorkerOptionsService;
  const mockConnection = {} as NativeConnection;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerOptionsService,
        { provide: ListPathActivity, useValue: listPathActivityServiceMock},
        { provide: ValidateConnectionActivity, useValue: validateConnectionServiceMock },
        { provide: DiscoveryActivity, useValue: discoveryActivityMock },
        { provide: DiscoveryScanActivity, useValue: discoveryScanActivityMock },
        { provide: SetupActivityService, useValue: setupActivityServiceMock },
        { provide: MigrationScanService, useValue: migrationScanServiceMock },
        { provide: MigrationTaskService, useValue: migrationTaskServiceMock },
        { provide: MigrationSyncService, useValue: migrationSyncServiceMock },
        { provide: ValidateWorkingDirectoryActivity, useValue: validateWorkingDirectoryActivityMock },
        { provide: PrecheckActivity, useValue: precheckActivityMock },
        { provide: CommonActivityService, useValue: commonActivityServiceMock },
        { provide: SpeedTestActivities, useValue: speedTestReadActivityMock },
        { provide: RedisMemoryCheckActivity, useValue: redismeorycheckactivityMock },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<WorkerOptionsService>(WorkerOptionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.jobTaskActivityConcurrency).toBe(5);
  });

  it('should return options for PARENT_WORKFLOW', () => {
    const config:WorkerConfiguration = { configName: WorkFlowType.PARENT_WORKFLOW, dynamicTaskQueue: false, taskQueueId: '-TaskQueue', workerId: 'worker1' };
    const options = service.createWorkerOptions('id1', config, 'worker1', mockConnection);
    expect(options).toBeInstanceOf(WorkFlowOptions);
    expect((options as any).taskQueue).toBe('ParentWorkflow-TaskQueue');
  });

  it('should return options for WORKER_SPECIFIC_WORKFLOW', () => {
    const config = { configName: WorkFlowType.WORKER_SPECIFIC_WORKFLOW, dynamicTaskQueue: false, taskQueueId: '-TaskQueue', workerId: 'worker1' };
    const options = service.createWorkerOptions('id2', config, 'worker2', mockConnection);
    expect(options).toBeInstanceOf(WorkFlowOptions);
    expect((options as any).taskQueue).toBe('TaskQueue');
  });

  it('should return options for JOB_SPECIFIC_WORKFLOW', () => {
    const config = { configName: WorkFlowType.JOB_SPECIFIC_WORKFLOW, dynamicTaskQueue: false, taskQueueId: '-TaskQueue', workerId: 'worker1'};
    const options = service.createWorkerOptions('id3', config, 'worker3', mockConnection);
    expect(options).toBeInstanceOf(WorkFlowOptions);
    expect((options as any).taskQueue).toBe('TaskQueue');
  });

  it('should return undefined for unknown workflow type', () => {
    const config = { configName: 'UNKNOWN_WORKFLOW' };
    const options = service.createWorkerOptions('id4', config as any, 'worker4', mockConnection);
    expect(options).toBeUndefined();
  });
});
