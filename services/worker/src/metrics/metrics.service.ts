import { HttpService } from '@nestjs/axios';
import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Pushgateway,
  Registry,
} from 'prom-client';
import * as systeminformation from 'systeminformation';
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';
import { WorkerThreadService } from 'src/thread/worker.thread.service';

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly registry = new Registry();
  private readonly pushgateway: Pushgateway<any>;
  private pushInterval: NodeJS.Timeout;
  private collectSystemMetricsInterval: NodeJS.Timeout;
  private collectWorkerThreadMetricsInterval: NodeJS.Timeout;

  private readonly workerId: string = process.env.WORKER_ID || 'worker-id';
  private readonly pushgatewayUrl: string = `http://${process.env.CONTROL_PLANE_IP || '127.0.0.1'}:9091`;
  private readonly metricsEnabled: boolean = process.env.METRICS_ENABLED !== 'false';
  private readonly collectionInterval: number = parseInt(process.env.METRICS_COLLECTION_INTERVAL || '5000');
  private readonly pushIntervalMs: number = parseInt(process.env.METRICS_PUSH_INTERVAL || '15000');
  private readonly workerThreadMetricsInterval: number = parseInt(process.env.WORKER_METRICS_COLLECTION_INTERVAL || '2000');

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

  // Worker Thread Metrics
  private readonly workerThreadsGauge = new Gauge({
    name: 'worker_threads_status',
    help: 'Worker thread status counts',
    labelNames: ['worker_id', 'status'], // status: total, available, busy
    registers: [this.registry],
  });

  private readonly workerTasksQueueGauge = new Gauge({
    name: 'worker_tasks_queue_depth',
    help: 'Tasks queued by operation band',
    labelNames: ['worker_id', 'band_name'],
    registers: [this.registry],
  });

  private readonly workerTasksActiveGauge = new Gauge({
    name: 'worker_tasks_active_total',
    help: 'Total active tasks being processed',
    labelNames: ['worker_id'],
    registers: [this.registry],
  });

  private readonly workerThreadErrorCounter = new Counter({
    name: 'worker_thread_errors_total',
    help: 'Total worker thread errors',
    labelNames: ['worker_id', 'error_type'], // error_type: worker_error, worker_exit, task_timeout
    registers: [this.registry],
  });

  private readonly logger: LoggerService;
  private workerThreadService: WorkerThreadService;

  constructor(
    private readonly httpService: HttpService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(MetricsService.name);
    try {
      this.pushgateway = new Pushgateway(
        this.pushgatewayUrl,
        {},
        this.registry,
      );
    } catch (error) {
      this.logger.error('Failed to initialize Pushgateway', error);

      throw error;
    }
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
    if (!this.metricsEnabled) {
      this.logger.warn('Metrics collection is disabled.');
      return;
    }
    this.logger.log('Starting metrics collection');
    
    // Initialize worker thread metrics with baseline values immediately
    this.initializeWorkerThreadMetrics();
    
    this.collectSystemMetricsInterval = setInterval(
      () => this.collectSystemMetrics(),
      this.collectionInterval,
    );
    this.collectWorkerThreadMetricsInterval = setInterval(
      () => this.collectWorkerThreadMetrics(),
      this.workerThreadMetricsInterval,
    );
    this.pushInterval = setInterval(
      () => this.pushMetrics(),
      this.pushIntervalMs,
    );
  }

  async onModuleDestroy() {
    clearInterval(this.pushInterval);
    clearInterval(this.collectSystemMetricsInterval);
    clearInterval(this.collectWorkerThreadMetricsInterval);

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
      this.logger.error('Failed to push metrics:', err.message || err);
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
        this.cpuUsageGauge.set(
          { worker_id: this.workerId, core: `cpu${i}` },
          cpu.load,
        );
      });
      this.cpuUsageGauge.set(
        { worker_id: this.workerId, core: 'average' },
        cpuData.avgLoad,
      );
    } catch (err) {
      this.logger.error('Error collecting CPU metrics:', err.message || err);
    }
  }

  private async collectMemoryMetrics() {
    try {
      const memInfo = await systeminformation.mem();

      this.memoryUsageGauge.set(
        { worker_id: this.workerId, type: 'total' },
        memInfo.total,
      );
      this.memoryUsageGauge.set(
        { worker_id: this.workerId, type: 'free' },
        memInfo.free,
      );
      this.memoryUsageGauge.set(
        { worker_id: this.workerId, type: 'used' },
        memInfo.used,
      );

      if (memInfo.total > 0) {
        this.memoryUsageGauge.set(
          { worker_id: this.workerId, type: 'usage_percent' },
          (memInfo.used / memInfo.total) * 100,
        );
      } else {
        this.memoryUsageGauge.set(
          { worker_id: this.workerId, type: 'usage_percent' },
          0,
        );
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
          total,
        );
        this.diskUsageGauge.set(
          { worker_id: this.workerId, mount: mountPoint, type: 'used' },
          used,
        );
        this.diskUsageGauge.set(
          { worker_id: this.workerId, mount: mountPoint, type: 'available' },
          available,
        );

        const usagePercent = total > 0 ? (used / total) * 100 : 0;
        this.diskUsageGauge.set(
          {
            worker_id: this.workerId,
            mount: mountPoint,
            type: 'usage_percent',
          },
          usagePercent,
        );
      }
    } catch (err) {
      this.logger.error(
        'Error collecting disk usage metrics:',
        err.message || err,
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

        this.networkIOGauge.set(
          {
            worker_id: this.workerId,
            interface: interfaceName,
            direction: 'receive_bytes',
          },
          rx_bytes,
        );
        this.networkIOGauge.set(
          {
            worker_id: this.workerId,
            interface: interfaceName,
            direction: 'transmit_bytes',
          },
          tx_bytes,
        );
        this.networkIOGauge.set(
          {
            worker_id: this.workerId,
            interface: interfaceName,
            direction: 'receive_rate',
          },
          rx_sec ?? 0,
        );
        this.networkIOGauge.set(
          {
            worker_id: this.workerId,
            interface: interfaceName,
            direction: 'transmit_rate',
          },
          tx_sec ?? 0,
        );
      }
    } catch (err) {
      this.logger.error(
        'Error collecting network IO metrics:',
        err.message || err,
      );
    }
  }

  private initializeWorkerThreadMetrics() {
    // ensure metrics are available even before any migration is triggered
    
    if (this.workerThreadService) {
      // If WorkerThreadService is already available, collect actual metrics
      this.collectWorkerThreadMetrics();
    } else {
      // If not available yet, set reasonable defaults
      // These will be updated once the WorkerThreadService becomes available
      this.logger.debug('Setting baseline worker thread metrics to zeros');
      
      // Set all metrics to zero initially (will be updated by interval collection)
      this.workerThreadsGauge.set(
        { worker_id: this.workerId, status: 'total' },
        0,
      );
      this.workerThreadsGauge.set(
        { worker_id: this.workerId, status: 'available' },
        0,
      );
      this.workerThreadsGauge.set(
        { worker_id: this.workerId, status: 'busy' },
        0,
      );
      this.workerTasksActiveGauge.set(
        { worker_id: this.workerId },
        0,
      );

      // Set default queue depths for all known bands
      const defaultBands = ['1kb', '1mb', '10mb', '100mb', '1gb'];
      defaultBands.forEach(bandName => {
        this.workerTasksQueueGauge.set(
          { worker_id: this.workerId, band_name: bandName },
          0,
        );
      });
    }
  }

  private async collectWorkerThreadMetrics() {
    try {
      if (this.workerThreadService) {
        // Get current queue depths and thread status from WorkerThreadService
        const workerThreadMetrics =
          this.workerThreadService.getWorkerThreadMetrics();

        this.logger.debug(`Worker thread metrics collected:`, workerThreadMetrics);

        // Update worker thread status metrics
        this.workerThreadsGauge.set(
          { worker_id: this.workerId, status: 'total' },
          workerThreadMetrics.totalThreads,
        );
        this.workerThreadsGauge.set(
          { worker_id: this.workerId, status: 'available' },
          workerThreadMetrics.availableThreads,
        );
        this.workerThreadsGauge.set(
          { worker_id: this.workerId, status: 'busy' },
          workerThreadMetrics.totalThreads -
            workerThreadMetrics.availableThreads,
        );
        this.workerTasksActiveGauge.set(
          { worker_id: this.workerId },
          workerThreadMetrics.activeTasks,
        );

        // Update queue depths for each band
        Object.entries(workerThreadMetrics.queueDepths).forEach(
          ([bandName, queueDepth]) => {
            this.workerTasksQueueGauge.set(
              { worker_id: this.workerId, band_name: bandName },
              queueDepth as number,
            );
          },
        );
      } else {
        this.logger.warn('WorkerThreadService not available for metrics collection');
      }
    } catch (err) {
      this.logger.error(
        'Error collecting worker thread metrics:',
        err.message || err,
      );
    }
  }

  // Public methods for WorkerThreadService to call
  public setWorkerThreadService(workerThreadService: any) {
    this.workerThreadService = workerThreadService;
  }
  
  public recordWorkerThreadError(errorType: string) {
    this.workerThreadErrorCounter.inc({
      worker_id: this.workerId,
      error_type: errorType,
    });
  }
}
