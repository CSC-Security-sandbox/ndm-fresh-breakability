import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
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
  Histogram,
  Pushgateway,
  Registry,
} from 'prom-client';
import * as systeminformation from 'systeminformation';
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';
import { WorkerThreadService } from 'src/thread/worker.thread.service';
import * as ping from 'ping';

/** Metric or spec accepted by runWithTiming. */
export type RunWithTimingMetricOrSpec =
  | string
  | { category: string; phase: string };

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly registry = new Registry();
  private readonly pushgateway: Pushgateway<any>;
  private pushInterval: NodeJS.Timeout;
  private collectSystemMetricsInterval: NodeJS.Timeout;
  private collectWorkerThreadMetricsInterval: NodeJS.Timeout;
  private collectPingMetricsInterval: NodeJS.Timeout;

  private readonly workerId: string = process.env.WORKER_ID || 'worker-id';
  private readonly pushgatewayUrl: string = `http://${process.env.CONTROL_PLANE_IP || '127.0.0.1'}:9091`;
  private readonly metricsEnabled: boolean =
    process.env.METRICS_ENABLED !== 'false';
  private readonly collectionInterval: number = parseInt(
    process.env.METRICS_COLLECTION_INTERVAL || '5000',
  );
  private readonly pushIntervalMs: number = parseInt(
    process.env.METRICS_PUSH_INTERVAL || '15000',
  );
  private readonly workerThreadMetricsInterval: number = parseInt(
    process.env.WORKER_METRICS_COLLECTION_INTERVAL || '2000',
  );
  private readonly controlPlaneIP: string =
    process.env.CONTROL_PLANE_IP || '127.0.0.1';

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

  private readonly workerInfoGauge = new Gauge({
    name: 'worker_info',
    help: 'Worker information including version and platform',
    labelNames: ['worker_id', 'label_build_version', 'platform'],
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

  // Total files successfully migrated (copy completed) per workflow.
  private readonly filesMigratedCounter = new Counter({
    name: 'worker_files_migrated_total',
    help: 'Total number of files successfully migrated (copy + checksum completed). Labels: worker_id, workflow_id.',
    labelNames: ['worker_id', 'workflow_id'],
    registers: [this.registry],
  });

  private readonly networkLatencyGauge = new Gauge({
    name: 'worker_network_latency',
    help: 'Network latency to control plane in milliseconds',
    labelNames: ['worker_id', 'control_plane_ip', 'metric_type'],
    registers: [this.registry],
  });

  // Workflow-level: one histogram for all optional operations (copy+checksum, stamp meta, copy dir). operation label distinguishes. Only when additionalMetrics is true.
  private readonly additionalOperationDurationHistogram = new Histogram({
    name: 'worker_additional_operation_duration_seconds',
    help: 'Duration of optional operations (copy+checksum, stamp meta, copy dir). Labels: worker_id, workflow_id, operation. Collected when ADDITIONAL_METRICS=true.',
    labelNames: ['worker_id', 'workflow_id', 'operation'],
    buckets: [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    registers: [this.registry],
  });

  // Stamping phase duration per workflow (acl, preserve_time, stamp_time, gid_uid, permissions).
  private readonly stampPhaseDurationHistogram = new Histogram({
    name: 'worker_stamp_phase_duration_seconds',
    help: 'Duration of each stamping phase per workflow. Labels: worker_id, workflow_id, phase.',
    labelNames: ['worker_id', 'workflow_id', 'phase'],
    buckets: [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    registers: [this.registry],
  });

  // Copy phase duration per workflow (copy_and_source_checksum, checksum_target).
  private readonly copyPhaseDurationHistogram = new Histogram({
    name: 'worker_copy_phase_duration_seconds',
    help: 'Duration of copy phases per workflow. Labels: worker_id, workflow_id, phase.',
    labelNames: ['worker_id', 'workflow_id', 'phase'],
    buckets: [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    registers: [this.registry],
  });

  // Task queue wait time (enqueue to thread start) per workflow and band.
  // Uses Gauge because Pushgateway doesn't reliably expose histogram _sum/_count.
  private readonly taskQueueWaitGauge = new Gauge({
    name: 'worker_task_queue_wait_seconds',
    help: 'Last observed task queue wait time in seconds. Labels: worker_id, workflow_id, band_name.',
    labelNames: ['worker_id', 'workflow_id', 'band_name'],
    registers: [this.registry],
  });



  // --- Shell Pool Metrics ---

  // Shell pool health snapshot (available, busy, queue_depth). Pool-wide gauge, no workflow_id.
  private readonly shellPoolStatusGauge = new Gauge({
    name: 'worker_shell_pool_status',
    help: 'Shell pool status snapshot. Labels: worker_id, status (available|busy|queue_depth).',
    labelNames: ['worker_id', 'status'],
    registers: [this.registry],
  });

  // Shell queue wait time: how long a command sat in the per-shell queue before execution started.
  // Uses a Gauge (not Histogram) because Pushgateway doesn't reliably expose _sum/_count,
  // and histogram_quantile fails on pushed histogram buckets.
  private readonly shellQueueWaitGauge = new Gauge({
    name: 'worker_shell_queue_wait_seconds',
    help: 'Last observed shell queue wait time in seconds. Labels: worker_id, workflow_id.',
    labelNames: ['worker_id', 'workflow_id'],
    registers: [this.registry],
  });

  // Shell errors counter by error type.
  private readonly shellErrorsCounter = new Counter({
    name: 'worker_shell_errors_total',
    help: 'Total shell command errors. Labels: worker_id, workflow_id, error_type (command_failed|queue_full|health_check_failed).',
    labelNames: ['worker_id', 'workflow_id', 'error_type'],
    registers: [this.registry],
  });

  // Shell command timeouts counter.
  private readonly shellTimeoutsCounter = new Counter({
    name: 'worker_shell_timeouts_total',
    help: 'Total shell command timeouts. Labels: worker_id, workflow_id.',
    labelNames: ['worker_id', 'workflow_id'],
    registers: [this.registry],
  });

  private readonly logger: LoggerService;
  private workerThreadService: WorkerThreadService;

  constructor(
    private readonly httpService: HttpService,
    @Inject(ConfigService) private readonly configService: ConfigService,
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

  private async readWorkerVersion(platform: string): Promise<string> {
    try {
      let versionsFilePath: string;

      if (platform === 'windows') {
        versionsFilePath = this.configService.get<string>(
          'worker.metrics.versionsPathWindows',
        );
      } else {
        versionsFilePath = this.configService.get<string>(
          'worker.metrics.versionsPathLinux',
        );
      }

      try {
        const content = await fs.promises.readFile(versionsFilePath, 'utf8');
        const match = content.match(/current_version=(.+)/);
        if (match && match[1]) {
          return match[1].trim();
        }
      } catch (err) {
        this.logger.error(
          'Error reading worker version file:',
          err.message || err,
        );
        return 'unknown';
      }

      return 'unknown';
    } catch (err) {
      this.logger.error('Error reading worker version:', err.message || err);
      return 'unknown';
    }
  }

  private getPlatform(): string {
    const platform = os.platform();
    switch (platform) {
      case 'win32':
        return 'windows';
      case 'linux':
        return 'linux';
      default:
        return platform;
    }
  }

  private async setWorkerInfo() {
    try {
      const platform = this.getPlatform();
      const version = await this.readWorkerVersion(platform);

      this.workerInfoGauge.set(
        {
          worker_id: this.workerId,
          label_build_version: version,
          platform: platform,
        },
        1,
      );
    } catch (err) {
      this.logger.error('Failed to set worker info:', err.message || err);
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

    this.setWorkerInfo();

    this.collectPingMetricsInterval = setInterval(
      () => this.collectPingMetrics(),
      30000, // 30 seconds
    );
  }

  async onModuleDestroy() {
    clearInterval(this.pushInterval);
    clearInterval(this.collectSystemMetricsInterval);
    clearInterval(this.collectWorkerThreadMetricsInterval);
    clearInterval(this.collectPingMetricsInterval);

    try {
      await this.pushgateway.delete({ jobName: `worker-${this.workerId}` });
    } catch (err) {
      this.logger.error(
        `Failed to delete metrics on shutdown:`,
        err.message || err,
      );
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
        memInfo.available,
      );
      this.memoryUsageGauge.set(
        { worker_id: this.workerId, type: 'used' },
        memInfo.active,
      );

      if (memInfo.total > 0) {
        this.memoryUsageGauge.set(
          { worker_id: this.workerId, type: 'usage_percent' },
          (memInfo.active / memInfo.total) * 100,
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
      this.workerTasksActiveGauge.set({ worker_id: this.workerId }, 0);

      // Set default queue depths for all known bands
      const defaultBands = ['1kb', '1mb', '10mb', '100mb', '1gb'];
      defaultBands.forEach((bandName) => {
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

        this.logger.debug(
          `Worker thread metrics collected:`,
          workerThreadMetrics,
        );

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
        this.logger.warn(
          'WorkerThreadService not available for metrics collection',
        );
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

  /** Metric keys for workflow-level timing. */
  public static readonly METRIC = {
    FILE_COPY: 'file_copy',
    STAMP_META: 'stamp_meta',
    COPY_DIR: 'copy_dir',
  } as const;

  /** All optional workflow/detailed metrics are gated by this single config (ADDITIONAL_METRICS env). */
  public shouldRecordAdditionalMetrics(): boolean {
    const value = this.configService.get('worker.metrics.additionalMetrics');
    return String(value).toLowerCase() === 'true';
  }

  private recordTimingDuration(workflowId: string, metricOrSpec: RunWithTimingMetricOrSpec, startMs: number, endMs: number): void {
    const wfId = workflowId?.trim() || 'unknown';
    const labels = { worker_id: this.workerId, workflow_id: wfId };
    const durationSeconds = (endMs - startMs) / 1000;
    if (typeof metricOrSpec === 'object') {
      const spec = metricOrSpec as { category: string; phase?: string };
      if (spec.category === 'stamp_phase' && spec.phase) {
        this.stampPhaseDurationHistogram.observe({ ...labels, phase: spec.phase }, durationSeconds);
      }
    } else {
      this.additionalOperationDurationHistogram.observe({ ...labels, operation: metricOrSpec }, durationSeconds);
    }
  }

  /**
   * Runs fn(); when ADDITIONAL_METRICS is enabled, measures duration and records.
   */
  public async runWithTiming<T>(
    workflowId: string,
    metricOrSpec: RunWithTimingMetricOrSpec,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!this.shouldRecordAdditionalMetrics()) return fn();
    const start = Date.now();
    const result = await fn();
    const end = Date.now();
    this.recordTimingDuration(workflowId, metricOrSpec, start, end);
    return result;
  }

  /** Record copy phase results: both sub-phase durations + increment files-migrated counter. */
  public recordCopyPhaseResults(
    workflowId: string,
    copyStreamMs: number,
    checksumTargetMs: number,
  ): void {
    if (!this.shouldRecordAdditionalMetrics()) return;
    const wfId = workflowId?.trim() || 'unknown';
    this.copyPhaseDurationHistogram.observe(
      { worker_id: this.workerId, workflow_id: wfId, phase: 'copy_and_source_checksum' },
      (copyStreamMs ?? 0) / 1000,
    );
    this.copyPhaseDurationHistogram.observe(
      { worker_id: this.workerId, workflow_id: wfId, phase: 'checksum_target' },
      (checksumTargetMs ?? 0) / 1000,
    );
    this.filesMigratedCounter.inc({ worker_id: this.workerId, workflow_id: wfId });
  }

  // --- Shell Pool Metric Recording Methods ---

  /** Record shell pool health snapshot (call periodically from shell monitoring). */
  public recordShellPoolStatus(available: number, busy: number, queueDepth: number): void {
    if (!this.shouldRecordAdditionalMetrics()) return;
    this.shellPoolStatusGauge.set({ worker_id: this.workerId, status: 'available' }, available);
    this.shellPoolStatusGauge.set({ worker_id: this.workerId, status: 'busy' }, busy);
    this.shellPoolStatusGauge.set({ worker_id: this.workerId, status: 'queue_depth' }, queueDepth);
  }

  /** Record how long a shell command waited in the queue before execution. */
  public recordShellQueueWait(workflowId: string, waitSeconds: number): void {
    if (!this.shouldRecordAdditionalMetrics()) return;
    const wfId = workflowId?.trim() || 'unknown';
    this.shellQueueWaitGauge.set(
      { worker_id: this.workerId, workflow_id: wfId },
      waitSeconds,
    );
  }

  /** Record a shell command error. */
  public recordShellError(workflowId: string, errorType: string): void {
    if (!this.shouldRecordAdditionalMetrics()) return;
    const wfId = workflowId?.trim() || 'unknown';
    this.shellErrorsCounter.inc(
      { worker_id: this.workerId, workflow_id: wfId, error_type: errorType },
    );
  }

  /** Record a shell command timeout. */
  public recordShellTimeout(workflowId: string): void {
    if (!this.shouldRecordAdditionalMetrics()) return;
    const wfId = workflowId?.trim() || 'unknown';
    this.shellTimeoutsCounter.inc(
      { worker_id: this.workerId, workflow_id: wfId },
    );
  }

  /** Record how long a task waited in the thread queue before a worker picked it up. */
  public recordTaskQueueWait(workflowId: string, bandName: string, waitSeconds: number): void {
    if (!this.shouldRecordAdditionalMetrics()) return;
    const wfId = workflowId?.trim() || 'unknown';
    this.taskQueueWaitGauge.set(
      { worker_id: this.workerId, workflow_id: wfId, band_name: bandName },
      waitSeconds,
    );
  }

  private async collectPingMetrics() {
    try {
      const res = await ping.promise.probe(this.controlPlaneIP, {
        timeout: 2,
        extra: ['-c', '5'],
      });

      this.logger.debug(
        `Ping result for ${this.controlPlaneIP}: ${JSON.stringify(res)}`,
      );

      if (res.alive) {
        const min = parseFloat(res.min) || 0;
        const max = parseFloat(res.max) || 0;
        const avg = parseFloat(res.avg) || 0;

        this.networkLatencyGauge.set(
          {
            worker_id: this.workerId,
            control_plane_ip: this.controlPlaneIP,
            metric_type: 'min',
          },
          min,
        );
        this.networkLatencyGauge.set(
          {
            worker_id: this.workerId,
            control_plane_ip: this.controlPlaneIP,
            metric_type: 'max',
          },
          max,
        );
        this.networkLatencyGauge.set(
          {
            worker_id: this.workerId,
            control_plane_ip: this.controlPlaneIP,
            metric_type: 'avg',
          },
          avg,
        );

        this.logger.debug(
          `Network latency metrics collected - min: ${min}ms, max: ${max}ms, avg: ${avg}ms`,
        );
      } else {
        // Set high values to indicate connectivity issues
        this.networkLatencyGauge.set(
          {
            worker_id: this.workerId,
            control_plane_ip: this.controlPlaneIP,
            metric_type: 'min',
          },
          -1,
        );
        this.networkLatencyGauge.set(
          {
            worker_id: this.workerId,
            control_plane_ip: this.controlPlaneIP,
            metric_type: 'max',
          },
          -1,
        );
        this.networkLatencyGauge.set(
          {
            worker_id: this.workerId,
            control_plane_ip: this.controlPlaneIP,
            metric_type: 'avg',
          },
          -1,
        );

        this.logger.warn(
          `Unable to ping control plane at ${this.controlPlaneIP}`,
        );
      }
    } catch (err) {
      this.logger.error('Error collecting ping metrics:', err.message || err);

      // Set error state values
      this.networkLatencyGauge.set(
        {
          worker_id: this.workerId,
          control_plane_ip: this.controlPlaneIP,
          metric_type: 'min',
        },
        -1,
      );
      this.networkLatencyGauge.set(
        {
          worker_id: this.workerId,
          control_plane_ip: this.controlPlaneIP,
          metric_type: 'max',
        },
        -1,
      );
      this.networkLatencyGauge.set(
        {
          worker_id: this.workerId,
          control_plane_ip: this.controlPlaneIP,
          metric_type: 'avg',
        },
        -1,
      );
    }
  }
}
