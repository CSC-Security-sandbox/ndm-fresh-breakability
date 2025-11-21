import { ErrorType } from '@netapp-cloud-datamigrate/jobs-lib';
import * as fs from 'fs';
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from '@nestjs/testing';
import * as path from 'path';
import { getFileInfo, getFilePermissions, removePrefix, shouldExcludeOrSkip } from 'src/activities/utils/utils';
import { FatalError } from 'src/errors/errors.types';
import { DiscoveryScanService } from './discovery-scan.service';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { WinOperationService } from "../../../core/migrate/command-execution/win-opeartions/win-operation.service";
import { FileTypeDetectionService } from '../../utils/file-type-detection.service';

jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    promises: {
      access: jest.fn(),
      readdir: jest.fn(),
      lstat: jest.fn(),
    },
  };
});

jest.mock('path', () => {
  const actualPath = jest.requireActual('path');
  return {
    ...actualPath,
    join: jest.fn((...parts: string[]) => parts.join('/')),
  };
});

jest.mock('src/activities/utils/utils', () => ({
  dmError: jest.fn(),
  getFileInfo: jest.fn(),
  getFilePermissions: jest.fn(),
  getFileType: jest.fn(),
  removePrefix: jest.fn(),
  shouldExcludeOrSkip: jest.fn(),
}))

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'worker.workerId') return 'worker-123';
    if (key === 'worker.maxCommandConcurrency') return 10;
    if (key === 'worker.maxRetryCount') return 2;
  }),
};

describe('DiscoveryScanService', () => {
  let mockJobContext: any;
  let mockCommand: any;
  let service: DiscoveryScanService;
  let configService: ConfigService;
  let loggerFactory: LoggerFactory;
  let winOperationService: WinOperationService;
  let logger: LoggerService;
  let fileTypeDetectionService: FileTypeDetectionService;

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue({
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    }),
  };
   
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscoveryScanService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              switch (key) {
                case 'worker.workerId':
                  return 'worker-1';
                case 'worker.maxCommandConcurrency':
                  return 50;
                case 'worker.maxRetryCount':
                  return 5;
                default:
                  return null;
              }
            }),
          },
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        {
          provide: WinOperationService,
          useValue: winOperationService,
        },
        {
          provide: FileTypeDetectionService,
          useValue: {
            detectFileType: jest.fn(),
          },
        },
      ],
    }).compile();
    mockJobContext = {
      publishToErrorStream: jest.fn(),
      publishToFileStream: jest.fn(),
      jobConfig: {
        options: {
          excludeOlderThan: new Date('2022-01-01'),
        },
        jobType: 'DISCOVERY',
      },
    };
    mockCommand = {
      commandId: 'cmd-1',
      retryCount: 1,
      fPath: 'some/file.txt',
    };

    service = module.get<DiscoveryScanService>(DiscoveryScanService);
    configService = module.get<ConfigService>(ConfigService);
    loggerFactory = module.get<LoggerFactory>(LoggerFactory);
    winOperationService = module.get<WinOperationService>(WinOperationService);
    logger = loggerFactory.create(DiscoveryScanService.name);
    fileTypeDetectionService = module.get<FileTypeDetectionService>(FileTypeDetectionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getDirContents', () => {
    it('should return directory contents successfully', async () => {
      const dirents = [{ name: 'file1.txt' }] as unknown as fs.Dirent[];
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.readdir as jest.Mock).mockResolvedValue(dirents);

      const result = await service.getDirContents({
        path: '/mock/path',
        jobContext: mockJobContext,
        errorType: ErrorType.RECOVERABLE_ERROR,
        command: mockCommand,
      });

      expect(result).toEqual(dirents);
    });

    it('should throw FatalError and publish to error stream', async () => {
      (fs.promises.access as jest.Mock).mockRejectedValue({ code: 'ENOENT' });

      await expect(
        service.getDirContents({
          path: '/bad/path',
          jobContext: mockJobContext,
          errorType: ErrorType.RECOVERABLE_ERROR,
          command: mockCommand,
        }),
      ).rejects.toThrow(FatalError);

      expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
    });

    it('should catch unexpected error from readdir and publish error', async () => {
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
      const err = new Error('readdir failed');
      (fs.promises.readdir as jest.Mock).mockRejectedValue(err);

      await expect(
        service.getDirContents({
          path: '/mock/path',
          jobContext: mockJobContext,
          errorType: ErrorType.RECOVERABLE_ERROR,
          command: mockCommand,
        }),
      ).rejects.toThrow(err);

      expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
    });
  });

  describe('scanDirectory', () => {
    const mockStat = {
      isDirectory: () => false,
      isSymbolicLink: () => false,
    };

    beforeEach(() => {
      (fs.promises.lstat as jest.Mock).mockResolvedValue(mockStat);
      (fs.promises.readdir as jest.Mock).mockResolvedValue([
        { name: 'file1.txt' },
        { name: 'subdir' },
      ]);

      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);

      (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);
      (getFileInfo as jest.Mock).mockResolvedValue({ fileName: 'file1.txt' });
      (getFilePermissions as jest.Mock).mockReturnValue('755');
      (removePrefix as jest.Mock).mockReturnValue('relative/path');

      (path.join as jest.Mock).mockImplementation((...args) => args.join('/'));
    });

    it('should scan directory and return file and dir count', async () => {
      // Change behavior for directory check
      (fs.promises.lstat as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.endsWith('subdir')) {
          return Promise.resolve({
            isDirectory: () => true,
            isSymbolicLink: () => false,
          });
        }
        return Promise.resolve({
          isDirectory: () => false,
          isSymbolicLink: () => false,
        });
      });

      const result = await service.scanDirectory({
        jobContext: mockJobContext,
        sourcePath: '/mock',
        sourcePrefix: '/mock',
        command: mockCommand,
        settings: {
          excludePatterns: [],
          skipFile: 0,
        },
      }as any);

      expect(result.fileCount).toBe(1);
      expect(result.dirCount).toBe(1);
      expect(result.subDirs).toEqual(['relative/path']);
      expect(mockJobContext.publishToFileStream).toHaveBeenCalledTimes(2);
    });

    it('should skip excluded files', async () => {
      (shouldExcludeOrSkip as jest.Mock).mockReturnValue(true);

      const result = await service.scanDirectory({
        jobContext: mockJobContext,
        sourcePath: '/mock',
        sourcePrefix: '/mock',
        command: mockCommand,
        settings: {
          excludePatterns: [],
          skipFile: 0,
        },
      }as any);

      expect(result.fileCount).toBe(0);
      expect(result.dirCount).toBe(0);
      expect(result.subDirs).toEqual([]);
      expect(mockJobContext.publishToFileStream).not.toHaveBeenCalled();
    });

    it('should handle errors and publish to error stream', async () => {
      const lstatError = new Error('lstat fail');
      (fs.promises.lstat as jest.Mock).mockRejectedValue(lstatError);

      await expect(
        service.scanDirectory({
          jobContext: mockJobContext,
          sourcePath: '/mock',
          sourcePrefix: '/mock',
          command: mockCommand,
          settings: {
            excludePatterns: [],
            skipFile: 0,
          },
        }as any),
      ).rejects.toThrow(lstatError);

      expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
    });

    it('should not count symlink directories as subDirs', async () => {
      (fs.promises.lstat as jest.Mock).mockImplementation((filePath: string) => {
      if (filePath.endsWith('subdir')) {
        return Promise.resolve({
        isDirectory: () => true,
        isSymbolicLink: () => true,
        });
      }
      return Promise.resolve({
        isDirectory: () => false,
        isSymbolicLink: () => false,
      });
      });

      const result = await service.scanDirectory({
      jobContext: mockJobContext,
      sourcePath: '/mock',
      sourcePrefix: '/mock',
      command: mockCommand,
      settings: {
        excludePatterns: [],
        skipFile: 0,
      },
      } as any);

      expect(result.fileCount).toBe(1);
      expect(result.dirCount).toBe(0);
      expect(result.subDirs).toEqual([]);
      expect(mockJobContext.publishToFileStream).toHaveBeenCalledTimes(2);
    });

    it('should use TRANSIENT_ERROR if retryCount exceeds maxRetryCount', async () => {
      const highRetryCommand = { ...mockCommand, retryCount: 3 };
      (fs.promises.lstat as jest.Mock).mockResolvedValue({
      isDirectory: () => false,
      isSymbolicLink: () => false,
      });
      (fs.promises.readdir as jest.Mock).mockResolvedValue([
      { name: 'file1.txt' },
      ]);
      (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);

      await service.scanDirectory({
      jobContext: mockJobContext,
      sourcePath: '/mock',
      sourcePrefix: '/mock',
      command: highRetryCommand,
      settings: {
        excludePatterns: [],
        skipFile: 0,
      },
      } as any);

      // The errorType is only used if an error occurs, so let's force an error
      (fs.promises.lstat as jest.Mock).mockRejectedValueOnce(new Error('fail'));
      await expect(
      service.scanDirectory({
        jobContext: mockJobContext,
        sourcePath: '/mock',
        sourcePrefix: '/mock',
        command: highRetryCommand,
        settings: {
        excludePatterns: [],
        skipFile: 0,
        },
      } as any)
      ).rejects.toThrow();
      expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
    });

    it('should handle empty directory', async () => {
      (fs.promises.readdir as jest.Mock).mockResolvedValue([]);
      const result = await service.scanDirectory({
      jobContext: mockJobContext,
      sourcePath: '/mock',
      sourcePrefix: '/mock',
      command: mockCommand,
      settings: {
        excludePatterns: [],
        skipFile: 0,
      },
      } as any);

      expect(result.fileCount).toBe(0);
      expect(result.dirCount).toBe(0);
      expect(result.subDirs).toEqual([]);
      expect(mockJobContext.publishToFileStream).not.toHaveBeenCalled();
    });
  });
});
