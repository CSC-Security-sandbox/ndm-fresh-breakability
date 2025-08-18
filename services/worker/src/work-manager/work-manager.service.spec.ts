import { Test, TestingModule } from '@nestjs/testing';
import { NativeConnection, Worker } from '@temporalio/worker';
import { of } from 'rxjs';
import { WorkManagerService } from './work-manager.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { WorkerOptionsService } from './factory/worker-options.factory.service';
import { AuthService } from 'src/auth/auth.service';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from '../auth/auth.service.spec';

jest.mock('@nestjs/axios');
jest.mock('@nestjs/config');
jest.mock('./factory/worker-options.factory');
jest.mock('src/utils/worker-manager.mappers', () => ({
  getWorkerIdentity: (config: any) => `${config.workerId}-${config.configName}`,
  getPlatform: jest.fn(() => 'LINUX'), // or whatever platform string you expect
}));

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

describe('WorkManagerService', () => {
  let service: WorkManagerService;
  let configService: any;
  let httpService: any;
  let workerOptions: any;
  let authService: any;
  let loggerFactory: LoggerFactory;
  let logger: LoggerService;

  beforeEach(async () => {
    configService = {
      get: jest.fn((key: string) => {
        const map = {
          'worker.connection.workerConfigUrl': 'http://mock-url',
          'worker.workerId': 'worker-1',
          'worker.workerStartupTimeout': 10,
          'worker.platform': 'LINUX',
          temporal: {},
        };
        return map[key];
      }),
    };
    httpService = {
      get: jest.fn(),
    };
    workerOptions = {
      createWorkerOptions: jest
        .fn()
        .mockReturnValue({ taskQueue: 'tq', identity: 'id' }),
    };
    authService = {
      getAccessToken: jest.fn().mockResolvedValue('token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkManagerService,
        { provide: ConfigService, useValue: configService },
        { provide: HttpService, useValue: httpService },
        { provide: LoggerFactory, useValue: mockLoggerFactory },
        { provide: WorkerOptionsService, useValue: workerOptions },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    service = module.get<WorkManagerService>(WorkManagerService);
    authService = module.get<AuthService>(AuthService);
    httpService = module.get<HttpService>(HttpService);
    configService = module.get<ConfigService>(ConfigService);
    loggerFactory = module.get<LoggerFactory>(LoggerFactory);
    logger = loggerFactory.create(WorkManagerService.name);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onApplicationBootstrap', () => {
    it('should connect to temporal', async () => {
      const nativeConnect =
        require('@temporalio/worker').NativeConnection.connect;
      const clientConnect = require('@temporalio/client').Connection.connect;
      nativeConnect.mockResolvedValue('native-conn');
      clientConnect.mockResolvedValue('client-conn');
      await service.onApplicationBootstrap();
      expect(nativeConnect).toHaveBeenCalled();
      expect(clientConnect).toHaveBeenCalled();
      expect(service['connection']).toBe('native-conn');
      expect(service['temporalClientConnection']).toBe('client-conn');
    });

    it('should log and throw on connection error', async () => {
      const nativeConnect =
        require('@temporalio/worker').NativeConnection.connect;
      nativeConnect.mockRejectedValue(new Error('fail'));
      await expect(service.onApplicationBootstrap()).rejects.toThrow('fail');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error on setting temporal connection:'),
      );
    });
  });

  describe('handleCron', () => {
    it('should skip if already loading configs', async () => {
      service['loadingConfigs'] = true;
      await service.handleCron();
      expect(logger.debug).toHaveBeenCalledWith(
        'Already loading configurations, skipping this cycle.',
      );
    });

    it('should fetch configs, handle them, and monitor task queues', async () => {
      service['loadingConfigs'] = false;
      const mockData = [{ id: 1 }];
      httpService.get.mockReturnValue(of({ status: 200, data: { data: { items: mockData } } }));
      jest.spyOn(service, 'handleConfigurations').mockResolvedValue(undefined);
      jest.spyOn(service, 'monitorTaskQueues').mockResolvedValue(undefined);

      await service.handleCron();

      expect(authService.getAccessToken).toHaveBeenCalled();
      expect(httpService.get).toHaveBeenCalled();
      expect(service.handleConfigurations).toHaveBeenCalledWith(mockData);
      expect(service.monitorTaskQueues).toHaveBeenCalled();
      expect(service['loadingConfigs']).toBe(false);
    });

    it('should log error if fetching configs fails', async () => {
      authService.getAccessToken.mockResolvedValue('token');
      httpService.get.mockImplementation(() => {
        throw new Error('fail');
      });
      await service.handleCron();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error fetching configurations:'),
      );
      expect(service['loadingConfigs']).toBe(false);
    });
  });

  describe('handleConfigurations', () => {
    it('should start and stop workers as needed', async () => {
      const mockWorker = {
        getState: jest.fn().mockReturnValue('RUNNING'),
        shutdown: jest.fn(),
        options: { identity: 'id' },
      };
      service['activeWorkers'].set('old', mockWorker as any);
      jest.spyOn(service, 'shutdownWorker').mockResolvedValue(undefined);
      jest.spyOn(service, 'startWorker').mockResolvedValue(undefined);

      const configs = [{ id: 1, platform: 'LINUX' }];
      jest
        .spyOn(require('src/utils/worker-manager.mappers'), 'getWorkerIdentity')
        .mockReturnValueOnce('new');

      await service.handleConfigurations(configs as any);

      expect(service.shutdownWorker).toHaveBeenCalled();
      expect(service.startWorker).toHaveBeenCalled();
    });
  });

  describe('startWorker', () => {
    it('should create, run, and track worker', async () => {
      const Worker = require('@temporalio/worker').Worker;
      const mockWorker = {
        getState: jest
          .fn()
          .mockReturnValueOnce('INITIALIZED')
          .mockReturnValueOnce('RUNNING'),
        run: jest.fn(),
        options: { identity: 'id' },
      };
      Worker.create.mockResolvedValue(mockWorker);

      await service.startWorker('id', { taskQueue: 'tq', identity: 'id' });

      expect(Worker.create).toHaveBeenCalled();
      expect(mockWorker.run).toHaveBeenCalled();
      expect(service['activeWorkers'].get('id')).toBe(mockWorker);
    });

    it('should log error if worker fails to start', async () => {
      const Worker = require('@temporalio/worker').Worker;
      Worker.create.mockRejectedValue(new Error('fail'));
      await service.startWorker('id', { taskQueue: 'tq', identity: 'id' });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error starting worker id:'),
      );
    });
  });

  describe('shutdownWorker', () => {
    it('should shutdown gracefully and remove from taskQueues', async () => {
      const mockWorker = {
        getState: jest
          .fn()
          .mockReturnValueOnce('RUNNING')
          .mockReturnValueOnce('STOPPED'),
        shutdown: jest.fn(),
        options: { identity: 'id' },
      };
      service['taskQueuesToMonitor'] = [{ queueName: 'tq', workerId: 'id' }];
      await service.shutdownWorker(mockWorker as any, false);
      expect(mockWorker.shutdown).toHaveBeenCalled();
      expect(service['taskQueuesToMonitor']).toHaveLength(0);
    });

    it('should force shutdown and log if not stopped', async () => {
      const mockWorker = {
        getState: jest.fn().mockReturnValue('RUNNING'),
        shutdown: jest.fn(),
        options: { identity: 'id' },
      };
      service['taskQueuesToMonitor'] = [{ queueName: 'tq', workerId: 'id' }];
      jest.useFakeTimers();
      await service.shutdownWorker(mockWorker as any, true);
      jest.runAllTimers();
      expect(service['taskQueuesToMonitor']).toHaveLength(0);
      jest.useRealTimers();
    });
  });

  describe('monitorTaskQueues', () => {
    it('should shutdown workers with no pollers', async () => {
      service['taskQueuesToMonitor'] = [{ queueName: 'tq', workerId: 'id' }];
      const mockWorker = {
        getState: jest.fn().mockReturnValue('RUNNING'),
        shutdown: jest.fn(),
        options: { identity: 'id' },
      };
      service['activeWorkers'].set('id', mockWorker as any);
      service['temporalClientConnection'] = {
        workflowService: {
          describeTaskQueue: jest.fn().mockResolvedValue({ pollers: [] }),
        },
      } as any;
      jest.spyOn(service, 'shutdownWorker').mockResolvedValue(undefined);

      await service.monitorTaskQueues();

      expect(service.shutdownWorker).toHaveBeenCalledWith(mockWorker, true);
      expect(service['activeWorkers'].has('id')).toBe(false);
    });
  });
});