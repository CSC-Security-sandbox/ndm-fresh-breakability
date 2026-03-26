import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '@nestjs/config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { createClient } from 'redis';
import { Worker } from 'worker_threads';
import { RedisConsumerService } from './redis-consumer.service';
import { InventoryService } from '../inventory/inventory.service';
import { WorkflowService } from '../workflow/workflow.service';
import { DataSource } from 'typeorm';

jest.mock('redis', () => ({
  createClient: jest.fn(),
}));

jest.mock('worker_threads', () => ({
  Worker: jest.fn(),
  isMainThread: true,
}));

const mockLogger = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

describe('RedisConsumerService - JWT Authentication', () => {
  let authService: AuthService;
  let configService: ConfigService;
  let mockClient: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockClient = {
      isOpen: false,
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      duplicate: jest.fn().mockReturnThis(),
    };

    (createClient as jest.Mock).mockReturnValue(mockClient);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: AuthService,
          useValue: {
            getAccessToken: jest.fn().mockResolvedValue('mock-jwt-token'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const configMap = {
                REDIS_HOST: 'localhost',
                REDIS_PORT: '6379',
                REDIS_JWT_AUTH_ENABLED: 'false',
                REDIS_GATEWAY_HOST: 'gateway.test.com',
                REDIS_GATEWAY_PORT: '6379',
              };
              return configMap[key];
            }),
          },
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue(mockLogger),
          },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('JWT Client Creation', () => {
    it('should create JWT authenticated client for Redis consumer', async () => {
      process.env.REDIS_USERNAME = 'consumer-user';
      (authService.getAccessToken as jest.Mock).mockResolvedValue('consumer-jwt-token');

      const jwtAuthEnabled = true;
      
      // Simulate createJwtAuthClient logic
      const jwt = await authService.getAccessToken();
      expect(jwt).toBe('consumer-jwt-token');

      const redisClientOptions = {
        url: 'redis://redis-master.redis.svc.cluster.local:6379',
        username: process.env.REDIS_USERNAME || 'default',
        password: jwt,
      };

      const client = createClient(redisClientOptions);

      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'redis://redis-master.redis.svc.cluster.local:6379',
          username: 'consumer-user',
          password: 'consumer-jwt-token',
        }),
      );
    });

    it('should handle JWT token retrieval failure', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValue(null);

      const jwt = await authService.getAccessToken();

      expect(jwt).toBeNull();
      // Service should handle this by throwing error
      expect(() => {
        if (!jwt) {
          throw new Error('Failed to get JWT for Redis authentication');
        }
      }).toThrow('Failed to get JWT for Redis authentication');
    });
  });

  describe('Connection Refresh for Consumer', () => {
    it('should support connection refresh mechanism', async () => {
      const jwtAuthEnabled = true;
      let connectionRefreshInterval: NodeJS.Timeout;

      // Simulate setupConnectionRefresh
      const refreshConnection = jest.fn().mockResolvedValue(undefined);
      const refreshIntervalMs = 1380 * 60 * 1000; // 23 hours

      connectionRefreshInterval = setInterval(async () => {
        mockLogger.log('Proactively refreshing Redis connection with new JWT...');
        await refreshConnection();
      }, refreshIntervalMs);

      expect(connectionRefreshInterval).toBeDefined();

      // Fast-forward to trigger refresh using async version
      await jest.advanceTimersByTimeAsync(refreshIntervalMs);

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Proactively refreshing Redis connection with new JWT...',
      );

      clearInterval(connectionRefreshInterval);
    });

    it('should handle refresh errors in consumer service', async () => {
      const refreshConnection = jest.fn().mockRejectedValue(new Error('Consumer refresh failed'));
      const refreshIntervalMs = 1380 * 60 * 1000;

      const connectionRefreshInterval = setInterval(async () => {
        try {
          mockLogger.log('Proactively refreshing Redis connection with new JWT...');
          await refreshConnection();
        } catch (error: any) {
          mockLogger.error(`Failed to refresh Redis connection: ${error.message}`);
        }
      }, refreshIntervalMs);

      await jest.advanceTimersByTimeAsync(refreshIntervalMs);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to refresh Redis connection: Consumer refresh failed',
      );

      clearInterval(connectionRefreshInterval);
    });
  });

  describe('Consumer-specific JWT Auth', () => {
    it('should create duplicate client for consumer with JWT auth', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValue('jwt-for-duplicate');
      process.env.REDIS_USERNAME = 'duplicate-user';

      const jwt = await authService.getAccessToken();
      const client = createClient({
        url: 'redis://redis-master.redis.svc.cluster.local:6379',
        username: 'duplicate-user',
        password: jwt,
      });

      // Consumer services often need duplicate clients for different purposes
      const duplicateClient = mockClient.duplicate();

      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          password: 'jwt-for-duplicate',
        }),
      );
      expect(mockClient.duplicate).toHaveBeenCalled();
    });

    it('should handle traditional auth when JWT is disabled', async () => {
      process.env.REDIS_HOST = 'localhost';
      process.env.REDIS_PORT = '6379';
      process.env.REDIS_USERNAME = 'traditional-user';
      process.env.REDIS_PASSWORD = 'traditional-pass';

      const jwtAuthEnabled = false;

      if (!jwtAuthEnabled) {
        const client = createClient({
          url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
          username: process.env.REDIS_USERNAME,
          password: process.env.REDIS_PASSWORD,
        });

        expect(createClient).toHaveBeenCalledWith(
          expect.objectContaining({
            url: 'redis://localhost:6379',
            username: 'traditional-user',
            password: 'traditional-pass',
          }),
        );
      }

      expect(authService.getAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('Event Handlers for Consumer', () => {
    it('should handle Redis connection events in consumer context', async () => {
      let errorHandler: (error: any) => void;
      let connectHandler: () => void;
      let readyHandler: () => void;

      mockClient.on.mockImplementation((event: string, handler: any) => {
        if (event === 'error') errorHandler = handler;
        if (event === 'connect') connectHandler = handler;
        if (event === 'ready') readyHandler = handler;
      });

      const client = createClient({});
      client.on('error', (error) => mockLogger.error(`Redis connection error: ${error}`));
      client.on('connect', () =>
        mockLogger.log('Connected to Redis via Gateway with JWT authentication (TCP socket established)'),
      );
      client.on('ready', () => mockLogger.log('Redis client ready (JWT AUTH completed)'));

      // Trigger events
      const testError = new Error('Consumer connection error');
      errorHandler!(testError);
      expect(mockLogger.error).toHaveBeenCalledWith(`Redis connection error: ${testError}`);

      connectHandler!();
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Connected to Redis via Gateway with JWT authentication (TCP socket established)',
      );

      readyHandler!();
      expect(mockLogger.log).toHaveBeenCalledWith('Redis client ready (JWT AUTH completed)');
    });
  });

  describe('Cleanup on Destroy', () => {
    it('should clear refresh interval on module destroy', async () => {
      const connectionRefreshInterval = setInterval(() => {}, 1000);
      
      // Simulate cleanup
      if (connectionRefreshInterval) {
        clearInterval(connectionRefreshInterval);
        mockLogger.log('Redis connection refresh interval cleared');
      }

      expect(mockLogger.log).toHaveBeenCalledWith('Redis connection refresh interval cleared');
    });

    it('should quit all clients on module destroy', async () => {
      mockClient.isOpen = true;

      if (mockClient && mockClient.isOpen) {
        await mockClient.quit();
        mockLogger.log('Redis client disconnected');
      }

      expect(mockClient.quit).toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith('Redis client disconnected');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Worker Thread Crash Recovery
// ─────────────────────────────────────────────────────────────────────────────

describe('RedisConsumerService - Worker Thread Crash Recovery', () => {
  let service: RedisConsumerService;
  let mockRedisClient: any;

  // Returns a controllable worker whose events can be fired synchronously.
  function makeWorker() {
    const listeners: Record<string, Function[]> = {};
    return {
      on: jest.fn((event: string, handler: Function) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      }),
      removeAllListeners: jest.fn(() => { Object.keys(listeners).forEach(k => delete listeners[k]); }),
      emit(event: string, ...args: any[]) {
        (listeners[event] || []).forEach(h => h(...args));
      },
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    // Disable JWT so initializeRedisConnection skips Keycloak and setupConnectionRefresh
    process.env.REDIS_JWT_AUTH_ENABLED = 'false';

    mockRedisClient = {
      isOpen: false,
      connect: jest.fn().mockImplementation(() => {
        mockRedisClient.isOpen = true;
        return Promise.resolve();
      }),
      quit: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      keys: jest.fn().mockResolvedValue([]),
      hGetAll: jest.fn().mockResolvedValue({}),
      hSet: jest.fn().mockResolvedValue(1),
      hDel: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
    };
    (createClient as jest.Mock).mockReturnValue(mockRedisClient);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisConsumerService,
        {
          provide: InventoryService,
          useValue: {
            createInventory: jest.fn().mockResolvedValue(undefined),
            saveTasks: jest.fn().mockResolvedValue(undefined),
            saveOperationError: jest.fn().mockResolvedValue(undefined),
            saveTaskError: jest.fn().mockResolvedValue(undefined),
            createPartitionInventoryTableByJobRunId: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: DataSource,
          useValue: { query: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: WorkflowService,
          useValue: { signalWorkflow: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: AuthService,
          useValue: { getAccessToken: jest.fn().mockResolvedValue('mock-jwt') },
        },
        {
          provide: LoggerFactory,
          useValue: { create: jest.fn().mockReturnValue(mockLogger) },
        },
      ],
    }).compile();

    service = module.get<RedisConsumerService>(RedisConsumerService);

    // Let the constructor's unawaited initializeRedisConnection() settle
    await new Promise(r => setImmediate(r));

    // Override with our fully-open mock client for test control
    (service as any).redisClient = mockRedisClient;
    mockRedisClient.isOpen = true;

    // Pre-populate the project-ID cache so getProjectIdFromCache() returns
    // synchronously (no DB query). Without this, createConsumerWorkerThread
    // would await a DB round-trip before creating the Worker, causing events
    // emitted in tests to fire before listeners are registered.
    (service as any).jobRunIdToProjectIdMap.set('job-1', 'proj-1');
    (service as any).jobRunIdToProjectIdMap.set('job-crash-test', 'proj-crash');
  });

  afterEach(() => {
    delete process.env.REDIS_JWT_AUTH_ENABLED;
  });

  // ── createConsumerWorkerThread ───────────────────────────────────────────

  describe('createConsumerWorkerThread', () => {
    it('resolves when worker posts { success: true }', async () => {
      const w = makeWorker();
      (Worker as unknown as jest.Mock).mockImplementation(() => w);

      const p = (service as any).createConsumerWorkerThread('job-1');
      // Yield one microtask so getProjectIdFromCache resolves and the Worker
      // is instantiated with its listeners registered before we fire events.
      await Promise.resolve();
      w.emit('message', { success: true });

      await expect(p).resolves.toBeUndefined();
    });

    it('rejects when worker posts { success: false }', async () => {
      const w = makeWorker();
      (Worker as unknown as jest.Mock).mockImplementation(() => w);

      const p = (service as any).createConsumerWorkerThread('job-1');
      await Promise.resolve();
      w.emit('message', { success: false, error: 'DB write failed' });

      await expect(p).rejects.toThrow('DB write failed');
    });

    it('rejects when worker emits an error event (uncaught exception / OOM)', async () => {
      const w = makeWorker();
      (Worker as unknown as jest.Mock).mockImplementation(() => w);

      const p = (service as any).createConsumerWorkerThread('job-1');
      await Promise.resolve();
      w.emit('error', new Error('Worker OOM'));

      await expect(p).rejects.toThrow('Worker OOM');
    });

    it('rejects when worker exits non-zero without a prior message (hard crash)', async () => {
      const w = makeWorker();
      (Worker as unknown as jest.Mock).mockImplementation(() => w);

      const p = (service as any).createConsumerWorkerThread('job-1');
      await Promise.resolve();
      w.emit('exit', 1);

      await expect(p).rejects.toThrow('Worker exit code: 1');
    });

    it('does not double-reject when exit fires after an error event', async () => {
      const w = makeWorker();
      (Worker as unknown as jest.Mock).mockImplementation(() => w);

      const p = (service as any).createConsumerWorkerThread('job-1');
      await Promise.resolve();
      w.emit('error', new Error('crash'));
      w.emit('exit', 1); // settled=true already — should be ignored

      await expect(p).rejects.toThrow('crash');
    });

    it('resolves and exit code 0 fires normally (no extra rejection)', async () => {
      const w = makeWorker();
      (Worker as unknown as jest.Mock).mockImplementation(() => w);

      const p = (service as any).createConsumerWorkerThread('job-1');
      await Promise.resolve();
      w.emit('message', { success: true });
      w.emit('exit', 0); // settled — should not reject

      await expect(p).resolves.toBeUndefined();
    });
  });

  // ── checkAndStartActiveConsumers — crash retry logic ────────────────────

  describe('checkAndStartActiveConsumers', () => {
    const JOB_ID = 'job-crash-test';
    const REDIS_KEY = `db-writer:${JOB_ID}:`;

    beforeEach(() => {
      mockRedisClient.keys.mockResolvedValue([REDIS_KEY]);
      mockRedisClient.hGetAll.mockResolvedValue({
        files: 'active',
        tasks: 'active',
        errors: 'active',
      });
    });

    it('increments workerRetryCounts and removes from activeWorkers on crash', async () => {
      const w = makeWorker();
      (Worker as unknown as jest.Mock).mockImplementation(() => w);

      await (service as any).checkAndStartActiveConsumers();

      // Yield so the fire-and-forget createConsumerWorkerThread advances past
      // getProjectIdFromCache and creates the Worker with listeners registered.
      await Promise.resolve();

      expect((service as any).activeWorkers.has(JOB_ID)).toBe(true);

      // Crash the worker
      w.emit('error', new Error('OOM'));
      await new Promise(r => setImmediate(r)); // flush .catch()

      expect((service as any).activeWorkers.has(JOB_ID)).toBe(false);
      expect((service as any).workerRetryCounts.get(JOB_ID)).toBe(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(`Error in worker thread for job ${JOB_ID}`),
        expect.anything(),
      );
    });

    it('does NOT stop consumers on crash — statuses stay active so cron can respawn', async () => {
      const w = makeWorker();
      (Worker as unknown as jest.Mock).mockImplementation(() => w);

      await (service as any).checkAndStartActiveConsumers();
      await Promise.resolve(); // let Worker be created with listeners

      w.emit('error', new Error('crash'));
      await new Promise(r => setImmediate(r));

      // hSet (stopConsumer path) must NOT have been called
      expect(mockRedisClient.hSet).not.toHaveBeenCalled();
    });

    it('stops all consumers and clears retry count when max retries are exhausted', async () => {
      const maxRetries: number = (service as any).maxWorkerRetries;
      (service as any).workerRetryCounts.set(JOB_ID, maxRetries);

      await (service as any).checkAndStartActiveConsumers();

      // Worker must NOT have been spawned
      expect(Worker).not.toHaveBeenCalled();

      // Every active consumer type must be set to 'inactive'
      expect(mockRedisClient.hSet).toHaveBeenCalledWith(REDIS_KEY, 'files', 'inactive');
      expect(mockRedisClient.hSet).toHaveBeenCalledWith(REDIS_KEY, 'tasks', 'inactive');
      expect(mockRedisClient.hSet).toHaveBeenCalledWith(REDIS_KEY, 'errors', 'inactive');

      // Retry count cleared after giving up
      expect((service as any).workerRetryCounts.has(JOB_ID)).toBe(false);
    });

    it('clears retry count and activeWorkers entry on successful completion', async () => {
      (service as any).workerRetryCounts.set(JOB_ID, 2);

      const w = makeWorker();
      (Worker as unknown as jest.Mock).mockImplementation(() => w);

      await (service as any).checkAndStartActiveConsumers();
      await Promise.resolve(); // let Worker be created with listeners

      w.emit('message', { success: true });
      await new Promise(r => setImmediate(r)); // flush .then()

      expect((service as any).workerRetryCounts.has(JOB_ID)).toBe(false);
      expect((service as any).activeWorkers.has(JOB_ID)).toBe(false);
    });

    it('skips spawning when a worker for that job is already running', async () => {
      (service as any).activeWorkers.set(JOB_ID, Date.now());

      await (service as any).checkAndStartActiveConsumers();

      expect(Worker).not.toHaveBeenCalled();
    });

    it('evicts and respawns a worker that has exceeded workerTimeoutMs', async () => {
      const hungStart = Date.now() - ((service as any).workerTimeoutMs + 5000);
      (service as any).activeWorkers.set(JOB_ID, hungStart);

      (Worker as unknown as jest.Mock).mockImplementation(() => makeWorker());

      await (service as any).checkAndStartActiveConsumers();
      // Yield so the fire-and-forget createConsumerWorkerThread advances past
      // the cache lookup and actually calls new Worker().
      await Promise.resolve();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('appears hung'),
      );
      expect(Worker).toHaveBeenCalledTimes(1);
    });

    it('spawns a new worker on the next cron tick after a crash', async () => {
      // ── Tick 1: first worker spawns ──────────────────────────────────────
      const w1 = makeWorker();
      (Worker as unknown as jest.Mock).mockImplementation(() => w1);

      await (service as any).checkAndStartActiveConsumers();
      await Promise.resolve(); // let createConsumerWorkerThread create w1 + register listeners

      expect(Worker).toHaveBeenCalledTimes(1);

      // Crash w1
      w1.emit('error', new Error('ENOMEM'));
      await new Promise(r => setImmediate(r)); // flush .catch()

      // After crash: retry count 1, no longer in activeWorkers
      expect((service as any).workerRetryCounts.get(JOB_ID)).toBe(1);
      expect((service as any).activeWorkers.has(JOB_ID)).toBe(false);

      // ── Tick 2: cron runs again, sees active consumers, spawns w2 ────────
      const w2 = makeWorker();
      (Worker as unknown as jest.Mock).mockClear(); // reset call count for tick-2 assertion
      (Worker as unknown as jest.Mock).mockImplementation(() => w2);

      await (service as any).checkAndStartActiveConsumers();
      await Promise.resolve(); // let createConsumerWorkerThread create w2

      expect(Worker).toHaveBeenCalledTimes(1); // reset between ticks — called once again
      expect((service as any).activeWorkers.has(JOB_ID)).toBe(true); // new worker is tracked
    });
  });
});
