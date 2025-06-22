import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { Gauge } from 'prom-client';
import { MetricsService } from './metrics.service';

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

    it('should not start metrics if METRICS_ENABLED is false', () => {
      process.env.METRICS_ENABLED = 'false';
      (service as any).onModuleInit();
      expect((service as any).logger.warn).toHaveBeenCalledWith('Metrics collection is disabled.');
    });

    it('should start metrics with custom intervals', () => {
      process.env.METRICS_ENABLED = 'true';
      process.env.METRICS_COLLECTION_INTERVAL = '1';
      process.env.METRICS_PUSH_INTERVAL = '1';
      (service as any).onModuleInit();
      expect((service as any).logger.log).toHaveBeenCalledWith('Starting metrics collection');
    });

    it('should handle unset intervals', () => {
      process.env.METRICS_ENABLED = 'true';
      delete process.env.METRICS_COLLECTION_INTERVAL;
      delete process.env.METRICS_PUSH_INTERVAL;
      (service as any).onModuleInit();
      expect((service as any).logger.log).toHaveBeenCalledWith('Starting metrics collection');
    });

    it('should handle invalid intervals', () => {
      process.env.METRICS_ENABLED = 'true';
      process.env.METRICS_COLLECTION_INTERVAL = 'abc';
      process.env.METRICS_PUSH_INTERVAL = 'xyz';
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
});