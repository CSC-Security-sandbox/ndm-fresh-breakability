import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from 'fs';
import * as os from 'os';
import { Gauge } from 'prom-client';
import { mockLoggerFactory } from '../auth/auth.service.spec';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;
  let httpService: HttpService;
  let configService: ConfigService;
  const gauges = ['cpuUsageGauge', 'memoryUsageGauge', 'diskUsageGauge', 'networkIOGauge', 'workerInfoGauge'];
  const metricMethods = ['collectCPUMetrics', 'collectMemoryMetrics', 'collectDiskUsageMetrics', 'collectNetworkIOMetrics'];

  const setupHttpServiceMock = () => ({
    axiosRef: { interceptors: { response: { use: jest.fn() } } },
  });

  const setupConfigServiceMock = () => ({
    get: jest.fn((key: string) => {
      if (key === 'worker.metrics.versionsPathWindows') {
        return 'C:\\datamigrator\\conf\\versions.conf';
      }
      if (key === 'worker.metrics.versionsPathLinux') {
        return '/opt/datamigrator/conf/versions.conf';
      }
      return undefined;
    }),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: HttpService, useValue: setupHttpServiceMock() },
        { provide: ConfigService, useValue: setupConfigServiceMock() },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        }
      ],
    }).compile();
    service = module.get<MetricsService>(MetricsService);
    httpService = module.get<HttpService>(HttpService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should initialize Prometheus metrics and HTTP interceptor', () => {
    expect(service.httpRequestCounter).toBeDefined();
    gauges.forEach(gauge => {
      expect(service[gauge]).toBeDefined();
      expect(service[gauge]).toBeInstanceOf(Gauge);
    });
    expect(httpService.axiosRef.interceptors.response.use).toHaveBeenCalled();
  });

  describe('HTTP interceptor', () => {
    let interceptor: Function, errorInterceptor: Function;
    beforeEach(() => {
      jest.spyOn(service.httpRequestCounter, 'inc').mockImplementation(jest.fn());
      [interceptor, errorInterceptor] = (httpService.axiosRef.interceptors.response.use as any).mock.calls[0];
    });
    it.each([
      ['successful response', { config: { method: 'get', url: 'http://example.com/api' }, status: 200 }, 'GET', 200],
      ['error response', { response: { status: 404 }, config: { method: 'post', url: 'http://example.com/err' } }, 'POST', 404],
    ])('should increment httpRequestCounter on %s', async (_, mockData, expectedMethod, expectedStatus) => {
      const handler = 'response' in mockData ? errorInterceptor : interceptor;
      if ('response' in mockData) await handler(mockData).catch(() => {});
      else handler(mockData);
      expect(service.httpRequestCounter.inc).toHaveBeenCalledWith({
        worker_id: service["workerId"],
        method: expectedMethod,
        status_code: expectedStatus,
        host: 'example.com',
      });
    });
  });

  describe('pushMetrics', () => {
    it.each([
      ['success', undefined, 'debug', 'Metrics pushed to Pushgateway'],
      ['error', new Error('fail'), 'error', 'Failed to push metrics:', 'fail'],
    ])('should handle %s case', async (_, mockResult, logLevel, ...logArgs) => {
      const pushAddMock = jest.fn(mockResult ? jest.fn().mockRejectedValue(mockResult) : jest.fn().mockResolvedValue(undefined));
      (service as any).pushgateway.pushAdd = pushAddMock;
      jest.spyOn((service as any).logger, logLevel).mockImplementation(jest.fn());
      await (service as any).pushMetrics();
      expect(pushAddMock).toHaveBeenCalledWith({ jobName: `worker-${(service as any).workerId}` });
      expect((service as any).logger[logLevel]).toHaveBeenCalledWith(...logArgs);
    });
  });

  describe('collectSystemMetrics', () => {
    beforeEach(() => {
      metricMethods.forEach(method => jest.spyOn((service as any), method).mockResolvedValue(undefined));
      jest.spyOn((service as any).logger, 'error').mockImplementation(jest.fn());
    });
    it('should call all metric collection methods', async () => {
      await (service as any).collectSystemMetrics();
      metricMethods.forEach(method => expect((service as any)[method]).toHaveBeenCalled());
    });
    it('should log error if any metric collection throws', async () => {
      jest.spyOn((service as any), 'collectCPUMetrics').mockRejectedValue(new Error('fail-metrics'));
      await (service as any).collectSystemMetrics();
      expect((service as any).logger.error).toHaveBeenCalledWith('Error collecting system metrics:', 'fail-metrics');
    });
  });

  describe('metric collection methods', () => {
    const mockSystemInfo = (module: string, data: any) => {
      jest.spyOn(require('systeminformation'), module).mockResolvedValue(data);
    };
    beforeEach(() => {
      gauges.forEach(gauge => jest.spyOn((service as any)[gauge], 'set').mockImplementation(jest.fn()));
      jest.spyOn((service as any).logger, 'error').mockImplementation(jest.fn());
    });
    afterEach(() => jest.restoreAllMocks());

    describe('collectCPUMetrics', () => {
      it('should set cpu usage for each core and average', async () => {
        const cpuData = { cpus: [{ load: 10 }, { load: 20 }], avgLoad: 15 };
        mockSystemInfo('currentLoad', cpuData);
        await (service as any).collectCPUMetrics();
        expect((service as any).cpuUsageGauge.set).toHaveBeenCalledTimes(3);
        expect((service as any).cpuUsageGauge.set).toHaveBeenCalledWith(
          { worker_id: (service as any).workerId, core: 'cpu0' }, 10
        );
      });

      it('should handle empty cpus array', async () => {
        jest.spyOn(require('systeminformation'), 'currentLoad').mockResolvedValue({ cpus: [], avgLoad: 0 });
        await (service as any).collectCPUMetrics();
        expect((service as any).cpuUsageGauge.set).toHaveBeenCalledWith({ worker_id: (service as any).workerId, core: 'average' }, 0);
      });

      it('should log error if thrown', async () => {
        mockSystemInfo('currentLoad', Promise.reject(new Error('fail-cpu')));
        await (service as any).collectCPUMetrics();
        expect((service as any).logger.error).toHaveBeenCalledWith('Error collecting CPU metrics:', 'fail-cpu');
      });
    });

    describe('collectMemoryMetrics', () => {
      it.each([
        ['normal memory info', { total: 1000, free: 400, used: 600 }, 60],
        ['zero memory info', { total: 0, free: 0, used: 0 }, 0],
        ['missing used/total', {}, 0],
      ])('should handle %s', async (_, memInfo, expectedPercent) => {
        mockSystemInfo('mem', memInfo);
        await (service as any).collectMemoryMetrics();
        expect((service as any).memoryUsageGauge.set).toHaveBeenCalledWith(
          { worker_id: (service as any).workerId, type: 'usage_percent' }, expectedPercent
        );
      });

      it('should log error if thrown', async () => {
        mockSystemInfo('mem', Promise.reject(new Error('fail-mem')));
        await (service as any).collectMemoryMetrics();
        expect((service as any).logger.error).toHaveBeenCalledWith('Error collecting memory metrics:', 'fail-mem');
      });
    });

    describe('collectDiskUsageMetrics', () => {
      it.each([
        ['normal disk info', [{ mount: '/mnt1', size: 1000, used: 600, available: 400 }], 60],
        ['zero disk info', [{ mount: '/mnt1', size: 0, used: 0, available: 0 }], 0],
        ['disk missing used/size', [{ mount: '/mnt2' }], 0],
      ])('should handle %s', async (_, disks, expectedPercent) => {
        mockSystemInfo('fsSize', disks);
        await (service as any).collectDiskUsageMetrics();
        if (disks.length > 0) {
          expect((service as any).diskUsageGauge.set).toHaveBeenCalledWith(
            { worker_id: (service as any).workerId, mount: disks[0].mount, type: 'usage_percent' }, expectedPercent
          );
        }
      });

      it('should handle empty disks array', async () => {
        jest.spyOn(require('systeminformation'), 'fsSize').mockResolvedValue([]);
        await (service as any).collectDiskUsageMetrics();
        expect((service as any).diskUsageGauge.set).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
      });

      it('should log error if thrown', async () => {
        mockSystemInfo('fsSize', Promise.reject(new Error('fail-disk')));
        await (service as any).collectDiskUsageMetrics();
        expect((service as any).logger.error).toHaveBeenCalledWith('Error collecting disk usage metrics:', 'fail-disk');
      });
    });

    describe('collectNetworkIOMetrics', () => {
      it('should set network IO metrics', async () => {
        const netIfaces = [
          { iface: 'eth0', operstate: 'up' },
          { iface: 'eth1', operstate: 'down' },
        ];
        const statsArr = [{ iface: 'eth0', rx_bytes: 100, tx_bytes: 200, rx_sec: 10, tx_sec: 20 }];
        mockSystemInfo('networkInterfaces', netIfaces);
        jest.spyOn(require('systeminformation'), 'networkStats').mockImplementation(async (iface) => iface === 'eth0' ? statsArr : []);
        await (service as any).collectNetworkIOMetrics();
        expect((service as any).networkIOGauge.set).toHaveBeenCalledTimes(4);
        expect((service as any).networkIOGauge.set).toHaveBeenCalledWith(
          { worker_id: (service as any).workerId, interface: 'eth0', direction: 'receive_bytes' }, 100
        );
      });

      it('should handle all interfaces down', async () => {
        jest.spyOn(require('systeminformation'), 'networkInterfaces').mockResolvedValue([{ iface: 'eth0', operstate: 'down' }]);
        await (service as any).collectNetworkIOMetrics();
        expect((service as any).networkIOGauge.set).not.toHaveBeenCalled();
      });

      it('should handle empty stats array', async () => {
        jest.spyOn(require('systeminformation'), 'networkInterfaces').mockResolvedValue([{ iface: 'eth0', operstate: 'up' }]);
        jest.spyOn(require('systeminformation'), 'networkStats').mockResolvedValue([]);
        await (service as any).collectNetworkIOMetrics();
        expect((service as any).networkIOGauge.set).not.toHaveBeenCalled();
      });

      it('should log error if thrown', async () => {
        mockSystemInfo('networkInterfaces', Promise.reject(new Error('fail-net')));
        await (service as any).collectNetworkIOMetrics();
        expect((service as any).logger.error).toHaveBeenCalledWith('Error collecting network IO metrics:', 'fail-net');
      });
    });
  });

  describe('readWorkerVersion', () => {
    beforeEach(() => {
      jest.spyOn((service as any).logger, 'error').mockImplementation(jest.fn());
    });
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should read version from Windows path when platform is windows', async () => {
      const mockFileContent = 'current_version=2.1.0\nother_info=test';
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(mockFileContent);
      
      const version = await (service as any).readWorkerVersion('windows');
      
      expect(configService.get).toHaveBeenCalledWith('worker.metrics.versionsPathWindows');
      expect(fs.promises.readFile).toHaveBeenCalledWith('C:\\datamigrator\\conf\\versions.conf', 'utf8');
      expect(version).toBe('2.1.0');
    });

    it('should read version from Linux path when platform is linux', async () => {
      const mockFileContent = 'current_version=3.2.1\nother_info=test';
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(mockFileContent);
      
      const version = await (service as any).readWorkerVersion('linux');
      
      expect(configService.get).toHaveBeenCalledWith('worker.metrics.versionsPathLinux');
      expect(fs.promises.readFile).toHaveBeenCalledWith('/opt/datamigrator/conf/versions.conf', 'utf8');
      expect(version).toBe('3.2.1');
    });

    it('should return unknown when version file does not exist', async () => {
      jest.spyOn(fs.promises, 'readFile').mockRejectedValue(new Error('ENOENT: no such file or directory'));
      
      const version = await (service as any).readWorkerVersion('linux');
      
      expect(version).toBe('unknown');
      expect((service as any).logger.error).toHaveBeenCalledWith(
        'Error reading worker version file:', 
        'ENOENT: no such file or directory'
      );
    });

    it('should return unknown when version pattern is not found in file', async () => {
      const mockFileContent = 'some_other_version=1.0.0\nno_current_version_here=test';
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(mockFileContent);
      
      const version = await (service as any).readWorkerVersion('windows');
      
      expect(version).toBe('unknown');
    });

    it('should trim whitespace from version', async () => {
      const mockFileContent = 'current_version=  4.5.6  \n';
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(mockFileContent);
      
      const version = await (service as any).readWorkerVersion('linux');
      
      expect(version).toBe('4.5.6');
    });

    it('should handle config service error', async () => {
      jest.spyOn(configService, 'get').mockImplementation(() => {
        throw new Error('Config error');
      });
      
      const version = await (service as any).readWorkerVersion('linux');
      
      expect(version).toBe('unknown');
      expect((service as any).logger.error).toHaveBeenCalledWith('Error reading worker version:', 'Config error');
    });
  });

  describe('getPlatform', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should return windows for win32 platform', () => {
      jest.spyOn(os, 'platform').mockReturnValue('win32' as any);
      
      const platform = (service as any).getPlatform();
      
      expect(platform).toBe('windows');
    });

    it('should return linux for linux platform', () => {
      jest.spyOn(os, 'platform').mockReturnValue('linux' as any);
      
      const platform = (service as any).getPlatform();
      
      expect(platform).toBe('linux');
    });

    it('should return original platform for other platforms', () => {
      jest.spyOn(os, 'platform').mockReturnValue('darwin' as any);
      
      const platform = (service as any).getPlatform();
      
      expect(platform).toBe('darwin');
    });
  });

  describe('setWorkerInfo', () => {
    beforeEach(() => {
      jest.spyOn((service as any).workerInfoGauge, 'set').mockImplementation(jest.fn());
      jest.spyOn((service as any).logger, 'error').mockImplementation(jest.fn());
    });
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should set worker info gauge with platform and version', async () => {
      jest.spyOn(service as any, 'getPlatform').mockReturnValue('linux');
      jest.spyOn(service as any, 'readWorkerVersion').mockResolvedValue('1.2.3');
      
      await (service as any).setWorkerInfo();
      
      expect((service as any).getPlatform).toHaveBeenCalled();
      expect((service as any).readWorkerVersion).toHaveBeenCalledWith('linux');
      expect((service as any).workerInfoGauge.set).toHaveBeenCalledWith(
        {
          worker_id: (service as any).workerId,
          label_build_version: '1.2.3',
          platform: 'linux'
        },
        1
      );
    });

    it('should set worker info gauge with unknown version on error', async () => {
      jest.spyOn(service as any, 'getPlatform').mockReturnValue('windows');
      jest.spyOn(service as any, 'readWorkerVersion').mockResolvedValue('unknown');
      
      await (service as any).setWorkerInfo();
      
      expect((service as any).workerInfoGauge.set).toHaveBeenCalledWith(
        {
          worker_id: (service as any).workerId,
          label_build_version: 'unknown',
          platform: 'windows'
        },
        1
      );
    });

    it('should log error when setWorkerInfo fails', async () => {
      jest.spyOn(service as any, 'getPlatform').mockImplementation(() => {
        throw new Error('Platform error');
      });
      
      await (service as any).setWorkerInfo();
      
      expect((service as any).logger.error).toHaveBeenCalledWith('Failed to set worker info:', 'Platform error');
    });
  });

  describe('workerInfoGauge initialization', () => {
    it('should initialize workerInfoGauge with correct configuration', () => {
      expect((service as any).workerInfoGauge).toBeDefined();
      expect((service as any).workerInfoGauge).toBeInstanceOf(Gauge);
    });
  });

  describe('onModuleInit', () => {
    beforeEach(() => {
      jest.spyOn((service as any).logger, 'warn').mockImplementation(jest.fn());
      jest.spyOn((service as any).logger, 'log').mockImplementation(jest.fn());
      jest.spyOn((service as any), 'setWorkerInfo').mockImplementation(jest.fn());
      jest.spyOn(global, 'setInterval').mockImplementation(((fn: any) => fn()) as any);
    });
    afterEach(() => jest.restoreAllMocks());

    it('should not start metrics if METRICS_ENABLED is false', async () => {
      // Set environment variable before creating service
      process.env.METRICS_ENABLED = 'false';
      
      // Create new service instance with metrics disabled
      const module = await Test.createTestingModule({
        providers: [
          MetricsService,
          { provide: HttpService, useValue: setupHttpServiceMock() },
          { provide: ConfigService, useValue: setupConfigServiceMock() },
          {
            provide: LoggerFactory,
            useValue: mockLoggerFactory,
          }
        ],
      }).compile();
      
      const disabledService = module.get<MetricsService>(MetricsService);
      jest.spyOn((disabledService as any).logger, 'warn').mockImplementation(jest.fn());
      
      (disabledService as any).onModuleInit();
      expect((disabledService as any).logger.warn).toHaveBeenCalledWith('Metrics collection is disabled.');
    });

    it('should start metrics with custom intervals', () => {
      // Set the metricsEnabled property directly
      (service as any).metricsEnabled = true;
      process.env.METRICS_ENABLED = 'true';
      process.env.METRICS_COLLECTION_INTERVAL = '1';
      process.env.METRICS_PUSH_INTERVAL = '1';
      jest.spyOn((service as any).logger, 'log').mockImplementation(jest.fn());
      (service as any).onModuleInit();
      expect((service as any).logger.log).toHaveBeenCalledWith('Starting metrics collection');
      expect((service as any).setWorkerInfo).toHaveBeenCalled();
    });

    it('should handle unset intervals', () => {
      // Set the metricsEnabled property directly
      (service as any).metricsEnabled = true;
      process.env.METRICS_ENABLED = 'true';
      delete process.env.METRICS_COLLECTION_INTERVAL;
      delete process.env.METRICS_PUSH_INTERVAL;
      jest.spyOn((service as any).logger, 'log').mockImplementation(jest.fn());
      (service as any).onModuleInit();
      expect((service as any).logger.log).toHaveBeenCalledWith('Starting metrics collection');
      expect((service as any).setWorkerInfo).toHaveBeenCalled();
    });

    it('should handle invalid intervals', () => {
      // Set the metricsEnabled property directly
      (service as any).metricsEnabled = true;
      process.env.METRICS_ENABLED = 'true';
      process.env.METRICS_COLLECTION_INTERVAL = 'abc';
      process.env.METRICS_PUSH_INTERVAL = 'xyz';
      jest.spyOn((service as any).logger, 'log').mockImplementation(jest.fn());
      (service as any).onModuleInit();
      expect((service as any).logger.log).toHaveBeenCalledWith('Starting metrics collection');
      expect((service as any).setWorkerInfo).toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should clear intervals and handle delete error', async () => {
      (service as any).pushInterval = setInterval(() => {}, 1000);
      (service as any).collectSystemMetricsInterval = setInterval(() => {}, 1000);
      (service as any).collectWorkerThreadMetricsInterval = setInterval(() => {}, 1000);
      const deleteMock = jest.fn().mockRejectedValue(new Error('fail-delete'));
      (service as any).pushgateway.delete = deleteMock;
      jest.spyOn((service as any).logger, 'error').mockImplementation(jest.fn());
      await (service as any).onModuleDestroy();
      expect(deleteMock).toHaveBeenCalled();
      expect((service as any).logger.error).toHaveBeenCalledWith('Failed to delete metrics on shutdown:', 'fail-delete');
    });

    it('should handle no intervals set', async () => {
      (service as any).pushInterval = undefined;
      (service as any).collectSystemMetricsInterval = undefined;
      (service as any).collectWorkerThreadMetricsInterval = undefined;
      const deleteMock = jest.fn().mockResolvedValue(undefined);
      (service as any).pushgateway.delete = deleteMock;
      jest.spyOn((service as any).logger, 'error').mockImplementation(jest.fn());
      await (service as any).onModuleDestroy();
      expect(deleteMock).toHaveBeenCalled();
    });
  });

  describe('incrementHttpCounter and extractHost', () => {
    beforeEach(() => {
      jest.spyOn((service as any).httpRequestCounter, 'inc').mockImplementation(jest.fn());
    });

    it('should handle missing config and url', () => {
      (service as any).incrementHttpCounter(undefined, 500);
      expect((service as any).httpRequestCounter.inc).toHaveBeenCalledWith({
        worker_id: (service as any).workerId,
        method: 'UNKNOWN',
        status_code: 500,
        host: 'unknown',
      });
    });

    it('should handle config with missing method', () => {
      (service as any).incrementHttpCounter({ url: 'http://host' }, 201);
      expect((service as any).httpRequestCounter.inc).toHaveBeenCalledWith({
        worker_id: (service as any).workerId,
        method: 'UNKNOWN',
        status_code: 201,
        host: 'host',
      });
    });

    it('should handle config with missing url', () => {
      (service as any).incrementHttpCounter({ method: 'put' }, 202);
      expect((service as any).httpRequestCounter.inc).toHaveBeenCalledWith({
        worker_id: (service as any).workerId,
        method: 'PUT',
        status_code: 202,
        host: 'unknown',
      });
    });

    it('should handle method in lowercase', () => {
      (service as any).incrementHttpCounter({ method: 'patch', url: 'http://foo' }, 204);
      expect((service as any).httpRequestCounter.inc).toHaveBeenCalledWith({
        worker_id: (service as any).workerId,
        method: 'PATCH',
        status_code: 204,
        host: 'foo',
      });
    });

    it('should handle invalid url in extractHost', () => {
      expect((service as any).extractHost('not-a-url')).toBe('unknown');
    });

    it('should handle url with no protocol', () => {
      expect((service as any).extractHost('localhost/path')).toBe('unknown');
    });

    it('should handle empty string', () => {
      expect((service as any).extractHost('')).toBe('unknown');
    });
  });

  describe('Worker Thread Metrics', () => {
    beforeEach(() => {
      jest.spyOn((service as any).workerThreadsGauge, 'set').mockImplementation(jest.fn());
      jest.spyOn((service as any).workerTasksQueueGauge, 'set').mockImplementation(jest.fn());
      jest.spyOn((service as any).workerTasksActiveGauge, 'set').mockImplementation(jest.fn());
      jest.spyOn((service as any).workerThreadErrorCounter, 'inc').mockImplementation(jest.fn());
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should record worker thread error', () => {
      service.recordWorkerThreadError('FILE_NOT_FOUND');
      expect((service as any).workerThreadErrorCounter.inc).toHaveBeenCalledWith({
        worker_id: (service as any).workerId,
        error_type: 'FILE_NOT_FOUND'
      });
    });

    it('should set worker thread service reference', () => {
      const mockWorkerService = { getWorkerThreadMetrics: jest.fn() };
      service.setWorkerThreadService(mockWorkerService);
      expect((service as any).workerThreadService).toBe(mockWorkerService);
    });

    it('should collect worker thread metrics when worker service is set', async () => {
      const mockWorkerService = {
        getWorkerThreadMetrics: jest.fn().mockReturnValue({
          totalThreads: 5,
          availableThreads: 2,
          activeTasks: 3,
          queueDepths: {
            '1mb': 10,
            '10mb': 5
          }
        })
      };

      service.setWorkerThreadService(mockWorkerService);
      await (service as any).collectWorkerThreadMetrics();

      expect(mockWorkerService.getWorkerThreadMetrics).toHaveBeenCalled();
      expect((service as any).workerThreadsGauge.set).toHaveBeenCalledWith(
        { worker_id: (service as any).workerId, status: 'total' },
        5
      );
      expect((service as any).workerTasksQueueGauge.set).toHaveBeenCalledWith(
        { worker_id: (service as any).workerId, band_name: '1mb' },
        10
      );
      expect((service as any).workerTasksQueueGauge.set).toHaveBeenCalledWith(
        { worker_id: (service as any).workerId, band_name: '10mb' },
        5
      );
    });

    it('should handle missing worker service in collectWorkerThreadMetrics', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockClear();
      await (service as any).collectWorkerThreadMetrics();
      
      // Should not throw error and should not call any metrics methods
      expect(loggerSpy).not.toHaveBeenCalled();
    });

    it('should initialize worker thread metrics with defaults when worker service is not available', () => {
      (service as any).workerThreadService = null;
      
      const loggerSpy = jest.spyOn((service as any).logger, 'debug').mockImplementation(jest.fn());
      
      (service as any).initializeWorkerThreadMetrics();
      
      expect(loggerSpy).toHaveBeenCalledWith('Setting baseline worker thread metrics to zeros');
      
      // Verify that metrics are set to initial values
      expect((service as any).workerThreadsGauge.set).toHaveBeenCalledWith(
        { worker_id: (service as any).workerId, status: 'total' },
        0
      );
      expect((service as any).workerThreadsGauge.set).toHaveBeenCalledWith(
        { worker_id: (service as any).workerId, status: 'available' },
        0
      );
      expect((service as any).workerThreadsGauge.set).toHaveBeenCalledWith(
        { worker_id: (service as any).workerId, status: 'busy' },
        0
      );
      expect((service as any).workerTasksActiveGauge.set).toHaveBeenCalledWith(
        { worker_id: (service as any).workerId },
        0
      );
    });

    it('should call collectWorkerThreadMetrics when worker service is available during initialization', () => {
      const mockWorkerService = { 
        getWorkerThreadMetrics: jest.fn().mockReturnValue({
          totalThreads: 3,
          availableThreads: 1,
          activeTasks: 2,
          queueDepths: {}
        })
      };
      
      // Set the worker service before initialization
      (service as any).workerThreadService = mockWorkerService;
      
      const collectSpy = jest.spyOn(service as any, 'collectWorkerThreadMetrics').mockImplementation(jest.fn());
      
      (service as any).initializeWorkerThreadMetrics();
      
      expect(collectSpy).toHaveBeenCalled();
    });
  });

  describe('Pushgateway Error Handling', () => {
    it('should handle Pushgateway initialization error and log properly', () => {
      // Mock the Pushgateway constructor to throw an error
      const originalPushgateway = require('prom-client').Pushgateway;
      const mockError = new Error('Pushgateway connection failed');
      
      // Mock logger
      const mockLogger = {
        error: jest.fn(),
        debug: jest.fn(),
      };
      
      const mockLoggerFactory = {
        create: jest.fn().mockReturnValue(mockLogger),
      };

      // Temporarily replace Pushgateway with a version that throws
      require('prom-client').Pushgateway = jest.fn().mockImplementation(() => {
        throw mockError;
      });

      try {
        // Try to create a new instance which should fail
        new MetricsService(
          { axiosRef: { interceptors: { response: { use: jest.fn() } } } } as any,
          setupConfigServiceMock() as any,
          mockLoggerFactory as any
        );
        // Should not reach here
        fail('Expected constructor to throw error');
      } catch (error) {
        // Verify the error was logged properly and the original error was rethrown
        expect(mockLoggerFactory.create).toHaveBeenCalledWith('MetricsService');
        expect(mockLogger.error).toHaveBeenCalledWith('Failed to initialize Pushgateway', mockError);
        expect(error).toBe(mockError);
      } finally {
        // Restore the original Pushgateway
        require('prom-client').Pushgateway = originalPushgateway;
      }
    });
  });
});