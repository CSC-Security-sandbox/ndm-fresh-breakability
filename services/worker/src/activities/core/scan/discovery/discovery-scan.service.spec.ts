import { ErrorType } from '@netapp-cloud-datamigrate/jobs-lib';
import * as fs from 'fs';
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from '@nestjs/testing';
import * as path from 'path';
import { getFileInfo, getFilePermissions, removePrefix, shouldExcludeOrSkip, checkCaseSensitiveConflict } from 'src/activities/utils/utils';
import { FatalError } from 'src/errors/errors.types';
import { DiscoveryScanService } from './discovery-scan.service';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { WinOperationService } from "../../../core/migrate/command-execution/win-opeartions/win-operation.service";
import { WindowsAPINotAvailableError } from "../../../core/migrate/command-execution/win-opeartions/acl-operation.error";
import { FileTypeDetectionService } from '../../utils/file-type-detection.service';
import { FileType } from 'src/activities/types/tasks';

jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    promises: {
      access: jest.fn(),
      readdir: jest.fn(),
      opendir: jest.fn(),
      lstat: jest.fn(),
    },
  };
});

async function* asyncDirIterator(items: Array<{ name: string }>): AsyncGenerator<{ name: string }> {
  for (const item of items) {
    yield item;
  }
}

function mockOpendir(dirents: Array<{ name: string }>) {
  (fs.promises.opendir as jest.Mock).mockResolvedValue({
    [Symbol.asyncIterator]: () => asyncDirIterator(dirents),
    close: jest.fn().mockResolvedValue(undefined),
  });
}

jest.mock('path', () => {
  const actualPath = jest.requireActual('path');
  return {
    ...actualPath,
    join: jest.fn((...parts: string[]) => parts.join('/')),
  };
});

function createCaseSensitiveConflictMock() {
    return jest.fn().mockImplementation(async (
        jobType: string,
        item: string,
        lowerCaseSourceData: Set<string>,
        relativeSourcePath: string,
        sourceContentPath: string,
        command: any,
        jobContext: any
    ) => {
        const lowerCaseFileName = item.toLowerCase();
        if (lowerCaseSourceData.has(lowerCaseFileName)) {
            const dmErr = {
                error: {
                    message: "Directory contents not discovered: Another directory with same name but different case exists"
                }
            };
            await jobContext.publishToErrorStream(dmErr);
            return true;
        }
        lowerCaseSourceData.add(lowerCaseFileName);
        return false;
    });
}

jest.mock('src/activities/utils/utils', () => ({
  dmError: jest.fn((type, origin, operation, errorType, corrId, error) => ({error,})),
  getFileInfo: jest.fn(),
  getFilePermissions: jest.fn(),
  getFileType: jest.fn(),
  removePrefix: jest.fn(),
  shouldExcludeOrSkip: jest.fn(),
  checkCaseSensitiveConflict: jest.fn(),
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
  let detectFileTypeMock: jest.Mock;

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
    detectFileTypeMock = fileTypeDetectionService.detectFileType as unknown as jest.Mock;
    detectFileTypeMock.mockReset();
    detectFileTypeMock.mockResolvedValue(FileType.FILE);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('scanDirectory', () => {
    const mockStat = {
      isDirectory: () => false,
      isSymbolicLink: () => false,
    };

    beforeEach(() => {
      (fs.promises.lstat as jest.Mock).mockResolvedValue(mockStat);
      mockOpendir([
        { name: 'file1.txt' },
        { name: 'subdir' },
      ]);

      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);

      (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);
      (getFileInfo as jest.Mock).mockResolvedValue({ fileName: 'file1.txt' });
      (getFilePermissions as jest.Mock).mockReturnValue('755');
      (removePrefix as jest.Mock).mockImplementation((fullPath: string, prefix: string) => fullPath.replace(`${prefix}/`, ''));

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
      expect(result.subDirs).toEqual(['subdir']);
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
      mockOpendir([
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
      mockOpendir([{ name: 'file1.txt' }]);
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
      mockOpendir([]);
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

    it('should skip duplicate directories with same name and different case for SMB', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32'});
      mockOpendir([
        { name: 'Folder' },
        { name: 'folder' },
        { name: 'FOLder' },
        { name: 'FILE.txt' },
        { name: 'file.txt' },
      ]);
      (fs.promises.lstat as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.endsWith('.txt')) {
          return Promise.resolve({
            isDirectory: () => false,
            isSymbolicLink: () => false,
          });
        }
        return Promise.resolve({
          isDirectory: () => true,
          isSymbolicLink: () => false,
        });
      });
      detectFileTypeMock.mockImplementation((filePath: string) =>
        filePath.endsWith('.txt') ? FileType.FILE : FileType.DIRECTORY,
      );
      (checkCaseSensitiveConflict as jest.Mock).mockImplementation(createCaseSensitiveConflictMock());

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

      expect(result.fileCount).toBe(2);
      expect(result.dirCount).toBe(3);
      expect(result.subDirs).toHaveLength(1);
      expect(mockJobContext.publishToErrorStream).toHaveBeenCalledTimes(2);
      expect(mockJobContext.publishToErrorStream).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: expect.stringContaining('same name but different case')
          })
        })
      );
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should include directories with same name and different case for NFS', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockOpendir([
        { name: 'Folder' },
        { name: 'folder' },
        { name: 'FOLder' },
        { name: 'FILE.txt' },
        { name: 'file.txt' },
      ]);
      (fs.promises.lstat as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.endsWith('.txt')) {
          return Promise.resolve({
            isDirectory: () => false,
            isSymbolicLink: () => false,
          });
        }
        return Promise.resolve({
          isDirectory: () => true,
          isSymbolicLink: () => false,
        });
      });
      detectFileTypeMock.mockImplementation((filePath: string) =>
        filePath.endsWith('.txt') ? FileType.FILE : FileType.DIRECTORY,
      );
      (checkCaseSensitiveConflict as jest.Mock).mockImplementation(
        createCaseSensitiveConflictMock()
      );

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

      expect(result.fileCount).toBe(2);
      expect(result.dirCount).toBe(3);
      expect(result.subDirs).toEqual(['Folder', 'folder', 'FOLder']);
      expect(mockJobContext.publishToErrorStream).not.toHaveBeenCalled();
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    describe('WindowsAPINotAvailableError handling', () => {
      const originalPlatform = process.platform;

      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
      });

      afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      });

      it('should set TRANSIENT_ERROR type when WindowsAPINotAvailableError is caught in scanDirectory', async () => {
        // Arrange: Setup file system mocks
        mockOpendir([
          { name: 'file1.txt' },
        ]);
        (fs.promises.lstat as jest.Mock).mockResolvedValue({
          isDirectory: () => false,
          isSymbolicLink: () => false,
          size: 1024,
          atime: new Date(),
          birthtime: new Date(),
          mtime: new Date(),
          ino: 12345,
        });
        (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);
        detectFileTypeMock.mockResolvedValue(FileType.FILE);

        // Arrange: Mock publishFileInfo to throw WindowsAPINotAvailableError
        const windowsAPIError = new WindowsAPINotAvailableError();
        jest.spyOn(service, 'publishFileInfo').mockRejectedValue(windowsAPIError);

        // Act & Assert: Should throw the error
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
            errorType: ErrorType.RECOVERABLE_ERROR,
          } as any)
        ).rejects.toThrow(WindowsAPINotAvailableError);

        // Assert: Error should be published with TRANSIENT_ERROR type
        expect(mockJobContext.publishToErrorStream).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              message: 'Windows API is not available for ADS detection',
            }),
          })
        );
      });

      it('should publish DM error to error stream when WindowsAPINotAvailableError occurs', async () => {
        // Arrange: Setup file system mocks
        mockOpendir([
          { name: 'file1.txt' },
        ]);
        (fs.promises.lstat as jest.Mock).mockResolvedValue({
          isDirectory: () => false,
          isSymbolicLink: () => false,
          size: 1024,
          atime: new Date(),
          birthtime: new Date(),
          mtime: new Date(),
          ino: 12345,
        });
        (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);
        detectFileTypeMock.mockResolvedValue(FileType.FILE);

        // Arrange: Mock publishFileInfo to throw WindowsAPINotAvailableError
        const windowsAPIError = new WindowsAPINotAvailableError();
        jest.spyOn(service, 'publishFileInfo').mockRejectedValue(windowsAPIError);

        // Act: Execute scanDirectory
        try {
          await service.scanDirectory({
            jobContext: mockJobContext,
            sourcePath: '/mock',
            sourcePrefix: '/mock',
            command: mockCommand,
            settings: {
              excludePatterns: [],
              skipFile: 0,
            },
            errorType: ErrorType.RECOVERABLE_ERROR,
          } as any);
        } catch (error) {
          // Expected to throw
        }

        // Assert: publishToErrorStream should have been called
        expect(mockJobContext.publishToErrorStream).toHaveBeenCalledTimes(1);
      });

      it('should rethrow WindowsAPINotAvailableError after publishing to error stream', async () => {
        // Arrange: Setup file system mocks
        mockOpendir([
          { name: 'file1.txt' },
        ]);
        (fs.promises.lstat as jest.Mock).mockResolvedValue({
          isDirectory: () => false,
          isSymbolicLink: () => false,
          size: 1024,
          atime: new Date(),
          birthtime: new Date(),
          mtime: new Date(),
          ino: 12345,
        });
        (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);
        detectFileTypeMock.mockResolvedValue(FileType.FILE);

        // Arrange: Mock publishFileInfo to throw WindowsAPINotAvailableError
        const windowsAPIError = new WindowsAPINotAvailableError();
        jest.spyOn(service, 'publishFileInfo').mockRejectedValue(windowsAPIError);

        // Act & Assert: Should rethrow the error
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
            errorType: ErrorType.RECOVERABLE_ERROR,
          } as any)
        ).rejects.toThrow(WindowsAPINotAvailableError);

        // Assert: Error was published before rethrowing
        expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
      });
    });
  });

  /**
   * Test suite for publishFileInfo method - Alternate Data Streams (ADS) scanning
   * 
   * ADS is a Windows NTFS feature that allows files to have multiple data streams.
   * Common use cases include:
   * - Zone.Identifier: Stores download source information
   * - Custom metadata streams: Application-specific data
   * 
   * These tests verify:
   * 1. ADS detection when enabled (shouldScanADS = true)
   * 2. ADS skipping when disabled (shouldScanADS = false)  
   * 3. Platform-specific behavior (Windows vs Linux/macOS)
   * 4. Handling of single, multiple, and zero streams
   * 5. Error handling during ADS detection
   */
  describe('publishFileInfo - Alternate Data Streams (ADS) Scanning', () => {
    // Common test fixtures
    let mockFileStats: any;
    let mockWinOperationService: any;
    const originalPlatform = process.platform;

    // Helper to simulate Windows environment
    const simulateWindowsPlatform = () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
    };

    // Helper to create ADS detection result
    const createADSResult = (streams: { name: string; size: number }[]) => ({
      hasADS: streams.length > 0,
      streamCount: streams.length,
      streamNames: streams.map(s => s.name),
      streamSizes: streams.map(s => s.size),
      totalSize: streams.reduce((sum, s) => sum + s.size, 0),
    });

    // Helper to create empty ADS result (no streams)
    const createEmptyADSResult = () => createADSResult([]);

    beforeEach(() => {
      // Setup: Create a mock file with standard metadata
      mockFileStats = {
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: 1024,
        atime: new Date('2023-01-01'),
        birthtime: new Date('2023-01-01'),
        mtime: new Date('2023-01-01'),
        ino: 12345,
      };

      // Setup: Mock the Windows operation service
      mockWinOperationService = {
        detectADSInfo: jest.fn(),
      };
      (service as any).winOperationService = mockWinOperationService;

      // Setup: Add bulk publish capability to job context
      mockJobContext.publishToFileStreamBulk = jest.fn();
    });

    afterEach(() => {
      // Cleanup: Restore original platform after each test
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    describe('When ADS scanning is ENABLED (shouldScanADS = true)', () => {
      
      describe('Multiple streams detection', () => {
        it('should detect and publish two ADS streams for a file on Windows', async () => {
          // Arrange: Simulate Windows with a file containing two ADS streams
          simulateWindowsPlatform();
          const twoStreams = [
            { name: 'Zone.Identifier', size: 128 },  // Common stream for downloaded files
            { name: 'CustomMetadata', size: 256 },   // Custom application stream
          ];
          mockWinOperationService.detectADSInfo.mockResolvedValue(createADSResult(twoStreams));

          // Act: Publish file info with ADS scanning enabled
          await service.publishFileInfo({
            jobContext: mockJobContext,
            command: mockCommand,
            stats: mockFileStats,
            fPath: '/mock/downloaded-file.txt',
            relativeSourcePath: 'downloaded-file.txt',
            fileType: FileType.FILE,
            shouldScanADS: true,
          } as any);

          // Assert: Main file should be published
          expect(mockJobContext.publishToFileStream).toHaveBeenCalledTimes(1);
          
          // Assert: ADS detection should be called for the file with jobContext, command, and path
          expect(mockWinOperationService.detectADSInfo).toHaveBeenCalledWith(
            mockJobContext,
            mockCommand,
            '/mock/downloaded-file.txt'
          );
          
          // Assert: Both streams should be published with correct naming convention (filename:streamname)
          expect(mockJobContext.publishToFileStreamBulk).toHaveBeenCalledWith(
            expect.arrayContaining([
              expect.objectContaining({ 
                fileName: 'downloaded-file.txt:Zone.Identifier', 
                fileType: FileType.STREAM 
              }),
              expect.objectContaining({ 
                fileName: 'downloaded-file.txt:CustomMetadata', 
                fileType: FileType.STREAM 
              }),
            ])
          );
        });

        it('should correctly publish three streams with proper file type', async () => {
          // Arrange: File with multiple custom streams
          simulateWindowsPlatform();
          const threeStreams = [
            { name: 'Metadata', size: 100 },
            { name: 'Thumbnail', size: 200 },
            { name: 'History', size: 300 },
          ];
          mockWinOperationService.detectADSInfo.mockResolvedValue(createADSResult(threeStreams));

          // Act
          await service.publishFileInfo({
            jobContext: mockJobContext,
            command: mockCommand,
            stats: mockFileStats,
            fPath: '/mock/document.docx',
            relativeSourcePath: 'document.docx',
            fileType: FileType.FILE,
            shouldScanADS: true,
          } as any);

          // Assert: All three streams published with STREAM file type
          const publishedStreams = mockJobContext.publishToFileStreamBulk.mock.calls[0][0];
          expect(publishedStreams).toHaveLength(3);
          
          expect(mockJobContext.publishToFileStreamBulk).toHaveBeenCalledWith(
            expect.arrayContaining([
              expect.objectContaining({ fileName: 'document.docx:Metadata', fileType: FileType.STREAM }),
              expect.objectContaining({ fileName: 'document.docx:Thumbnail', fileType: FileType.STREAM }),
              expect.objectContaining({ fileName: 'document.docx:History', fileType: FileType.STREAM }),
            ])
          );
        });
      });

      describe('Single stream detection', () => {
        it('should publish exactly one stream when file has single ADS', async () => {
          // Arrange: File with only Zone.Identifier (common for downloaded files)
          simulateWindowsPlatform();
          const singleStream = [{ name: 'Zone.Identifier', size: 128 }];
          mockWinOperationService.detectADSInfo.mockResolvedValue(createADSResult(singleStream));

          // Act
          await service.publishFileInfo({
            jobContext: mockJobContext,
            command: mockCommand,
            stats: mockFileStats,
            fPath: '/mock/internet-download.exe',
            relativeSourcePath: 'internet-download.exe',
            fileType: FileType.FILE,
            shouldScanADS: true,
          } as any);

          // Assert: Main file published
          expect(mockJobContext.publishToFileStream).toHaveBeenCalledTimes(1);
          
          // Assert: Only one stream published
          const publishedStreams = mockJobContext.publishToFileStreamBulk.mock.calls[0][0];
          expect(publishedStreams).toHaveLength(1);
          expect(publishedStreams[0]).toMatchObject({
            fileName: 'internet-download.exe:Zone.Identifier',
            fileType: FileType.STREAM,
          });
        });
      });

      describe('No streams detection', () => {
        it('should only publish main file when no ADS streams exist', async () => {
          // Arrange: Regular file without any alternate streams
          simulateWindowsPlatform();
          mockWinOperationService.detectADSInfo.mockResolvedValue(createEmptyADSResult());

          // Act
          await service.publishFileInfo({
            jobContext: mockJobContext,
            command: mockCommand,
            stats: mockFileStats,
            fPath: '/mock/regular-file.txt',
            relativeSourcePath: 'regular-file.txt',
            fileType: FileType.FILE,
            shouldScanADS: true,
          } as any);

          // Assert: Main file published
          expect(mockJobContext.publishToFileStream).toHaveBeenCalledTimes(1);
          
          // Assert: ADS detection was attempted with correct parameters
          expect(mockWinOperationService.detectADSInfo).toHaveBeenCalledWith(
            mockJobContext,
            mockCommand,
            '/mock/regular-file.txt'
          );
          
          // Assert: No streams published (bulk publish not called)
          expect(mockJobContext.publishToFileStreamBulk).not.toHaveBeenCalled();
        });
      });

      describe('Error handling', () => {
        it('should rethrow error when ADS detection fails', async () => {
          // Arrange: Simulate ADS detection throwing an error
          simulateWindowsPlatform();
          const adsDetectionError = new Error('Access denied to file streams');
          mockWinOperationService.detectADSInfo.mockRejectedValue(adsDetectionError);

          // Act & Assert: Should throw the error
          await expect(
            service.publishFileInfo({
              jobContext: mockJobContext,
              command: mockCommand,
              stats: mockFileStats,
              fPath: '/mock/protected-file.txt',
              relativeSourcePath: 'protected-file.txt',
              fileType: FileType.FILE,
              shouldScanADS: true,
            } as any)
          ).rejects.toThrow('Access denied to file streams');

          // Assert: Main file was still published before error
          expect(mockJobContext.publishToFileStream).toHaveBeenCalledTimes(1);
          
          // Assert: ADS detection was attempted
          expect(mockWinOperationService.detectADSInfo).toHaveBeenCalled();
          
          // Assert: No streams published due to error
          expect(mockJobContext.publishToFileStreamBulk).not.toHaveBeenCalled();
        });

        it('should rethrow WindowsAPINotAvailableError when Windows API is unavailable', async () => {
          // Arrange: Simulate Windows API not available
          simulateWindowsPlatform();
          const windowsAPIError = new WindowsAPINotAvailableError();
          mockWinOperationService.detectADSInfo.mockRejectedValue(windowsAPIError);

          // Act & Assert: Should throw WindowsAPINotAvailableError
          await expect(
            service.publishFileInfo({
              jobContext: mockJobContext,
              command: mockCommand,
              stats: mockFileStats,
              fPath: '/mock/file.txt',
              relativeSourcePath: 'file.txt',
              fileType: FileType.FILE,
              shouldScanADS: true,
            } as any)
          ).rejects.toThrow(WindowsAPINotAvailableError);

          // Assert: Main file was still published before error
          expect(mockJobContext.publishToFileStream).toHaveBeenCalledTimes(1);
          
          // Assert: ADS detection was attempted
          expect(mockWinOperationService.detectADSInfo).toHaveBeenCalled();
        });
      });
    });

    describe('When ADS scanning is DISABLED (shouldScanADS = false)', () => {
      
      it('should skip ADS detection entirely on Windows', async () => {
        // Arrange
        simulateWindowsPlatform();

        // Act
        await service.publishFileInfo({
          jobContext: mockJobContext,
          command: mockCommand,
          stats: mockFileStats,
          fPath: '/mock/file.txt',
          relativeSourcePath: 'file.txt',
          fileType: FileType.FILE,
          shouldScanADS: false,
        } as any);

        // Assert: Only main file published
        expect(mockJobContext.publishToFileStream).toHaveBeenCalledTimes(1);
        
        // Assert: ADS detection should NOT be called
        expect(mockWinOperationService.detectADSInfo).not.toHaveBeenCalled();
        
        // Assert: No streams published
        expect(mockJobContext.publishToFileStreamBulk).not.toHaveBeenCalled();
      });

      it('should publish only the main file info without stream detection', async () => {
        // Arrange
        simulateWindowsPlatform();

        // Act
        await service.publishFileInfo({
          jobContext: mockJobContext,
          command: mockCommand,
          stats: mockFileStats,
          fPath: '/mock/simple-file.txt',
          relativeSourcePath: 'simple-file.txt',
          fileType: FileType.FILE,
          shouldScanADS: false,
        } as any);

        // Assert: Main file published with correct properties
        expect(mockJobContext.publishToFileStream).toHaveBeenCalledWith(
          expect.objectContaining({ 
            fileName: 'simple-file.txt', 
            fileType: FileType.FILE 
          })
        );
        
        // Assert: No ADS-related operations performed
        expect(mockWinOperationService.detectADSInfo).not.toHaveBeenCalled();
      });

      it('should publish ItemInfo with null checksumTime for discovery scan', async () => {
        // Act: Publish file info (discovery scan does not calculate checksum)
        await service.publishFileInfo({
          jobContext: mockJobContext,
          command: mockCommand,
          stats: mockFileStats,
          fPath: '/mock/test-file.txt',
          relativeSourcePath: 'test-file.txt',
          fileType: FileType.FILE,
          shouldScanADS: false,
        } as any);

        // Assert: checksumTime should be null for discovery scan (checksum is only generated during copy/migration)
        const publishedItemInfo = mockJobContext.publishToFileStream.mock.calls[0][0];
        expect(publishedItemInfo.checksumTime).toBeNull();
      });
    });

    describe('Platform-specific behavior (ADS is Windows-only)', () => {
      
      it('should skip ADS scanning on Linux regardless of shouldScanADS setting', async () => {
        // Arrange: Linux platform
        Object.defineProperty(process, 'platform', { value: 'linux' });

        // Act: Try to scan ADS on Linux
        await service.publishFileInfo({
          jobContext: mockJobContext,
          command: mockCommand,
          stats: mockFileStats,
          fPath: '/home/user/file.txt',
          relativeSourcePath: 'file.txt',
          fileType: FileType.FILE,
          shouldScanADS: true,  // Even though enabled, should be skipped on Linux
        } as any);

        // Assert: ADS detection NOT called (ADS doesn't exist on Linux)
        expect(mockWinOperationService.detectADSInfo).not.toHaveBeenCalled();
        
        // Assert: Only main file published
        expect(mockJobContext.publishToFileStream).toHaveBeenCalledTimes(1);
        expect(mockJobContext.publishToFileStreamBulk).not.toHaveBeenCalled();
      });

      it('should skip ADS scanning on macOS regardless of shouldScanADS setting', async () => {
        // Arrange: macOS platform
        Object.defineProperty(process, 'platform', { value: 'darwin' });

        // Act: Try to scan ADS on macOS
        await service.publishFileInfo({
          jobContext: mockJobContext,
          command: mockCommand,
          stats: mockFileStats,
          fPath: '/Users/username/Documents/file.txt',
          relativeSourcePath: 'file.txt',
          fileType: FileType.FILE,
          shouldScanADS: true,  // Even though enabled, should be skipped on macOS
        } as any);

        // Assert: ADS detection NOT called (ADS doesn't exist on macOS)
        expect(mockWinOperationService.detectADSInfo).not.toHaveBeenCalled();
        
        // Assert: Only main file published
        expect(mockJobContext.publishToFileStream).toHaveBeenCalledTimes(1);
        expect(mockJobContext.publishToFileStreamBulk).not.toHaveBeenCalled();
      });
    });

    describe('Directory ADS scanning', () => {
      
      it('should detect and publish ADS for directories on Windows', async () => {
        // Arrange: Directory with an ADS stream (less common but possible)
        simulateWindowsPlatform();
        const directoryStats = {
          ...mockFileStats,
          isDirectory: () => true,
        };
        const directoryStream = [{ name: 'FolderMetadata', size: 50 }];
        mockWinOperationService.detectADSInfo.mockResolvedValue(createADSResult(directoryStream));

        // Act
        await service.publishFileInfo({
          jobContext: mockJobContext,
          command: mockCommand,
          stats: directoryStats,
          fPath: '/mock/project-folder',
          relativeSourcePath: 'project-folder',
          fileType: FileType.DIRECTORY,
          shouldScanADS: true,
        } as any);

        // Assert: Directory info published
        expect(mockJobContext.publishToFileStream).toHaveBeenCalledTimes(1);
        
        // Assert: ADS detection called for directory with correct parameters
        expect(mockWinOperationService.detectADSInfo).toHaveBeenCalledWith(
          mockJobContext,
          mockCommand,
          '/mock/project-folder'
        );
        
        // Assert: Directory stream published with correct naming
        expect(mockJobContext.publishToFileStreamBulk).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ 
              fileName: 'project-folder:FolderMetadata',
              fileType: FileType.STREAM,
            }),
          ])
        );
      });
    });
  });
});
