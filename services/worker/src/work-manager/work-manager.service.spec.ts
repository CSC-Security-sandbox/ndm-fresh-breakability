import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { NativeConnection, Worker } from '@temporalio/worker';
import { of } from 'rxjs';
import { WorkManagerService } from './work-manager.service';
import { WorkerConfiguration, WorkerState } from './work-manager.types';
import { WorkerOptionsService } from './factory/worker-options.factory.service';
import { AuthService } from 'src/auth/auth.service';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from '../auth/auth.service.spec';

jest.mock('@nestjs/axios');
jest.mock('@nestjs/config');
jest.mock('./factory/worker-options.factory');
jest.mock('src/utils/worker-manager.mappers', () => ({
  getWorkerIdentity: (config: any) => `${config.workerId}-${config.configName}`,
}));
jest.mock('@temporalio/worker', () => ({
  Worker: { create: jest.fn() },
  WorkerState: {
    INITIALIZED: 'initialized',
    RUNNING: 'running',
    STOPPED: 'stopped',
  },
  NativeConnection: { connect: jest.fn() },
}));
jest.mock('@temporalio/client', () => ({
  Connection: { connect: jest.fn() }
}));

describe('WorkManagerService', () => {
  let service: WorkManagerService;
  let httpService: HttpService;
  let configService: ConfigService;
  let authService: AuthService;
  let loggerFactory: LoggerFactory;
  let logger: LoggerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkManagerService,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
            post: jest.fn(),
            subscribe: jest.fn().mockImplementation((nextFn: any) => nextFn.next()),
          },
        },
        {
          provide: AuthService,
          useValue: {
            getAccessToken: jest.fn().mockResolvedValue('mock-access-token'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((s: string) => {
              if (s === 'worker.workerStartupTimeout') return 10;
              if (s === 'worker.connection.workerConfigUrl') return 'http://localhost/config';
              if (s === 'worker.workerId') return 'test-worker';
              if (s === 'keycloak') {
                return {
                  baseUrl: 'http://localhost/auth',
                  realm: 'test-realm',
                  workerSecret: 'secret',
                };
              }
              if (s === 'temporal') return 'temporal-address';
              return 'test-value';
            }),
          },
        },
        { provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        {
          provide: WorkerOptionsService,
          useValue: {}
        }
      ],
    }).compile();

    service = module.get<WorkManagerService>(WorkManagerService);
    authService = module.get<AuthService>(AuthService);
    httpService = module.get<HttpService>(HttpService);
    configService = module.get<ConfigService>(ConfigService);
    loggerFactory = module.get<LoggerFactory>(LoggerFactory);
    logger = loggerFactory.create(WorkManagerService.name);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleCron', () => {
    it('should fetch configurations and call handleConfigurations', async () => {
      service['loadingConfigs'] = false;
      jest.spyOn(authService, 'getAccessToken').mockResolvedValue('valid-token');
      jest.spyOn(httpService, 'get').mockReturnValue(
        of({ status: 200, data: [] } as any)
      );
      jest.spyOn(service, 'handleConfigurations').mockResolvedValue(undefined);

      await service.handleCron();
      expect(service['handleConfigurations']).toHaveBeenCalledWith([]);
    });

    it('should log error when accessToken is null', async () => {
      service['loadingConfigs'] = false;
      jest.spyOn(authService, 'getAccessToken').mockResolvedValue(null);
      await service.handleCron();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringMatching(/Error fetching configurations: Access token is null/)
      );
    });

    it('should throw error on non-200 response', async () => {
      service['loadingConfigs'] = false;
      jest.spyOn(authService, 'getAccessToken').mockResolvedValue('valid-token');
      jest.spyOn(httpService, 'get').mockReturnValue(
        of({ status: 500, data: [] } as any)
      );
      await service.handleCron();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringMatching(/Failed to fetch configurations. Status: 500/)
      );
    });

    it('should skip if loadingConfigs is true', async () => {
      service['loadingConfigs'] = true;
      await service.handleCron();
      expect(logger.debug).toHaveBeenCalledWith('Already loading configurations, skipping this cycle.');
    });

    it('should call monitorTaskQueues after handleConfigurations in handleCron', async () => {
      service['loadingConfigs'] = false;
      jest.spyOn(authService, 'getAccessToken').mockResolvedValue('valid-token');
      jest.spyOn(httpService, 'get').mockReturnValue(
        of({ status: 200, data: [] } as any)
      );
      jest.spyOn(service, 'handleConfigurations').mockResolvedValue(undefined);
      const monitorTaskQueuesSpy = jest.spyOn(service, 'monitorTaskQueues').mockResolvedValue(undefined);

      await service.handleCron();

      expect(monitorTaskQueuesSpy).toHaveBeenCalled();
    });

    it('should set loadingConfigs to false after handleCron, even on error', async () => {
      service['loadingConfigs'] = false;
      jest.spyOn(authService, 'getAccessToken').mockRejectedValue(new Error('fail'));
      await service.handleCron();
      expect(service['loadingConfigs']).toBe(false);
    });
  });

  describe('startWorker', () => {
    it('should wait until worker state is RUNNING and then call run()', async () => {
      const id = 'worker1';
      const workerOptions = { options: 'workerOptions' };
      const worker: Worker = {
        getState: jest.fn()
          .mockReturnValueOnce(WorkerState.INITIALIZED)
          .mockReturnValueOnce(WorkerState.RUNNING),
        run: jest.fn(),
        options: { identity: id },
        shutdown: jest.fn(),
      } as any;

      (Worker.create as jest.Mock).mockResolvedValue(worker);

      await service.startWorker(id, workerOptions);
      expect(worker.getState).toHaveBeenCalledTimes(2);
      expect(worker.run).toHaveBeenCalled();
      expect(service['activeWorkers'].get(id)).toBe(worker);
    }, 3000);

    describe('error handling', () => {
      it('should log error if create worker throws error ', async () => {
        const id = 'worker-error';
        const workerOptions = { options: 'workerOptions' };
        (Worker.create as jest.Mock).mockRejectedValue(new Error('Worker create failed'));
        await service.startWorker(id, workerOptions);
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringMatching(/Error starting worker worker-error: Error: Worker create failed/)
        );
      });
    });
  });

  describe('shutdownWorker', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should shutdown the worker gracefully (non-forced)', async () => {
      const id = 'worker1';
      const worker: Worker = {
        getState: jest.fn()
          .mockReturnValueOnce(WorkerState.RUNNING)
          .mockReturnValueOnce(WorkerState.STOPPED),
        shutdown: jest.fn(),
        options: { identity: id },
      } as any;

      await service.shutdownWorker(worker, false);
      jest.advanceTimersByTime(100);
      expect(worker.shutdown).toHaveBeenCalled();
      expect(worker.getState).toHaveBeenCalledTimes(2);
    });

    it('should shutdown the worker immediately when forced', async () => {
      const id = 'worker2';
      const worker: Worker = {
        getState: jest.fn().mockReturnValue(WorkerState.RUNNING),
        shutdown: jest.fn(),
        options: { identity: id },
      } as any;
      await service.shutdownWorker(worker, true);
      jest.advanceTimersByTime(100);
      expect(worker.shutdown).toHaveBeenCalled();
    });

    describe('edge cases', () => {
      it('should not call shutdown if worker is already stopped', async () => {
        const worker: Worker = {
          getState: jest.fn().mockReturnValue(WorkerState.STOPPED),
          shutdown: jest.fn(),
          options: { identity: 'worker-stopped' },
        } as any;
        await service.shutdownWorker(worker, false);
        expect(worker.shutdown).not.toHaveBeenCalled();
      });

      it('should log if worker did not shutdown in forced mode', async () => {
        const worker: Worker = {
          getState: jest.fn().mockReturnValue(WorkerState.RUNNING),
          shutdown: jest.fn(),
          options: { identity: 'worker-force' },
        } as any;
        await service.shutdownWorker(worker, true);
        jest.advanceTimersByTime(service['workerStartupTimeout']);
        expect(logger.debug).toHaveBeenCalledWith('Worker did not shutdown');
      });

      it('should log if worker shutdown in forced mode', async () => {
        const worker: Worker = {
          getState: jest.fn()
            .mockReturnValueOnce(WorkerState.RUNNING)
            .mockReturnValueOnce(WorkerState.STOPPED),
          shutdown: jest.fn(),
          options: { identity: 'worker-force-stopped' },
        } as any;
        await service.shutdownWorker(worker, true);
        jest.advanceTimersByTime(service['workerStartupTimeout']);
        expect(logger.debug).toHaveBeenCalledWith('Worker shutdown');
      });
    });
  });

  describe('onApplicationBootstrap', () => {
    it('should establish a connection to Temporal and log startup info', async () => {
      (NativeConnection.connect as jest.Mock).mockResolvedValue('connected');
      await service.onApplicationBootstrap();
      expect(logger.log).toHaveBeenCalledWith('[onApplicationBootstrap] - Starting Worker Service');
      expect(service['connection']).toEqual('connected');
    });

    it('should log and throw error if Temporal connection fails', async () => {
      (NativeConnection.connect as jest.Mock).mockRejectedValue(new Error('Connection error'));
      await expect(service.onApplicationBootstrap()).rejects.toThrow('Connection error');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringMatching(/Error on setting temporal connection: Error: Connection error/)
      );
    });
  });

  describe('handleConfigurations', () => {
    let mockConfigs: WorkerConfiguration[];

    beforeEach(() => {
      mockConfigs = [
        {
          workerId: 'worker-1',
          configName: 'PARENT_WORKFLOW',
          taskQueueId: 'taskQueue1',
          dynamicTaskQueue: true,
        },
        {
          workerId: 'worker-2',
          configName: 'WORKER_SPECIFIC_WORKFLOW',
          taskQueueId: 'taskQueue2',
          dynamicTaskQueue: false,
        },
      ];
    });

    it('should not error when given an empty configurations array', async () => {
      const worker: Worker = {
        getState: jest.fn().mockReturnValue(WorkerState.RUNNING),
        shutdown: jest.fn(),
        options: { identity: 'worker-1-PARENT_WORKFLOW' },
      } as any;
      service['activeWorkers'].set('worker-1-PARENT_WORKFLOW', worker);
      const shutdownWorkerSpy = jest
        .spyOn(service, 'shutdownWorker')
        .mockResolvedValue(undefined);
      await service.handleConfigurations([]);
      expect(shutdownWorkerSpy).toHaveBeenCalledWith(worker, false);
      expect(service['activeWorkers'].size).toEqual(0);
    });

    it('should stop workers not present in configs', async () => {
      const worker: Worker = {
        getState: jest.fn().mockReturnValue(WorkerState.RUNNING),
        shutdown: jest.fn(),
        options: { identity: 'old-worker-OLD_WORKFLOW' },
      } as any;
      service['activeWorkers'].set('old-worker-OLD_WORKFLOW', worker);
      const shutdownWorkerSpy = jest.spyOn(service, 'shutdownWorker').mockResolvedValue(undefined);
      await service.handleConfigurations([]);
      expect(shutdownWorkerSpy).toHaveBeenCalledWith(worker, false);
      expect(service['activeWorkers'].size).toBe(0);
    });

    it('should start new workers for configs not in activeWorkers', async () => {
      const config: WorkerConfiguration = {
        workerId: 'worker-3',
        configName: 'NEW_WORKFLOW',
        taskQueueId: 'queue3',
        dynamicTaskQueue: false,
      };
      service['activeWorkers'].clear();
      service['workerOptions'].createWorkerOptions = jest.fn().mockReturnValue({ taskQueue: 'queue3', options: {} });
      const startWorkerSpy = jest.spyOn(service, 'startWorker').mockResolvedValue(undefined);

      await service.handleConfigurations([config]);
      expect(startWorkerSpy).toHaveBeenCalledWith('worker-3-NEW_WORKFLOW', expect.anything());
    });

    it('should not start worker if already active', async () => {
      const config: WorkerConfiguration = {
        workerId: 'worker-4',
        configName: 'EXISTING_WORKFLOW',
        taskQueueId: 'queue4',
        dynamicTaskQueue: false,
      };
      const id = 'worker-4-EXISTING_WORKFLOW';
      service['activeWorkers'].set(id, {} as any);
      service['workerOptions'].createWorkerOptions = jest.fn();
      const startWorkerSpy = jest.spyOn(service, 'startWorker').mockResolvedValue(undefined);

      await service.handleConfigurations([config]);
      expect(startWorkerSpy).not.toHaveBeenCalled();
    });
  });

  describe('monitorTaskQueues', () => {
    beforeEach(() => {
      service['temporalClientConnection'] = {
        workflowService: {
          describeTaskQueue: jest.fn(),
        },
      } as any;
    });

    it('should remove worker if pollers are empty', async () => {
      const mockWorker = {
        getState: jest.fn().mockReturnValue(WorkerState.RUNNING),
        shutdown: jest.fn(),
        options: { identity: 'worker1' },
      }
      service['taskQueuesToMonitor'] = [{ queueName: 'queue1', workerId: 'worker1' }];
      service['activeWorkers'].set('worker1', mockWorker as any);

      (service['temporalClientConnection'].workflowService.describeTaskQueue as jest.Mock)
        .mockResolvedValue({ pollers: [] });
      await service.monitorTaskQueues();
      expect(mockWorker.shutdown).toHaveBeenCalled();
      expect(service['activeWorkers'].has('worker1')).toBe(false);
    });

    it('should not remove worker if pollers are present', async () => {
      service['taskQueuesToMonitor'] = [{ queueName: 'queue2', workerId: 'worker2' }];
      service['activeWorkers'].set('worker2', { options: { identity: 'worker2' } } as any);

      (service['temporalClientConnection'].workflowService.describeTaskQueue as jest.Mock)
        .mockResolvedValue({ pollers: [{ identity: 'worker2' }] });

      await service.monitorTaskQueues();

      expect(service['activeWorkers'].has('worker2')).toBe(true);
    });

    it('should handle multiple task queues', async () => {
      const mockWorker1 = {
        getState: jest.fn().mockReturnValue(WorkerState.RUNNING),
        shutdown: jest.fn(),
        options: { identity: 'worker1' },
      }
      const mockWorker2 = {
        getState: jest.fn().mockReturnValue(WorkerState.RUNNING),
        shutdown: jest.fn(),
        options: { identity: 'worker2' },
      }
      service['taskQueuesToMonitor'] = [
        { queueName: 'queue1', workerId: 'worker1' },
        { queueName: 'queue2', workerId: 'worker2' },
      ];
      service['activeWorkers'].set('worker1',  mockWorker1 as any);
      service['activeWorkers'].set('worker2', mockWorker2 as any);

      (service['temporalClientConnection'].workflowService.describeTaskQueue as jest.Mock)
        .mockImplementation(({ taskQueue }) => {
          if (taskQueue.name === 'queue1') return Promise.resolve({ pollers: [] });
          return Promise.resolve({ pollers: [{ identity: 'worker2' }] });
        });

      await service.monitorTaskQueues();
      expect(mockWorker1.shutdown).toHaveBeenCalled();
      expect(service['activeWorkers'].has('worker1')).toBe(false);
      expect(service['activeWorkers'].has('worker2')).toBe(true);
    });

    it('should log and continue if shutdownWorker throws in monitorTaskQueues', async () => {
      const mockWorker = {
        getState: jest.fn().mockReturnValue(WorkerState.RUNNING),
        shutdown: jest.fn(),
        options: { identity: 'worker7' },
      };
      service['taskQueuesToMonitor'] = [{ queueName: 'queue7', workerId: 'worker7' }];
      service['activeWorkers'].set('worker7', mockWorker as any);
      service['temporalClientConnection'] = {
        workflowService: {
          describeTaskQueue: jest.fn().mockResolvedValue({ pollers: [] }),
        },
      } as any;
      jest.spyOn(service, 'shutdownWorker').mockRejectedValue(new Error('shutdown error'));
      await service.monitorTaskQueues();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringMatching(/Error shutting down worker worker7: Error: shutdown error/)
      );
      expect(service['activeWorkers'].has('worker7')).toBe(false);
    });
  });
});