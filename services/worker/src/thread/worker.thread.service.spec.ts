import { Test, TestingModule } from '@nestjs/testing';
import { WorkerThreadService } from './worker.thread.service';
import { WorkerThreadOutput, ThreadOperation, MigrateFile } from './worker.thread.type';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

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
  let logger: Logger;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerThreadService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(5) },
        },
        {
          provide: Logger,
          useValue: new Logger(),
        },
      ],
    }).compile();

    service = module.get<WorkerThreadService>(WorkerThreadService);
    configService = module.get<ConfigService>(ConfigService);
    logger = module.get<Logger>(Logger);
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
});
