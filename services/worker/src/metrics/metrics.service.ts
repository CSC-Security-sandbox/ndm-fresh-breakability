import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Pushgateway,
  Registry,
} from 'prom-client';
import * as systeminformation from 'systeminformation';
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly registry = new Registry();
  private readonly pushgateway = new Pushgateway(
    `http://${process.env.CONTROL_PLANE_IP || '127.0.0.1'}:9091`,
    {},
    this.registry,
  );
  private pushInterval: NodeJS.Timeout;
  private collectSystemMetricsInterval: NodeJS.Timeout;

  private readonly workerId: string = process.env.WORKER_ID || 'worker-id';

  public readonly httpRequestCounter = new Counter({
    name: 'worker_http_requests_total',
    help: 'Total number of outgoing HTTP requests',
    labelNames: ['worker_id', 'method', 'status_code', 'host'],
    registers: [this.registry],
  });

  private readonly cpuUsageGauge = new Gauge({
    name: 'worker_system_cpu_usage',
    help: 'CPU usage percentage',
    labelNames: ['worker_id', 'core'],
    registers: [this.registry],
  });

  private readonly memoryUsageGauge = new Gauge({
    name: 'worker_system_memory',
    help: 'Memory usage in bytes',
    labelNames: ['worker_id', 'type'],
    registers: [this.registry],
  });

  private readonly diskUsageGauge = new Gauge({
    name: 'worker_system_disk_usage',
    help: 'Disk usage in bytes',
    labelNames: ['worker_id', 'mount', 'type'],
    registers: [this.registry],
  });

  private readonly networkIOGauge = new Gauge({
    name: 'worker_system_network_io',
    help: 'Network IO bytes',
    labelNames: ['worker_id', 'interface', 'direction'],
    registers: [this.registry],
  });

  private readonly logger: LoggerService;

  constructor(
    private readonly httpService: HttpService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'worker_',
      gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
      labels: { worker_id: this.workerId },
    });

    this.httpService.axiosRef.interceptors.response.use(
      (response) => {
        this.incrementHttpCounter(response.config, response.status);
        return response;
      },
      (error) => {
        const statusCode = error.response?.status || 'NET_ERROR';
        this.incrementHttpCounter(error.config, statusCode);
        return Promise.reject(error);
      },
    );
    this.logger = loggerFactory.create(MetricsService.name);
  }

  private incrementHttpCounter(config: any, statusCode: number | string) {
    this.httpRequestCounter.inc({
      worker_id: this.workerId,
      method: config?.method?.toUpperCase() || 'UNKNOWN',
      status_code: statusCode,
      host: config?.url ? this.extractHost(config.url) : 'unknown',
    });
  }

  private extractHost(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return 'unknown';
    }
  }

  onModuleInit() {
    const metricsEnabled = process.env.METRICS_ENABLED !== 'false';
    if (!metricsEnabled) {
      this.logger.warn('Metrics collection is disabled.');
      return;
    }
    this.logger.log('Starting metrics collection');
    this.collectSystemMetricsInterval = setInterval(
      () => this.collectSystemMetrics(),
      parseInt(process.env.METRICS_COLLECTION_INTERVAL || '5000')
    );
    this.pushInterval = setInterval(
      () => this.pushMetrics(),
      parseInt(process.env.METRICS_PUSH_INTERVAL || '15000')
    );
  }

  async onModuleDestroy() {
    clearInterval(this.pushInterval);
    clearInterval(this.collectSystemMetricsInterval);

    try {
      await this.pushgateway.delete({ jobName: `worker-${this.workerId}` });
    } catch (err) {
      this.logger.error(`Failed to delete metrics on shutdown:`, err.message || err);
    }
  }

  private async pushMetrics() {
    try {
      await this.pushgateway.pushAdd({ jobName: `worker-${this.workerId}` });
      this.logger.debug('Metrics pushed to Pushgateway');
    } catch (err) {
      // this.logger.error('Failed to push metrics:', err.message || err);
    }
  }

  private async collectSystemMetrics() {
    try {
      await Promise.all([
        this.collectCPUMetrics(),
        this.collectMemoryMetrics(),
        this.collectDiskUsageMetrics(), 
        this.collectNetworkIOMetrics(),
      ]);
    } catch (err) {
      this.logger.error('Error collecting system metrics:', err.message || err);
    }
  }

  private async collectCPUMetrics() {
  try {
    const cpuData = await systeminformation.currentLoad();
    
    cpuData.cpus.forEach((cpu, i) => {
      this.cpuUsageGauge.set({ worker_id: this.workerId, core: `cpu${i}` }, cpu.load);
    }); 
    this.cpuUsageGauge.set({ worker_id: this.workerId, core: 'average' }, cpuData.avgLoad);
  } catch (err) {
    this.logger.error('Error collecting CPU metrics:', err.message || err);
  }
}

  private async collectMemoryMetrics() {
  try {
    const memInfo = await systeminformation.mem();
    
    this.memoryUsageGauge.set({ worker_id: this.workerId, type: 'total' }, memInfo.total);
    this.memoryUsageGauge.set({ worker_id: this.workerId, type: 'free' }, memInfo.free);
    this.memoryUsageGauge.set({ worker_id: this.workerId, type: 'used' }, memInfo.used);
    
    if (memInfo.total > 0) {
      this.memoryUsageGauge.set({ worker_id: this.workerId, type: 'usage_percent' }, (memInfo.used / memInfo.total) * 100);
    } else {
      this.memoryUsageGauge.set({ worker_id: this.workerId, type: 'usage_percent' }, 0);
    }
    
  } catch (err) {
    this.logger.error('Error collecting memory metrics:', err.message || err);
  }
}

  private async collectDiskUsageMetrics() {
    try {
      const disks = await systeminformation.fsSize();
      for (const disk of disks) {
        const mountPoint = disk.mount;
        const total = disk.size;
        const used = disk.used;
        const available = disk.available;
        
        this.diskUsageGauge.set(
          { worker_id: this.workerId, mount: mountPoint, type: 'total' },
          total
        );
        this.diskUsageGauge.set(
          { worker_id: this.workerId, mount: mountPoint, type: 'used' },
          used
        );
        this.diskUsageGauge.set(
          { worker_id: this.workerId, mount: mountPoint, type: 'available' },
          available
        );

        const usagePercent = total > 0 ? (used / total) * 100 : 0;
        this.diskUsageGauge.set(
          { worker_id: this.workerId, mount: mountPoint, type: 'usage_percent' },
          usagePercent
        );

      }
    } catch (err) {
      this.logger.error(
        'Error collecting disk usage metrics:',
        err.message || err
      );
    }
  }



  private async collectNetworkIOMetrics() {
    try {
      const netIfaces = await systeminformation.networkInterfaces();
      
      for (const iface of netIfaces) {
        if (iface.operstate !== 'up') continue;
        
        const statsArr = await systeminformation.networkStats(iface.iface);
        if (!Array.isArray(statsArr) || statsArr.length === 0) continue;
        
        const stats = statsArr[0];
        const interfaceName = stats.iface;
        const rx_bytes = stats.rx_bytes;
        const tx_bytes = stats.tx_bytes;
        const rx_sec = stats.rx_sec;
        const tx_sec = stats.tx_sec;
        
        this.networkIOGauge.set({ worker_id: this.workerId, interface: interfaceName, direction: 'receive_bytes' }, rx_bytes);
        this.networkIOGauge.set({ worker_id: this.workerId, interface: interfaceName, direction: 'transmit_bytes' }, tx_bytes);
        this.networkIOGauge.set({ worker_id: this.workerId, interface: interfaceName, direction: 'receive_rate' }, rx_sec ?? 0);
        this.networkIOGauge.set({ worker_id: this.workerId, interface: interfaceName, direction: 'transmit_rate' }, tx_sec ?? 0);
        
      }
    } catch (err) {
      this.logger.error('Error collecting network IO metrics:', err.message || err);
    }
  }
}