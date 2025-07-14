import { Test, TestingModule } from '@nestjs/testing';
import { WorkerThreadService } from './worker.thread.service';
import { WorkerThreadOutput, ThreadOperation, MigrateFile } from './worker.thread.type';
import { ConfigService } from '@nestjs/config';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from '../auth/auth.service.spec';

jest.mock('worker_threads', () => {
  const EventEmitter = require('events');
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
      ],
    }).compile();

    service = module.get<WorkerThreadService>(WorkerThreadService);
    configService = module.get<ConfigService>(ConfigService);
    loggerFactory = module.get<LoggerFactory>(LoggerFactory);
    logger = mockLoggerFactory.create(WorkerThreadService.name);
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

  it('should get tasks from the correct band and fallback to others', () => {
    service['sizes'] = [
      { name: '1kb', maxFetch: 2 },
      { name: '1mb', maxFetch: 2 },
      { name: '10mb', maxFetch: 2 },
    ];
    service['operationBands'] = new Map([
      [
        '1kb',
        {
          numberOfThreads: 1,
          task: [
            {
              id: 'a',
              data: {},
              Operation: ThreadOperation.COPY_FILE,
              resolve: jest.fn(),
              reject: jest.fn(),
            },
            {
              id: 'b',
              data: {},
              Operation: ThreadOperation.COPY_FILE,
              resolve: jest.fn(),
              reject: jest.fn(),
            },
          ],
        },
      ],
      [
        '1mb',
        {
          numberOfThreads: 1,
          task: [
            {
              id: 'c',
              data: {},
              Operation: ThreadOperation.COPY_FILE,
              resolve: jest.fn(),
              reject: jest.fn(),
            },
          ],
        },
      ],
      ['10mb', { numberOfThreads: 1, task: [] }],
    ]);
    // Should fetch from 1kb
    let tasks = service.getTasks('1kb');
    expect(tasks.map(t => t.id)).toEqual(['a', 'b']);
    // Should fetch from 1mb (only one task)
    tasks = service.getTasks('1mb');
    expect(tasks.map(t => t.id)).toEqual(['c']);
    // Should fallback to previous bands (all empty now)
    tasks = service.getTasks('10mb');
    expect(tasks).toEqual([]);
  });

  it('should handle worker exit and remove tasks', () => {
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

    expect(task.reject).toHaveBeenCalled();
    expect(service['activeTasks'].has('op3')).toBeFalsy();
  });

  it('should not fail if handleWorkerThreadError is called with unknown processId', () => {
    expect(() => service['handleWorkerThreadError'](99999)).not.toThrow();
  });

  it('should not process queue if no available workers', () => {
    service['availableWorkers'] = [];
    // Should not throw or do anything
    expect(() => service['processQueue']()).not.toThrow();
  });

  it('should push worker back if no tasks available in processQueue', () => {
    const worker = service['availableWorkers'][0];
    // Mock getTasks to return empty
    jest.spyOn(service, 'getTasks').mockReturnValueOnce([]);
    service['processQueue']();
    expect(service['availableWorkers']).toContain(worker);
  });
});