import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { of, throwError } from 'rxjs';
import { WorkManagerService } from '../work-manager/work-manager.service';
import { WorkerOptionsService } from '../work-manager/factory/worker-options.factory.service';
import { AuthService } from '../auth/auth.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkerState } from '../work-manager/work-manager.types';

/**
 * Component test: handleCron 
 *
 * Real classes wired together:
 *   WorkManagerService → AuthService → WorkerOptionsService
 *
 * Mocked boundaries:
 *   HttpService (external HTTP to config-service & Keycloak)
 *   @temporalio/worker (Worker.create, NativeConnection)
 *   @temporalio/client (Connection, describeTaskQueue)
 *   ConfigService, SchedulerRegistry
 */

jest.mock('@temporalio/worker', () => ({
  Worker: {
    create: jest.fn(),
  },
  NativeConnection: {
    connect: jest.fn(),
  },
}));

jest.mock('@temporalio/client', () => ({
  Connection: {
    connect: jest.fn(),
  },
}));

jest.mock('src/utils/temporal.utils', () => ({
  buildTemporalConfig: jest.fn().mockResolvedValue({ metadata: {} }),
  createTemporalConnections: jest.fn().mockResolvedValue({
    nativeConnection: 'mock-native',
    clientConnection: {
      workflowService: {
        describeTaskQueue: jest.fn().mockResolvedValue({ pollers: [{ id: '1' }] }),
      },
    },
  }),
  refreshTemporalConnections: jest.fn().mockResolvedValue({
    nativeConnection: 'mock-native-refreshed',
    clientConnection: 'mock-client-refreshed',
  }),
}));

jest.mock('src/utils/network.utils', () => ({
  getLocalIpAddress: jest.fn().mockReturnValue('10.0.0.1'),
}));

jest.mock('fs/promises', () => ({
  access: jest.fn().mockRejectedValue(new Error('not found')),
  readFile: jest.fn().mockResolvedValue(''),
  writeFile: jest.fn(),
  unlink: jest.fn(),
}));

const mockLogger = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
};

const mockLoggerFactory = {
  create: jest.fn().mockReturnValue(mockLogger),
};

describe('Component: handleCron (WorkManagerService)', () => {
  let workManagerService: WorkManagerService;
  let authService: AuthService;
  let httpService: jest.Mocked<HttpService>;
  let schedulerRegistry: SchedulerRegistry;

  const configMap = {
    'worker.connection.workerConfigUrl': 'http://config-service:3000',
    'worker.workerId': 'worker-1',
    'worker.workerStartupTimeout': 10,
    'worker.platform': 'linux',
    'worker.maxActivityConcurrency': 1,
    'worker.maxActivityTaskPollers': 0,
    'worker.shutDownForceTime': '10s',
    'worker.metrics.versionsPathLinux': '/etc/versions.conf',
    'worker.upgrade.confDirLinux': '/etc/upgrade',
    'keycloak': {
      baseUrl: 'http://keycloak:8080',
      realm: 'ndm',
      workerSecret: 'test-secret',
    },
  };

  const mockConfigService = {
    get: jest.fn((key: string) => configMap[key]),
  };

  const mockHttpService = {
    get: jest.fn(),
    post: jest.fn(),
  };

  const mockSchedulerRegistry = {
    addInterval: jest.fn(),
    deleteInterval: jest.fn(),
  };

  /**
   * WorkerOptionsService has many activity dependencies.
   * Since we're testing the handleCron chain (auth → HTTP → config diffing → worker start/stop),
   * we mock WorkerOptionsService at the boundary — it's the bridge to Temporal worker creation.
   */
  const mockWorkerOptionsService = {
    createWorkerOptions: jest.fn().mockReturnValue({
      taskQueue: 'TaskQueue',
      identity: 'test-identity',
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // AuthService is REAL — it calls HttpService.post for Keycloak token
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkManagerService,
        AuthService, // REAL
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LoggerFactory, useValue: mockLoggerFactory },
        { provide: WorkerOptionsService, useValue: mockWorkerOptionsService },
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
      ],
    }).compile();

    workManagerService = module.get<WorkManagerService>(WorkManagerService);
    authService = module.get<AuthService>(AuthService);
    httpService = module.get(HttpService);
    schedulerRegistry = module.get(SchedulerRegistry);

    // Set up Temporal connections on the service (normally done in onApplicationBootstrap)
    workManagerService['connection'] = 'mock-native' as any;
    workManagerService['temporalClientConnection'] = {
      workflowService: {
        describeTaskQueue: jest.fn().mockResolvedValue({ pollers: [{ id: '1' }] }),
      },
    } as any;
  });

  function mockKeycloakTokenResponse(token = 'jwt-token-123') {
    mockHttpService.post.mockReturnValueOnce(
      of({
        data: { access_token: token, expires_in: 3600 },
        status: 200,
      }),
    );
  }

  function mockConfigServiceResponse(metaConfig: any[]) {
    mockHttpService.get.mockReturnValueOnce(
      of({
        status: 200,
        data: { data: { items: { metaConfig } } },
      }),
    );
  }

  // ─── H1: Config-service returns 2 new configs → 2 workers started ───

  it('H1 — should fetch JWT via real AuthService, call config-service, and start workers for new configs', async () => {
    mockKeycloakTokenResponse();
    mockConfigServiceResponse([
      { workerId: 'worker-1', configName: 'WORKER_SPECIFIC_WORKFLOW', taskQueueId: 'tq1', dynamicTaskQueue: false },
      { workerId: 'worker-1', configName: 'JOB_SPECIFIC_WORKFLOW', taskQueueId: 'tq2', dynamicTaskQueue: true },
    ]);

    const Worker = require('@temporalio/worker').Worker;
    const mockWorker = {
      getState: jest.fn().mockReturnValue(WorkerState.RUNNING),
      run: jest.fn().mockReturnValue(new Promise(() => {})),
      shutdown: jest.fn(),
      options: { identity: 'test-identity' },
    };
    Worker.create.mockResolvedValue(mockWorker);

    await workManagerService.handleCron();

    // AuthService.getAccessToken was called (real) → which calls HttpService.post to Keycloak
    expect(mockHttpService.post).toHaveBeenCalledWith(
      expect.stringContaining('/realms/ndm/protocol/openid-connect/token'),
      expect.any(String),
      expect.objectContaining({ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }),
    );

    // Config-service GET was called with the JWT
    expect(mockHttpService.get).toHaveBeenCalledWith(
      'http://config-service:3000/api/v1/work-manager/config',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-token-123',
        }),
      }),
    );

    // Workers were created
    expect(Worker.create).toHaveBeenCalledTimes(2);
    expect(workManagerService['loadingConfigs']).toBe(false);
  });

  // ─── H2: Config-service removes a config → worker stopped ───

  it('H2 — should stop workers whose config is no longer returned by config-service', async () => {
    const existingWorker = {
      getState: jest.fn().mockReturnValue(WorkerState.RUNNING),
      shutdown: jest.fn(),
      run: jest.fn().mockResolvedValue(undefined),
      options: { identity: 'worker-1/OLD_WORKFLOW' },
    };
    workManagerService['activeWorkers'].set('worker-1/OLD_WORKFLOW', existingWorker as any);

    mockKeycloakTokenResponse();
    mockConfigServiceResponse([]); // empty — old worker should be stopped

    await workManagerService.handleCron();

    expect(existingWorker.shutdown).toHaveBeenCalled();
    expect(workManagerService['activeWorkers'].has('worker-1/OLD_WORKFLOW')).toBe(false);
  });

  // ─── H3: Same configs as active → no start/stop ───

  it('H3 — should do nothing when config-service returns same configs as already active', async () => {
    const existingWorker = {
      getState: jest.fn().mockReturnValue(WorkerState.RUNNING),
      shutdown: jest.fn(),
      run: jest.fn().mockResolvedValue(undefined),
      options: { identity: 'worker-1/WORKER_SPECIFIC_WORKFLOW' },
    };
    workManagerService['activeWorkers'].set('worker-1/WORKER_SPECIFIC_WORKFLOW', existingWorker as any);

    mockKeycloakTokenResponse();
    mockConfigServiceResponse([
      { workerId: 'worker-1', configName: 'WORKER_SPECIFIC_WORKFLOW', taskQueueId: '', dynamicTaskQueue: false },
    ]);

    const Worker = require('@temporalio/worker').Worker;
    Worker.create.mockClear();

    await workManagerService.handleCron();

    expect(Worker.create).not.toHaveBeenCalled();
    expect(existingWorker.shutdown).not.toHaveBeenCalled();
  });

  // ─── N1: AuthService returns null token ───

  it('N1 — Keycloak is down: the cron aborts before calling config-service, logs the error, and releases the lock so the next tick can run normally', async () => {
    // Keycloak returns error → AuthService.getAccessToken returns null
    mockHttpService.post.mockReturnValueOnce(
      throwError(() => new Error('Keycloak unreachable')),
    );

    await workManagerService.handleCron();

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error fetching configurations:'),
    );
    expect(mockHttpService.get).not.toHaveBeenCalled();
    expect(workManagerService['loadingConfigs']).toBe(false);
  });

  // ─── N2: Config-service returns non-200 ───

  it('N2 — should log error when config-service returns non-200 status', async () => {
    mockKeycloakTokenResponse();
    mockHttpService.get.mockReturnValueOnce(
      of({ status: 500, data: {} }),
    );

    await workManagerService.handleCron();

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error fetching configurations:'),
    );
    expect(workManagerService['loadingConfigs']).toBe(false);
  });

  // ─── N3: Config-service network error ───

  it('N3 — should log error when HTTP GET to config-service throws network error', async () => {
    mockKeycloakTokenResponse();
    mockHttpService.get.mockReturnValueOnce(
      throwError(() => new Error('ECONNREFUSED')),
    );

    await workManagerService.handleCron();

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error fetching configurations:'),
    );
    expect(workManagerService['loadingConfigs']).toBe(false);
  });

  // ─── N4: loadingConfigs already true → skip ───

  it('N4 — should skip cycle when loadingConfigs is already true', async () => {
    workManagerService['loadingConfigs'] = true;

    await workManagerService.handleCron();

    expect(mockHttpService.get).not.toHaveBeenCalled();
    expect(mockHttpService.post).not.toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Already loading configurations, skipping this cycle.',
    );
  });

  // ─── N5: JWT expired error triggers refresh ───

  it('N5 — should trigger refreshTemporalConnectionCron when JWT expired error received', async () => {
    mockKeycloakTokenResponse();
    mockHttpService.get.mockReturnValueOnce(
      throwError(() => new Error('UNAUTHENTICATED: Jwt is expired')),
    );

    const refreshSpy = jest
      .spyOn(workManagerService, 'refreshTemporalConnectionCron')
      .mockResolvedValue(undefined);

    await workManagerService.handleCron();

    expect(refreshSpy).toHaveBeenCalled();
    expect(workManagerService['loadingConfigs']).toBe(false);
  });

  // ─── N6: Worker.create throws for one config ───

  it('N6 — should handle Worker.create failure for one config without affecting others', async () => {
    mockKeycloakTokenResponse();
    mockConfigServiceResponse([
      { workerId: 'worker-1', configName: 'GOOD_WORKFLOW', taskQueueId: '', dynamicTaskQueue: false },
      { workerId: 'worker-1', configName: 'BAD_WORKFLOW', taskQueueId: '', dynamicTaskQueue: false },
    ]);

    const Worker = require('@temporalio/worker').Worker;
    const goodWorker = {
      getState: jest.fn().mockReturnValue(WorkerState.RUNNING),
      run: jest.fn().mockReturnValue(new Promise(() => {})),
      shutdown: jest.fn(),
      options: { identity: 'test-identity' },
    };

    Worker.create
      .mockResolvedValueOnce(goodWorker) // first config succeeds
      .mockRejectedValueOnce(new Error('Worker creation failed')); // second fails

    await workManagerService.handleCron();

    // First worker was created and tracked
    expect(workManagerService['activeWorkers'].size).toBe(1);
    // Error was logged for the failed one
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error starting worker'),
    );
  });

  // ─── N7: monitorTaskQueues — no pollers → shutdown ───

  it('N7 — should shutdown worker when monitorTaskQueues finds no pollers', async () => {
    const workerToShutdown = {
      getState: jest.fn().mockReturnValue(WorkerState.RUNNING),
      shutdown: jest.fn(),
      run: jest.fn().mockResolvedValue(undefined),
      options: { identity: 'worker-1/STALE_WORKFLOW' },
    };
    workManagerService['activeWorkers'].set('worker-1/STALE_WORKFLOW', workerToShutdown as any);
    workManagerService['taskQueuesToMonitor'] = [
      { queueName: 'StaleQueue', workerId: 'worker-1/STALE_WORKFLOW' },
    ];

    // Temporal returns no pollers for this queue
    workManagerService['temporalClientConnection'] = {
      workflowService: {
        describeTaskQueue: jest.fn().mockResolvedValue({ pollers: [] }),
      },
    } as any;

    mockKeycloakTokenResponse();
    mockConfigServiceResponse([
      { workerId: 'worker-1', configName: 'STALE_WORKFLOW', taskQueueId: '', dynamicTaskQueue: false },
    ]);

    await workManagerService.handleCron();

    expect(workerToShutdown.shutdown).toHaveBeenCalled();
    expect(workManagerService['activeWorkers'].has('worker-1/STALE_WORKFLOW')).toBe(false);
  });
});
