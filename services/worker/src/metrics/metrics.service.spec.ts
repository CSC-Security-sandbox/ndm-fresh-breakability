import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { Gauge } from 'prom-client';
import { MetricsService } from './metrics.service';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from '../auth/auth.service.spec';

describe('MetricsService', () => {
  let service: MetricsService;
  let httpService: HttpService;
  const gauges = ['cpuUsageGauge', 'memoryUsageGauge', 'diskUsageGauge', 'networkIOGauge'];
  const metricMethods = ['collectCPUMetrics', 'collectMemoryMetrics', 'collectDiskUsageMetrics', 'collectNetworkIOMetrics'];

  const setupHttpServiceMock = () => ({
    axiosRef: { interceptors: { response: { use: jest.fn() } } },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: HttpService, useValue: setupHttpServiceMock() },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        }
      ],
    }).compile();
    service = module.get<MetricsService>(MetricsService);
    httpService = module.get<HttpService>(HttpService);
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
      [interceptor, errorInterceptor] = (httpService.axiosRef.interceptors.response.use as jest.Mock).mock.calls[0];
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

  describe('onModuleInit', () => {
    beforeEach(() => {
      jest.spyOn((service as any).logger, 'warn').mockImplementation(jest.fn());
      jest.spyOn((service as any).logger, 'log').mockImplementation(jest.fn());
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
    });
  });

  describe('onModuleDestroy', () => {
    it('should clear intervals and handle delete error', async () => {
      (service as any).pushInterval = setInterval(() => {}, 1000);
      (service as any).collectSystemMetricsInterval = setInterval(() => {}, 1000);
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
      jest.spyOn((service as any).workerTaskCompletedCounter, 'inc').mockImplementation(jest.fn());
      jest.spyOn((service as any).workerTaskDurationHistogram, 'observe').mockImplementation(jest.fn());
      jest.spyOn((service as any).workerThreadErrorCounter, 'inc').mockImplementation(jest.fn());
      jest.spyOn((service as any).workerBandAllocationGauge, 'set').mockImplementation(jest.fn());
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should record task completed successfully', () => {
      service.recordTaskCompleted('1mb', 5000, true);
      expect((service as any).workerTaskCompletedCounter.inc).toHaveBeenCalledWith({
        worker_id: (service as any).workerId,
        band_name: '1mb',
        status: 'success'
      });
      expect((service as any).workerTaskDurationHistogram.observe).toHaveBeenCalledWith(
        {
          worker_id: (service as any).workerId,
          band_name: '1mb',
          operation: 'copy_file'
        },
        5000
      );
    });

    it('should record task completed with error', () => {
      service.recordTaskCompleted('10mb', 3000, false);
      expect((service as any).workerTaskCompletedCounter.inc).toHaveBeenCalledWith({
        worker_id: (service as any).workerId,
        band_name: '10mb',
        status: 'error'
      });
    });

    it('should record worker thread error', () => {
      service.recordWorkerThreadError('FILE_NOT_FOUND');
      expect((service as any).workerThreadErrorCounter.inc).toHaveBeenCalledWith({
        worker_id: (service as any).workerId,
        error_type: 'FILE_NOT_FOUND'
      });
    });

    it('should update worker thread status', () => {
      service.updateWorkerThreadStatus(5, 2, 3);
      expect((service as any).workerThreadsGauge.set).toHaveBeenCalledWith(
        { worker_id: (service as any).workerId, status: 'total' },
        5
      );
      expect((service as any).workerThreadsGauge.set).toHaveBeenCalledWith(
        { worker_id: (service as any).workerId, status: 'available' },
        2
      );
      expect((service as any).workerThreadsGauge.set).toHaveBeenCalledWith(
        { worker_id: (service as any).workerId, status: 'busy' },
        3
      );
      expect((service as any).workerTasksActiveGauge.set).toHaveBeenCalledWith(
        { worker_id: (service as any).workerId },
        3
      );
    });

    it('should update queue depth', () => {
      service.updateQueueDepth('100mb', 10);
      expect((service as any).workerTasksQueueGauge.set).toHaveBeenCalledWith(
        { worker_id: (service as any).workerId, band_name: '100mb' },
        10
      );
    });

    it('should update band allocation', () => {
      service.updateBandAllocation('1gb', 1);
      expect((service as any).workerBandAllocationGauge.set).toHaveBeenCalledWith(
        { worker_id: (service as any).workerId, band_name: '1gb' },
        1
      );
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