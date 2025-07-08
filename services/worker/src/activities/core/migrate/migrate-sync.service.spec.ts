import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import { ShellService } from 'src/activities/common/shell.service';
import { RedisService } from 'src/redis/redis.service';
import { WorkerThreadService } from 'src/thread/worker.thread.service';
import { CommonTaskService } from '../common/common-task.service';
import { MigrateSyncService } from './migrate-sync.service';

jest.mock('fs');
jest.mock('path');

describe('MigrateSyncService', () => {
  let service: MigrateSyncService;
  let redisService: RedisService;
  let shellService: ShellService;
  let workerThreadService: WorkerThreadService;
  let commonTaskService: CommonTaskService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MigrateSyncService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const mockConfig = {
                'worker.workerId': 'mock-worker',
                'worker.maxRetryCount': 3,
                'worker.maxCommandConcurrency': 100,
                'worker.migrationChunkSize': 1024,
              };
              return mockConfig[key];
            }),
          },
        },
        {
          provide: RedisService,
          useValue: {
            getOwnerIdentity: jest.fn().mockResolvedValue('mapped-identity'),
            getJobManagerContext: jest.fn(),
          },
        },
        {
          provide: ShellService,
          useValue: {
            runCommand: jest.fn().mockResolvedValue('command output'),
          },
        },
        {
          provide: WorkerThreadService,
          useValue: {
            migrateWorkerThread: jest.fn().mockResolvedValue('mockChecksum'),
          },
        },
        {
          provide: CommonTaskService,
          useValue: {
            ensureTaskValid: jest.fn().mockImplementation(({ task }) => task),
          },
        },
        {
          provide: Logger,
          useValue: {
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MigrateSyncService>(MigrateSyncService);
    redisService = module.get(RedisService);
    shellService = module.get(ShellService);
    workerThreadService = module.get(WorkerThreadService);
    commonTaskService = module.get(CommonTaskService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('ensureDirectoryExists', () => {
    it('should create directory if it does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const mkdirMock = jest.fn();
      (fs.mkdirSync as jest.Mock) = mkdirMock;

      service.ensureDirectoryExists('/test/dir');

      expect(fs.existsSync).toHaveBeenCalledWith('/test/dir');
      expect(mkdirMock).toHaveBeenCalledWith('/test/dir', { recursive: true });
    });

    it('should not create directory if it exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const mkdirMock = jest.fn();
      (fs.mkdirSync as jest.Mock) = mkdirMock;

      service.ensureDirectoryExists('/test/dir');

      expect(fs.existsSync).toHaveBeenCalledWith('/test/dir');
      expect(mkdirMock).not.toHaveBeenCalled();
    });


  });

});
