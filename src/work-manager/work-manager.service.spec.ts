import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { NativeConnection, Worker } from '@temporalio/worker';
import { of, throwError } from 'rxjs';
import { Logger } from 'src/logger/logger.service';
import { WorkManagerService } from './work-manager.service';
import { WorkerConfiguration, WorkerState } from './work-manager.types';
import { WorkerOptionsService } from './factory/worker-options.factory.service';
import { AuthService } from 'src/auth/auth.service';

jest.mock('@nestjs/axios');
jest.mock('@nestjs/config');
jest.mock('src/logger/logger.service');
jest.mock('./factory/worker-options.factory');
jest.mock('src/utils/worker-manager.mappers', () => ({
  getWorkerIdentity: (config: any) => `${config.workerId}-${config.configName}`,
}));

jest.mock('@temporalio/worker', () => ({
  Worker: {
    create: jest.fn(),
  },
  WorkerState: {
    INITIALIZED: 'initialized',
    RUNNING: 'running',
    STOPPED: 'stopped',
  },
  NativeConnection: {
    connect: jest.fn(),
  },
}));

describe('WorkManagerService', () => {
  let service: WorkManagerService;
  let httpService: HttpService;
  let configService: ConfigService;
  let authService: AuthService;
  let logger: Logger;

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
        {
          provide: Logger,
          useValue: {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
          },
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
    logger = module.get<Logger>(Logger);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });


  describe('handleCron', () => {
    it('should exit early if loadingConfigs is true', async () => {
      service['loadingConfigs'] = true;
      await service.handleCron();
      // No logs for error fetching configs expected if loadingConfigs is true
      expect(logger.error).not.toHaveBeenCalled();
    });

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
  });

  describe('onApplicationBootstrap', () => {
    it('should establish a connection to Temporal and log startup info', async () => {
      (NativeConnection.connect as jest.Mock).mockResolvedValue('connected');
      await service.onApplicationBootstrap();
      expect(logger.info).toHaveBeenCalledWith('[onApplicationBootstrap] - Starting Worker Service');
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
  });
});
