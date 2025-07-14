import { WorkerOptionsService } from './worker-options.factory.service';
import { WorkFlowType } from './worker-options.types';
import { WorkFlowOptions } from './worker-options.factory';

describe('WorkerOptionsService', () => {
  let service: WorkerOptionsService;
  let mockDeps: any;
  let mockConfigService: any;

  beforeEach(() => {
    mockDeps = {
      listPathActivityService: { listPath: jest.fn() },
      validateConnectionService: { validate: jest.fn() },
      discoveryActivities: {
        getWorkerId: jest.fn(),
        generateDiscoveryReport: jest.fn(),
        publishTask: jest.fn(),
        discoveryStatusUpdate: jest.fn(),
        publishLastEntry: jest.fn(),
      },
      discoveryScanActivity: { scanActivity: jest.fn() },
      setupActivityService: {
        setup: jest.fn(),
        cleanup: jest.fn(),
        speedTestSetup: jest.fn(),
        speedTestCleanup: jest.fn(),
      },
      migrationScanService: { scanPath: jest.fn() },
      migrationTaskService: {
        updateCutOverStatus: jest.fn(),
        generateCOCReport: jest.fn(),
        publishScanTask: jest.fn(),
      },
      migrationSyncService: { syncTask: jest.fn() },
      validateWorkingDirectoryActivity: {
        validateWorkingDirectory: jest.fn(),
        isValidDirectory: jest.fn(),
        updateConfigStatus: jest.fn(),
      },
      precheckActivity: { preCheckPath: jest.fn() },
      commonActivityService: {
        getJobState: jest.fn(),
        setJobState: jest.fn(),
        updateStatus: jest.fn(),
        updateLastEntry: jest.fn(),
        generateJobsReport: jest.fn(),
        updateJobErrorStatus: jest.fn(),
        updateWorkerResponse: jest.fn(),
        cleanupJobContext: jest.fn(),
        getJobStateAndUpdateTaskList: jest.fn(),
        getJobStateWithStreamLoad: jest.fn(),
        hasRunningScanTask: jest.fn(),
        hasRunningSyncTask: jest.fn(),
      },
      speedTestReadActivity: {
        readActivity: jest.fn(),
        networkPerformanceActivity: jest.fn(),
        writeActivity: jest.fn(),
        postResultsActivity: jest.fn(),
      },
      redismeorycheck: { checkMemoryUsage: jest.fn() },
      migrateSyncService: { syncTaskActivity: jest.fn() },
      commonTaskService: {
        isWorkflowRunningActivity: jest.fn(),
        getGroupOfTasksActivity: jest.fn(),
      },
      scanService: { scanDirectories: jest.fn() },
      validatePathActivity: {
        postValidationResult: jest.fn(),
        validatePath: jest.fn(),
      },
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue(5),
    };

    service = new WorkerOptionsService(
      mockDeps.listPathActivityService,
      mockDeps.validateConnectionService,
      mockDeps.discoveryActivities,
      mockDeps.discoveryScanActivity,
      mockDeps.setupActivityService,
      mockDeps.migrationScanService,
      mockDeps.migrationTaskService,
      mockDeps.migrationSyncService,
      mockDeps.validateWorkingDirectoryActivity,
      mockDeps.precheckActivity,
      mockDeps.commonActivityService,
      mockDeps.speedTestReadActivity,
      mockDeps.redismeorycheck,
      mockDeps.migrateSyncService,
      mockDeps.commonTaskService,
      mockDeps.scanService,
      mockDeps.validatePathActivity,
      mockConfigService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should set jobTaskActivityConcurrency from config', () => {
    expect(service.jobTaskActivityConcurrency).toBe(5);
  });

  it('should create WorkFlowOptions for PARENT_WORKFLOW', () => {
    const config = { configName: WorkFlowType.PARENT_WORKFLOW };
    const result = service.createWorkerOptions(
      'id1',
      config as any,
      'worker1',
      {} as any,
    );
    expect(result).toBeInstanceOf(WorkFlowOptions);
    expect(result.taskQueue).toBe('ParentWorkflow-TaskQueue');
    // expect(result.config).toBe(config);
    expect(result.activities.getWorkerId).toBeDefined();
    expect(result.activities.checkMemoryUsage).toBeDefined();
    expect(result.activities.postValidationResult).toBeDefined();
  });

  it('should create WorkFlowOptions for WORKER_SPECIFIC_WORKFLOW', () => {
    const config = { configName: WorkFlowType.WORKER_SPECIFIC_WORKFLOW };
    const result = service.createWorkerOptions(
      'id2',
      config as any,
      'worker2',
      {} as any,
    );
    expect(result).toBeInstanceOf(WorkFlowOptions);
    expect(result.taskQueue).toBe('TaskQueue');
    // expect(result.config).toBe(config);
    expect(result.activities.listPath).toBeDefined();
    expect(result.activities.validate).toBeDefined();
    expect(result.activities.validatePath).toBeDefined();
  });

  it('should create WorkFlowOptions for JOB_SPECIFIC_WORKFLOW', () => {
    const config = { configName: WorkFlowType.JOB_SPECIFIC_WORKFLOW };
    const result = service.createWorkerOptions(
      'id3',
      config as any,
      'worker3',
      {} as any,
    );
    expect(result).toBeInstanceOf(WorkFlowOptions);
    expect(result.taskQueue).toBe('TaskQueue');
    // expect(result.config).toBe(config);
    expect(result.activities.publishTask).toBeDefined();
    expect(result.activities.syncTaskActivity).toBeDefined();
    expect(result.activities.scanDirectories).toBeDefined();
    // expect(result.activityConcurrency).toBe(5);
  });

  it('should return undefined for unknown workflow type', () => {
    const config = { configName: 'UNKNOWN' };
    const result = service.createWorkerOptions(
      'id4',
      config as any,
      'worker4',
      {} as any,
    );
    expect(result).toBeUndefined();
  });
});
