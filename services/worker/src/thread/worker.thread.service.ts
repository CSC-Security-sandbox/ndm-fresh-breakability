import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { Worker } from 'worker_threads';
import {
  MigrateFile,
  OperationBand,
  ThreadOperation,
  ThreadTask,
  ThreadTaskInput,
  WorkerDetails,
  WorkerThreadOutput,
} from './worker.thread.type';
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class WorkerThreadService {
  private totalThreads: number;
  private activeTasks: Map<string, ThreadTask> = new Map();
  private taskTimestamps: Map<string, number> = new Map(); // Track task start times

  private operationBands: Map<string, OperationBand> = new Map<
    string,
    OperationBand
  >();

  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private workerDetails: Map<number, WorkerDetails> = new Map<
    number,
    WorkerDetails
  >();

  private sizes = [];
  private readonly logger: LoggerService;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly metricsService: MetricsService,
  ) {
    const defaultSizes = [
      { name: '1kb', maxFetch: 1500 },
      { name: '1mb', maxFetch: 1000 },
      { name: '10mb', maxFetch: 100 },
      { name: '100mb', maxFetch: 10 },
      { name: '1gb', maxFetch: 1 },
    ];
    this.totalThreads =
      this.configService.get('worker.thread.threadCount') || 5;
    this.logger = loggerFactory.create(WorkerThreadService.name);

    try {
      const configValue = this.configService.get('worker.thread.threadBand');
      const parsedSizes = configValue.split(';').map((size) => {
        const [name, maxFetchStr] = size.split(',');
        const maxFetch = parseInt(maxFetchStr, 10);
        if (!name || isNaN(maxFetch)) throw new Error('Invalid size format');
        return { name, maxFetch };
      });
      this.logger.log(`Thread Band Sizes: ${JSON.stringify(parsedSizes)}`);
      this.sizes = parsedSizes;
    } catch (error) {
      this.sizes = defaultSizes;
    }
    this.assignThreads();
    this.initWorkers(this.totalThreads);

    // Record initial band allocation metrics
    this.recordBandAllocationMetrics();
  }

  assignThreads = () => {
    const sortedSizes =
      this.totalThreads <= 5 ? this.sizes.reverse() : this.sizes;
    let remainingThreads = this.totalThreads;

    for (let i = 0; i < this.sizes.length; i++) {
      if (remainingThreads > 0) {
        const operationBand: OperationBand = { numberOfThreads: 1, task: [] };
        this.operationBands.set(sortedSizes[i].name, operationBand);
        remainingThreads--;
      }
    }

    let i = 0;
    while (remainingThreads > 0) {
      const operationBand: OperationBand = this.operationBands.get(
        sortedSizes[i].name,
      ) ?? { numberOfThreads: 0, task: [] };
      operationBand.numberOfThreads++;
      this.operationBands.set(sortedSizes[i].name, operationBand);
      remainingThreads--;
      i = (i + 1) % this.sizes.length;
    }
    return this.operationBands;
  };

  private initWorkers(count: number) {
    let j = 0,
      assignedThreadsForCurrentSize = 0;
    for (let i = 0; i < count; i++) {
      const workerPath = path.join(__dirname + '/worker.thread.js');
      const worker = new Worker(workerPath, {
        workerData: { operationBand: this.sizes[j].name, threadNumber: i },
      });
      this.workers.push(worker);
      this.availableWorkers.push(worker);
      this.workerDetails.set(worker.threadId, {
        operationBand: this.sizes[j].name,
        operatingTasks: [],
      });
      assignedThreadsForCurrentSize++;

      worker.on('message', (results: WorkerThreadOutput[]) => {
        results.map((result) => {
          // resolve the task
          if (result.isResolved) {
            const task = this.activeTasks.get(result.id);
            if (task) {
              // Record task completion metrics
              const startTime = this.taskTimestamps.get(result.id);
              if (startTime) {
                const duration = Date.now() - startTime;
                const bandName = this.getTaskBandFromTask(task);
                this.metricsService.recordTaskCompleted(
                  bandName,
                  duration,
                  true,
                );
              }

              task.resolve(result.data);
              this.activeTasks.delete(result.id);
              this.taskTimestamps.delete(result.id);
            }
          }
          // reject the task
          if (result.isRejected) {
            const task = this.activeTasks.get(result.id);
            if (task) {
              // Record task failure metrics
              const startTime = this.taskTimestamps.get(result.id);
              if (startTime) {
                const duration = Date.now() - startTime;
                const bandName = this.getTaskBandFromTask(task);
                this.metricsService.recordTaskCompleted(
                  bandName,
                  duration,
                  false,
                );
              }

              task.reject(result.data);
              this.activeTasks.delete(result.id);
              this.taskTimestamps.delete(result.id);
            }
          }
        });

        this.availableWorkers.push(worker);
        this.updateWorkerMetrics();
        this.processQueue();
      });

      worker.on('error', (err) => {
        this.logger.error(`Worker error: ${err.message}`);
        this.metricsService.recordWorkerThreadError('worker_thread_error');
        this.handleWorkerThreadError(worker.threadId);
      });

      worker.on('exit', (code) => {
        this.logger.log(`Worker exited with code ${code}`);
        this.metricsService.recordWorkerThreadError('worker_thread_exit');
        this.handleWorkerThreadError(worker.threadId);
      });

      if (
        assignedThreadsForCurrentSize >=
        this.operationBands.get(this.sizes[j].name)?.numberOfThreads
      ) {
        assignedThreadsForCurrentSize = 0;
        j++;
      }
    }
  }

  handleWorkerThreadError(processId: number) {
    const workerDetails = this.workerDetails?.get(processId);
    workerDetails?.operatingTasks?.forEach((taskId) => {
      const task = this.activeTasks.get(taskId);
      if (task) {
        this.logger.error(`Rejecting task with operationId: ${taskId}`);
        task.reject(taskId);
        this.activeTasks.delete(taskId);
      }
    });
  }

  getTasks(bandName: string): ThreadTask[] {
    const band = this.sizes.find((size) => size.name === bandName);
    const tasks = this.operationBands
      .get(bandName)
      .task.splice(0, band.maxFetch);
    if (tasks.length > 0) return tasks;
    const index = this.sizes.indexOf(band);
    for (let i = index - 1; i >= 0; i--) {
      const tasks = this.operationBands
        .get(this.sizes[i].name)
        .task.splice(0, this.sizes[i].maxFetch);
      if (tasks.length > 0) return tasks;
    }
    for (let i = index + 1; i < this.sizes.length; i++) {
      const tasks = this.operationBands
        .get(this.sizes[i].name)
        .task.splice(0, this.sizes[i].maxFetch);
      if (tasks.length > 0) return tasks;
    }
    return [];
  }

  private processQueue() {
    if (this.availableWorkers.length > 0) {
      const worker = this.availableWorkers.pop();
      const tasks: ThreadTask[] = this.getTasks(
        this.workerDetails.get(worker.threadId).operationBand,
      );
      if (worker && tasks.length > 0) {
        const input: ThreadTaskInput[] = tasks.map((task: ThreadTask) => {
          this.activeTasks.set(task.id, task);
          const detail: ThreadTaskInput = {
            id: task.id,
            Operation: task.Operation,
            data: task.data,
          };
          return detail;
        });

        this.workerDetails.get(worker.threadId).operatingTasks = input.map(
          (task) => task.id,
        );
        worker.postMessage(input);

        // Update metrics after processing tasks
        this.updateWorkerMetrics();
      }
      if (worker && tasks.length === 0) {
        this.availableWorkers.push(worker);
      }
    }
  }

  async migrateWorkerThread({
    destinationPath,
    sourcePath,
    operationId,
    size,
  }: MigrateFile): Promise<any> {
    return new Promise((resolve, reject) => {
      const operationBand = this.getTaskBand(size);

      // Record task start time for duration tracking
      this.taskTimestamps.set(operationId, Date.now());

      this.operationBands.get(operationBand).task.push({
        id: operationId,
        data: { sourcePath, destinationPath, operationId, size },
        Operation: ThreadOperation.COPY_FILE,
        resolve,
        reject,
      });

      // Update metrics after adding task to queue
      this.updateWorkerMetrics();
      this.processQueue();
    });
  }

  onModuleDestroy() {
    this.workers.forEach((worker) => worker.terminate());
  }

  getTaskBand(size: number) {
    if (size <= 1024) return this.sizes[0].name;
    if (size <= 1048576) return this.sizes[1].name;
    if (size <= 10485760) return this.sizes[2].name;
    if (size <= 104857600) return this.sizes[3].name;
    return this.sizes[4].name;
  }

  private getTaskBandFromTask(task: ThreadTask): string {
    // Extract band information from task data or use default logic
    if (task.data && task.data.size) {
      return this.getTaskBand(task.data.size);
    }
    // Fallback: try to determine from worker details
    const workerDetail = Array.from(this.workerDetails.values()).find(
      (detail) => detail.operatingTasks.includes(task.id),
    );
    return workerDetail?.operationBand || '1mb'; // Default fallback
  }

  // Metrics collection methods
  private recordBandAllocationMetrics() {
    this.operationBands.forEach((band, bandName) => {
      this.metricsService.updateBandAllocation(bandName, band.numberOfThreads);
    });
  }

  private updateWorkerMetrics() {
    this.metricsService.updateWorkerThreadStatus(
      this.totalThreads,
      this.availableWorkers.length,
      this.activeTasks.size,
    );

    // Update queue depths for each band
    this.operationBands.forEach((band, bandName) => {
      this.metricsService.updateQueueDepth(bandName, band.task.length);
    });
  }

  public getWorkerThreadMetrics() {
    const bandMetrics = new Map();
    this.operationBands.forEach((band, bandName) => {
      bandMetrics.set(bandName, {
        threadCount: band.numberOfThreads,
        queueDepth: band.task.length,
        maxFetch: this.sizes.find((s) => s.name === bandName)?.maxFetch || 0,
      });
    });

    return {
      totalThreads: this.totalThreads,
      availableThreads: this.availableWorkers.length,
      busyThreads: this.totalThreads - this.availableWorkers.length,
      activeTasksCount: this.activeTasks.size,
      bandMetrics: Object.fromEntries(bandMetrics),
    };
  }
}
