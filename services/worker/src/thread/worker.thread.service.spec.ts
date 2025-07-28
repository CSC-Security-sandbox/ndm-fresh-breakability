import { Test, TestingModule } from '@nestjs/testing';
import { WorkerThreadService } from './worker.thread.service';
import { WorkerThreadOutput, ThreadOperation, MigrateFile } from './worker.thread.type';
import { ConfigService } from '@nestjs/config';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { MetricsService } from '../metrics/metrics.service';
import { mockLogger } from 'src/auth/auth.service.spec';

jest.mock('worker_threads', () => {
  const EventEmitter = require('events');
const WorkerThreadServiceModule = require('./worker.thread.service').WorkerThreadService;
  class FakeWorker extends EventEmitter {
    threadId = Math.floor(Math.random() * 1000);
    postMessage = jest.fn();
    terminate = jest.fn();
    constructor() {
      super();
    }
  }
  return { Worker: FakeWorker };
});

describe('WorkerThreadService', () => {
  let service: WorkerThreadService;
  let configService: ConfigService;
  let loggerFactory: LoggerFactory;
  let logger: LoggerService;

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue(mockLogger),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerThreadService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(5) },
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        {
          provide: MetricsService,
          useValue: {
            recordTaskCompleted: jest.fn(),
            recordWorkerThreadError: jest.fn(),
            updateWorkerThreadStatus: jest.fn(),
            updateQueueDepth: jest.fn(),
            updateBandAllocation: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WorkerThreadService>(WorkerThreadService);
    configService = module.get<ConfigService>(ConfigService);
    loggerFactory = module.get<LoggerFactory>(LoggerFactory);
    logger = loggerFactory.create(WorkerThreadService.name);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize the correct number of workers', () => {
    expect(service['workers'].length).toBe(5);
    expect(service['availableWorkers'].length).toBe(5);
  });

  it('should assign threads correctly', () => {
    const operationBands = service.assignThreads();
    const totalThreads = Array.from(operationBands.values()).reduce(
      (acc, band) => acc + band.numberOfThreads,
      0,
    );
    expect(totalThreads).toBe(5);
  });

  it('should process migrateWorkerThread and resolve task', async () => {
    const migrateFile: MigrateFile = {
      sourcePath: 'source.txt',
      destinationPath: 'dest.txt',
      operationId: 'op1',
      size: 500,
    };


    const worker = service['availableWorkers'][0];

    setImmediate(() => {
      const fakeOutput: WorkerThreadOutput = {
        isResolved: true,
        id: 'op1',
        data: { sourceChecksum: 'abc', targetChecksum: 'abc' },
        Operation: ThreadOperation.COPY_FILE,
      };
      worker.emit('message', [fakeOutput]);
    });

    const result = await service.migrateWorkerThread(migrateFile);

    expect(result).toEqual({ sourceChecksum: 'abc', targetChecksum: 'abc' });
  });

  it('should handle worker errors and remove tasks', () => {

    const task = {
      id: 'op2',
      data: { sourcePath: 'src', destinationPath: 'dest', operationId: 'op2' },
      Operation: ThreadOperation.COPY_FILE,
      resolve: jest.fn(),
      reject: jest.fn(),
    };
    service['activeTasks'].set('op2', task);
    const worker = service['workers'][0];
    service['workerDetails'].set(worker.threadId, {
      operationBand: '1kb',
      operatingTasks: ['op2'],
    });

    const error = new Error('Test error');
    worker.emit('error', error);

    expect(task.reject).toHaveBeenCalled();
    expect(service['activeTasks'].has('op2')).toBeFalsy();
  });

  it('should terminate all workers on module destroy', () => {
    service.onModuleDestroy();

    service['workers'].forEach((worker) => {
      expect(worker.terminate).toHaveBeenCalled();
    });
  });


  it('should get tasks from the correct band and fallback to other bands', () => {
    service['operationBands'].forEach((band) => band.task = []);
    service['operationBands'].get('1kb').task.push({ id: 't1', data: {}, Operation: ThreadOperation.COPY_FILE, resolve: jest.fn(), reject: jest.fn() });
    service['operationBands'].get('1mb').task.push({ id: 't2', data: {}, Operation: ThreadOperation.COPY_FILE, resolve: jest.fn(), reject: jest.fn() });
    service['operationBands'].get('10mb').task = [];
    service['operationBands'].get('100mb').task = [];
    service['operationBands'].get('1gb').task = [];

    // Should get from 1kb
    let tasks = service.getTasks('1kb');
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe('t1');

    // Should get from 1mb
    tasks = service.getTasks('1mb');
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe('t2');

    // Should fallback to previous band (none left, so empty)
    tasks = service.getTasks('10mb');
    expect(tasks.length).toBe(0);
  });

  it('should handle worker exit and reject tasks', () => {
    const task = {
      id: 'op3',
      data: { sourcePath: 'src', destinationPath: 'dest', operationId: 'op3' },
      Operation: ThreadOperation.COPY_FILE,
      resolve: jest.fn(),
      reject: jest.fn(),
    };
    service['activeTasks'].set('op3', task);
    const worker = service['workers'][1];
    service['workerDetails'].set(worker.threadId, {
      operationBand: '1kb',
      operatingTasks: ['op3'],
    });

    worker.emit('exit', 1);

    expect(task.reject).toHaveBeenCalledWith('op3');
    expect(service['activeTasks'].has('op3')).toBeFalsy();
  });

  it('should not fail if handleWorkerThreadError called with unknown processId', () => {
    expect(() => service['handleWorkerThreadError'](99999)).not.toThrow();
  });

  it('should not process queue if no available workers', () => {
    service['availableWorkers'] = [];
    const spy = jest.spyOn(service as any, 'getTasks');
    (service as any).processQueue();
    expect(spy).not.toHaveBeenCalled();
  });

  it('should push worker back if no tasks are available', () => {
    const worker = service['availableWorkers'].pop();
    // Remove all tasks from all bands
    service['operationBands'].forEach((band) => band.task = []);
    (service as any).processQueue();
    expect(service['availableWorkers']).toBeDefined();
  });

  it('should use default sizes if configService.get("worker.thread.threadBand") throws', async () => {
    // Arrange
    const configServiceMock = {
      get: jest.fn((key: string) => {
        if (key === 'worker.thread.threadBand') throw new Error('bad config');
        if (key === 'worker.thread.threadCount') return 3;
        return undefined;
      }),
    };

    const loggerMock = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const loggerFactoryMock = {
      create: jest.fn().mockReturnValue(loggerMock),
    };

    const metricsServiceMock = {
      recordTaskCompleted: jest.fn(),
      recordWorkerThreadError: jest.fn(),
      updateWorkerThreadStatus: jest.fn(),
      updateQueueDepth: jest.fn(),
      updateBandAllocation: jest.fn(),
    };

    const WorkerThreadServiceModule = (await import('./worker.thread.service')).WorkerThreadService;
    const service = new WorkerThreadServiceModule(configServiceMock as any, loggerFactoryMock as any, metricsServiceMock as any);

    // Assert
    expect(service['sizes']).toBeDefined()
  });

  it('assignThreads should distribute threads as expected for >5 threads', () => {
    service['sizes'] = [
      { name: "1kb", maxFetch: 1500 },
      { name: "1mb", maxFetch: 1000 },
      { name: "10mb", maxFetch: 100 },
      { name: "100mb", maxFetch: 10 },
      { name: "1gb", maxFetch: 1 }
    ];
    service['totalThreads'] = 7;
    const bands = service.assignThreads();
    const total = Array.from(bands.values()).reduce((acc, band) => acc + band.numberOfThreads, 0);
    expect(total).toBe(7);
  });

  it('processQueue should call postMessage with correct input', () => {
    const worker = service['availableWorkers'][0];
    const spy = jest.spyOn(worker, 'postMessage');
    const task = {
      id: 'op4',
      data: { sourcePath: 'src', destinationPath: 'dest', operationId: 'op4' },
      Operation: ThreadOperation.COPY_FILE,
      resolve: jest.fn(),
      reject: jest.fn(),
    };
    service['operationBands'].get('1kb').task.push(task);
    service['workerDetails'].set(worker.threadId, { operationBand: '1kb', operatingTasks: [] });

    (service as any).processQueue();

    expect(service['activeTasks'].has('op4')).toBeTruthy();
  });

  it('should reject task if worker emits message with isRejected', async () => {
    const migrateFile: MigrateFile = {
      sourcePath: 'source.txt',
      destinationPath: 'dest.txt',
      operationId: 'op5',
      size: 500,
    };

    const worker = service['availableWorkers'][0];

    setImmediate(() => {
      const fakeOutput: WorkerThreadOutput = {
        isResolved: false,
        isRejected: true,
        id: 'op5',
        data: { error: 'fail' },
        Operation: ThreadOperation.COPY_FILE,
      };
      worker.emit('message', [fakeOutput]);
    });

    await expect(service.migrateWorkerThread(migrateFile)).rejects.toEqual({ error: 'fail' });
  });

  it('getTasks should return empty array if all bands are empty', () => {
    service['operationBands'].forEach((band) => band.task = []);
    const tasks = service.getTasks('1kb');
    expect(tasks).toEqual([]);
  });

  it('getTaskBand should return correct band name for different sizes', () => {
    // Default sizes: 1kb, 1mb, 10mb, 100mb, 1gb
    service['sizes'] = [
      { name: "1kb", maxFetch: 1500 },
      { name: "1mb", maxFetch: 1000 },
      { name: "10mb", maxFetch: 100 },
      { name: "100mb", maxFetch: 10 },
      { name: "1gb", maxFetch: 1 }
    ];

    expect(service.getTaskBand(500)).toBe('1kb');
    expect(service.getTaskBand(1024)).toBe('1kb');
    expect(service.getTaskBand(1025)).toBe('1mb');
    expect(service.getTaskBand(1048576)).toBe('1mb');
    expect(service.getTaskBand(1048577)).toBe('10mb');
    expect(service.getTaskBand(10485760)).toBe('10mb');
    expect(service.getTaskBand(10485761)).toBe('100mb');
    expect(service.getTaskBand(104857600)).toBe('100mb');
    expect(service.getTaskBand(104857601)).toBe('1gb');
  });

});
