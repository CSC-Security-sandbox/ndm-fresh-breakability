import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { LogGeneratorActivity } from './log-generator.activity';

// Mock external dependencies
jest.mock('fs');
jest.mock('archiver');

// Mock child_process exec function
const mockExec = jest.fn();
jest.mock('child_process', () => ({
  exec: (
    cmd: string,
    callback: (error: any, stdout: string, stderr: string) => void,
  ) => {
    return mockExec(cmd, callback);
  },
}));

// Mock util.promisify to return a mock function
jest.mock('util', () => ({
  ...jest.requireActual('util'),
  promisify: jest.fn((fn) => {
    return jest.fn().mockImplementation((...args) => {
      return new Promise((resolve, reject) => {
        const callback = (error: any, stdout?: string, stderr?: string) => {
          if (error) {
            reject(error);
          } else {
            resolve({ stdout: stdout || '', stderr: stderr || '' });
          }
        };
        fn(...args, callback);
      });
    });
  }),
}));

describe('LogGeneratorActivity', () => {
  let activity: LogGeneratorActivity;
  let configService: jest.Mocked<ConfigService>;
  let mockLogger: jest.Mocked<Logger>;

  const mockFs = fs as jest.Mocked<typeof fs>;
  const mockArchiver = archiver as jest.MockedFunction<typeof archiver>;

  const baseLogPath = '/test/logs';
  const outputZipPath = '/test/output';

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'support-bundle.bundle.baseLogPath') return baseLogPath;
        if (key === 'support-bundle.bundle.outputZipPath') return outputZipPath;
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogGeneratorActivity,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    activity = module.get<LogGeneratorActivity>(LogGeneratorActivity);
    configService = module.get(ConfigService);

    // Mock logger
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as any;
    (activity as any).logger = mockLogger;

    // Setup config service mocks
    configService.get.mockImplementation((key: string) => {
      if (key === 'support-bundle.bundle.baseLogPath') return baseLogPath;
      if (key === 'support-bundle.bundle.outputZipPath') return outputZipPath;
      return undefined;
    });

    // Reset all mocks
    jest.clearAllMocks();

    // Setup default fs mocks
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.unlinkSync.mockReturnValue(undefined);
    mockFs.createWriteStream.mockReturnValue({
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    } as any);
  });

  describe('Constructor', () => {
    it('should initialize with valid configuration', () => {
      expect(activity).toBeDefined();
      // Don't check for specific calls since clearAllMocks() cleared the history
      // Just verify the activity was created successfully
    });

    it('should throw error when baseLogPath is missing', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'support-bundle.bundle.baseLogPath') return undefined;
        if (key === 'support-bundle.bundle.outputZipPath') return outputZipPath;
        return undefined;
      });

      expect(() => {
        new LogGeneratorActivity(configService);
      }).toThrow(
        'Missing required configuration for baseLogPath or outputZipPath',
      );
    });

    it('should throw error when outputZipPath is missing', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'support-bundle.bundle.baseLogPath') return baseLogPath;
        if (key === 'support-bundle.bundle.outputZipPath') return undefined;
        return undefined;
      });

      expect(() => {
        new LogGeneratorActivity(configService);
      }).toThrow(
        'Missing required configuration for baseLogPath or outputZipPath',
      );
    });

    it('should throw error when both configurations are missing', () => {
      configService.get.mockReturnValue(undefined);

      expect(() => {
        new LogGeneratorActivity(configService);
      }).toThrow(
        'Missing required configuration for baseLogPath or outputZipPath',
      );
    });
  });

  describe('fetchAndZipLogs', () => {
    const mockPayload = {
      userId: 'test-user-123',
      startDate: '2024-01-01',
      endDate: '2024-01-03',
      projectWorkerMap: [
        {
          projectId: 'project-1',
          workerIds: ['worker-1', 'worker-2']
        },
        {
          projectId: 'project-2',
          workerIds: ['worker-3']
        }
      ]
    };

    const traceId = 'trace-123';

    beforeEach(() => {
      // Mock fs methods
      mockFs.existsSync.mockReturnValue(true); // Mock base log path exists
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.unlinkSync.mockReturnValue(undefined);
      mockFs.createWriteStream.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      } as any);

      // Mock archiver
      const mockArchive = {
        on: jest.fn((event, callback) => {
          if (event === 'entry') {
            // Simulate entry events
            setTimeout(() => callback({ name: 'test-file' }), 0);
          }
        }),
        pipe: jest.fn(),
        file: jest.fn(),
        finalize: jest.fn().mockResolvedValue(undefined),
        pointer: jest.fn().mockReturnValue(12345),
      };
      mockArchiver.mockReturnValue(mockArchive as any);

      // Mock exec
      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(
            null,
            '/test/logs/2024-01-01/project-1/file1.log\n/test/logs/2024-01-02/project-2/file2.log\n',
            '',
          );
        }, 0);
        return {} as any;
      });
    });

    it('should successfully create zip when everything is valid', async () => {
      // Mock date folder existence
      mockFs.existsSync.mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr === baseLogPath) return true;
        if (pathStr === outputZipPath) return true;
        if (pathStr.includes('2024-01-01') || pathStr.includes('2024-01-02') || pathStr.includes('2024-01-03')) return true;
        if (pathStr.includes('project-1') || pathStr.includes('project-2')) return true;
        if (pathStr.includes('control_plane') || pathStr.includes('worker')) return true;
        return false;
      });

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };
      const mockArchive = {
        on: jest.fn(),
        pipe: jest.fn(),
        file: jest.fn(),
        finalize: jest.fn().mockResolvedValue(undefined),
        pointer: jest.fn().mockReturnValue(12345),
      };

      mockFs.createWriteStream.mockReturnValue(mockOutput as any);
      mockArchiver.mockReturnValue(mockArchive as any);

      // Mock findFilesInDirectory calls
      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(null, '/test/logs/2024-01-01/project-1/control_plane/test1.log\n/test/logs/2024-01-01/project-1/worker/worker-1/test2.log\n', '');
        }, 0);
        return {} as any;
      });

      const result = await activity.fetchAndZipLogs({
        traceId,
        payload: mockPayload,
      });

      expect(result).toStrictEqual({
        "message": "/test/output/ndm_logs_test-user-123.zip",
        "success": true
      });
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[trace-123] Started fetchAndZipLogs activity',
      );
    });

    it('should remove existing zip file if it exists', async () => {
      // Mock date folder existence
      mockFs.existsSync.mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr === baseLogPath) return true;
        if (pathStr === outputZipPath) return true;
        if (pathStr.includes('ndm_logs_test-user-123.zip')) return true;
        if (pathStr.includes('2024-01-01') || pathStr.includes('2024-01-02') || pathStr.includes('2024-01-03')) return true;
        if (pathStr.includes('project-1') || pathStr.includes('project-2')) return true;
        if (pathStr.includes('control_plane') || pathStr.includes('worker')) return true;
        return false;
      });

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      // Mock findFilesInDirectory calls
      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(null, '/test/logs/2024-01-01/project-1/control_plane/test1.log\n', '');
        }, 0);
        return {} as any;
      });

      await activity.fetchAndZipLogs({ traceId, payload: mockPayload });

      expect(mockFs.unlinkSync).toHaveBeenCalledWith(
        '/test/output/ndm_logs_test-user-123.zip',
      );
    });

    it('should create output directory if it does not exist', async () => {
      mockFs.existsSync.mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr === baseLogPath) return true;
        if (pathStr === outputZipPath) return false;
        if (pathStr.includes('2024-01-01') || pathStr.includes('2024-01-02') || pathStr.includes('2024-01-03')) return true;
        if (pathStr.includes('project-1') || pathStr.includes('project-2')) return true;
        if (pathStr.includes('control_plane') || pathStr.includes('worker')) return true;
        return false;
      });

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(), 0);
          }
        }),
      };
      const mockArchive = {
        on: jest.fn(),
        pipe: jest.fn(),
        file: jest.fn(),
        finalize: jest.fn().mockResolvedValue(undefined),
        pointer: jest.fn().mockReturnValue(1024),
      };

      mockFs.createWriteStream.mockReturnValue(mockOutput as any);
      mockArchiver.mockReturnValue(mockArchive as any);

      // Mock the exec function to return test files
      mockExec.mockImplementation((cmd, callback) => {
        callback(null, '/test/logs/2024-01-01/project-1/control_plane/test1.log\n', '');
      });

      await activity.fetchAndZipLogs({ traceId, payload: mockPayload });

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(outputZipPath, {
        recursive: true,
      });
    });

    it('should return error for invalid start date', async () => {
      const invalidPayload = {
        ...mockPayload,
        startDate: 'invalid-date',
      };

      const result = await activity.fetchAndZipLogs({ traceId, payload: invalidPayload });
      expect(result).toStrictEqual({
        success: false,
        message: 'Invalid date format. Expected YYYY-MM-DD format. Received startDate: invalid-date, endDate: 2024-01-03'
      });
    });

    it('should return error for invalid end date', async () => {
      const invalidPayload = {
        ...mockPayload,
        endDate: 'invalid-date',
      };

      const result = await activity.fetchAndZipLogs({ traceId, payload: invalidPayload });
      expect(result).toStrictEqual({
        success: false,
        message: 'Invalid date format. Expected YYYY-MM-DD format. Received startDate: 2024-01-01, endDate: invalid-date'
      });
    });

    it('should return error when start date is after end date', async () => {
      const invalidPayload = {
        ...mockPayload,
        startDate: '2024-01-05',
        endDate: '2024-01-01',
      };

      const result = await activity.fetchAndZipLogs({ traceId, payload: invalidPayload });
      expect(result).toStrictEqual({
        success: false,
        message: 'Invalid date range: start date "2024-01-05" is after end date "2024-01-01". Please ensure the start date is earlier than or equal to the end date.'
      });
    });

    it('should return error for missing projectWorkerMap', async () => {
      const invalidPayload = {
        userId: 'test-user-123',
        startDate: '2024-01-01',
        endDate: '2024-01-03',
      };

      const result = await activity.fetchAndZipLogs({ traceId, payload: invalidPayload });
      expect(result).toStrictEqual({
        success: false,
        message: 'Missing or invalid projectWorkerMap in payload. Expected an array.'
      });
    });

    it('should return error for empty projectWorkerMap', async () => {
      const emptyMapPayload = {
        ...mockPayload,
        projectWorkerMap: [],
      };

      const result = await activity.fetchAndZipLogs({ traceId, payload: emptyMapPayload });
      expect(result).toStrictEqual({
        success: false,
        message: 'No matching log files found for the specified criteria (2024-01-01 to 2024-01-03) with provided project-worker mapping'
      });
    });

    it('should return error when no date folders exist', async () => {
      mockFs.existsSync.mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr === baseLogPath) return true;
        if (pathStr === outputZipPath) return true;
        // No date folders exist
        return false;
      });

      const result = await activity.fetchAndZipLogs({ traceId, payload: mockPayload });
      expect(result).toStrictEqual({
        success: false,
        message: 'No date folders found in the specified range (2024-01-01 to 2024-01-03) at path: /test/logs'
      });
    });

    it('should return error when no matching log files found', async () => {
      mockFs.existsSync.mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr === baseLogPath) return true;
        if (pathStr === outputZipPath) return true;
        if (pathStr.includes('2024-01-01') || pathStr.includes('2024-01-02') || pathStr.includes('2024-01-03')) return true;
        // No project folders exist - this will cause no files to be found
        return false;
      });

      // Mock exec to return empty result when no files are found
      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(null, '', ''); // Empty stdout means no files found
        }, 0);
        return {} as any;
      });

      const result = await activity.fetchAndZipLogs({ traceId, payload: mockPayload });
      expect(result).toStrictEqual({
        success: false,
        message: 'No matching log files found for the specified criteria (2024-01-01 to 2024-01-03) with provided project-worker mapping'
      });
    });

    it('should handle archiver error', async () => {
      mockFs.existsSync.mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr === baseLogPath) return true;
        if (pathStr === outputZipPath) return true;
        if (pathStr.includes('2024-01-01') || pathStr.includes('2024-01-02') || pathStr.includes('2024-01-03')) return true;
        if (pathStr.includes('project-1') || pathStr.includes('project-2')) return true;
        if (pathStr.includes('control_plane') || pathStr.includes('worker')) return true;
        return false;
      });

      const mockOutput = {
        on: jest.fn(),
      };
      const mockArchive = {
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('Archiver failed')), 0);
          }
        }),
        pipe: jest.fn(),
        file: jest.fn(),
        finalize: jest.fn().mockReturnValue({
          catch: jest.fn(),
        }),
        pointer: jest.fn().mockReturnValue(1024),
      };

      mockFs.createWriteStream.mockReturnValue(mockOutput as any);
      mockArchiver.mockReturnValue(mockArchive as any);

      // Mock the exec function to return test files
      mockExec.mockImplementation((cmd, callback) => {
        callback(null, '/test/logs/2024-01-01/project-1/control_plane/test1.log\n', '');
      });

      const result = await activity.fetchAndZipLogs({ traceId, payload: mockPayload });
      expect(result).toStrictEqual({
        success: false,
        message: 'Failed to create zip archive: Archiver failed'
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[trace-123] Archiving error:',
        expect.any(Error),
      );
    });

    it('should handle special characters in userId', async () => {
      const specialUserPayload = {
        ...mockPayload,
        userId: 'test@user-123_special.chars',
      };

      mockFs.existsSync.mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr === baseLogPath) return true;
        if (pathStr === outputZipPath) return true;
        if (pathStr.includes('2024-01-01') || pathStr.includes('2024-01-02') || pathStr.includes('2024-01-03')) return true;
        if (pathStr.includes('project-1') || pathStr.includes('project-2')) return true;
        if (pathStr.includes('control_plane') || pathStr.includes('worker')) return true;
        return false;
      });

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      // Mock the exec function to return test files
      mockExec.mockImplementation((cmd, callback) => {
        callback(null, '/test/logs/2024-01-01/project-1/control_plane/test1.log\n', '');
      });

      const result = await activity.fetchAndZipLogs({
        traceId,
        payload: specialUserPayload,
      });

      expect(result).toStrictEqual({
        success: true,
        message: path.join(outputZipPath, 'ndm_logs_test@user-123_special.chars.zip')
      });
    });

    it('should handle base log path not existing', async () => {
      mockFs.existsSync.mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr === baseLogPath) return false; // Base log path doesn't exist
        return true;
      });

      const result = await activity.fetchAndZipLogs({ traceId, payload: mockPayload });
      expect(result).toStrictEqual({
        success: false,
        message: 'Base log path does not exist: /test/logs'
      });
    });

    it('should log error when general error occurs', async () => {
      const error = new Error('General processing error');
      // Mock createWriteStream to throw an error during execution
      mockFs.createWriteStream.mockImplementation(() => {
        throw error;
      });

      mockFs.existsSync.mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr === baseLogPath) return true;
        if (pathStr === outputZipPath) return true;
        if (pathStr.includes('2024-01-01') || pathStr.includes('2024-01-02') || pathStr.includes('2024-01-03')) return true;
        if (pathStr.includes('project-1') || pathStr.includes('project-2')) return true;
        if (pathStr.includes('control_plane') || pathStr.includes('worker')) return true;
        return false;
      });

      // Mock the exec function to return test files
      mockExec.mockImplementation((cmd, callback) => {
        callback(null, '/test/logs/2024-01-01/project-1/control_plane/test1.log\n', '');
      });

      const result = await activity.fetchAndZipLogs({ traceId, payload: mockPayload });
      expect(result).toStrictEqual({
        success: false,
        message: 'General processing error'
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[trace-123] Error in fetchAndZipLogs:',
        'General processing error',
      );
    });
  });

  describe('Date range generation', () => {
    beforeEach(() => {
      // Reset only specific mocks, but keep the config service setup
      mockFs.existsSync.mockClear();
      mockFs.mkdirSync.mockClear();
      mockFs.unlinkSync.mockClear();
      mockFs.createWriteStream.mockClear();
      mockArchiver.mockClear();
      mockExec.mockClear();
      mockLogger.log.mockClear();
      mockLogger.error.mockClear();

      // Mock fs methods - ensure base log path exists for these tests
      mockFs.existsSync.mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr === baseLogPath) return true; // Base log path exists
        if (pathStr === outputZipPath) return false; // Output path doesn't exist
        if (pathStr.includes('2024-02') || pathStr.includes('2024-03')) return true;
        if (pathStr.includes('2024-01') || pathStr.includes('2023-12')) return true;
        if (pathStr.includes('project-1')) return true;
        if (pathStr.includes('control_plane') || pathStr.includes('worker')) return true;
        return false;
      });
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.unlinkSync.mockReturnValue(undefined);
      mockFs.createWriteStream.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      } as any);

      // Mock archiver
      const mockArchive = {
        on: jest.fn(),
        pipe: jest.fn(),
        file: jest.fn(),
        finalize: jest.fn().mockResolvedValue(undefined),
        pointer: jest.fn().mockReturnValue(1024),
      };
      mockArchiver.mockReturnValue(mockArchive as any);

      // Mock exec
      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(
            null,
            '/test/logs/2024-01-01/project-1/control_plane/test1.log\n',
            '',
          );
        }, 0);
        return {} as any;
      });
    });

    it('should generate correct date range for leap year', async () => {
      const leapYearPayload = {
        userId: 'test-user',
        startDate: '2024-02-28',
        endDate: '2024-03-01',
        projectWorkerMap: [
          {
            projectId: 'project-1',
            workerIds: ['worker-1'],
          },
        ],
      };

      const result = await activity.fetchAndZipLogs({
        traceId: 'leap-year-test',
        payload: leapYearPayload,
      });

      expect(result.success).toBe(true);
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Processing date folders: 2024-02-28, 2024-02-29, 2024-03-01')
      );
    });

    it('should handle month boundary correctly', async () => {
      const monthBoundaryPayload = {
        userId: 'test-user',
        startDate: '2024-01-30',
        endDate: '2024-02-02',
        projectWorkerMap: [
          {
            projectId: 'project-1',
            workerIds: ['worker-1'],
          },
        ],
      };

      const result = await activity.fetchAndZipLogs({
        traceId: 'month-boundary-test',
        payload: monthBoundaryPayload,
      });

      expect(result.success).toBe(true);
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Processing date folders: 2024-01-30, 2024-01-31, 2024-02-01, 2024-02-02')
      );
    });

    it('should handle year boundary correctly', async () => {
      const yearBoundaryPayload = {
        userId: 'test-user',
        startDate: '2023-12-30',
        endDate: '2024-01-02',
        projectWorkerMap: [
          {
            projectId: 'project-1',
            workerIds: ['worker-1'],
          },
        ],
      };

      const result = await activity.fetchAndZipLogs({
        traceId: 'year-boundary-test',
        payload: yearBoundaryPayload,
      });

      expect(result.success).toBe(true);
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Processing date folders: 2023-12-30, 2023-12-31, 2024-01-01, 2024-01-02')
      );
    });
  });

  describe('Advanced Error Handling and Edge Cases', () => {
    beforeEach(() => {
      // Reset mocks
      mockFs.existsSync.mockClear();
      mockFs.mkdirSync.mockClear();
      mockFs.unlinkSync.mockClear();
      mockFs.createWriteStream.mockClear();
      mockArchiver.mockClear();
      mockExec.mockClear();
      mockLogger.log.mockClear();
      mockLogger.error.mockClear();
    });

    it('should handle missing payload gracefully', async () => {
      const result = await activity.fetchAndZipLogs({ traceId: 'test', payload: null });
      expect(result).toStrictEqual({
        success: false,
        message: 'Missing required payload fields: startDate, endDate, or userId'
      });
    });

    it('should handle undefined payload gracefully', async () => {
      const result = await activity.fetchAndZipLogs({ traceId: 'test', payload: undefined });
      expect(result).toStrictEqual({
        success: false,
        message: 'Missing required payload fields: startDate, endDate, or userId'
      });
    });

    it('should handle payload with missing userId', async () => {
      const payloadWithoutUserId = {
        startDate: '2024-01-01',
        endDate: '2024-01-01',
        projectWorkerMap: [
          {
            projectId: 'project-1',
            workerIds: ['worker-1'],
          },
        ],
      };

      const result = await activity.fetchAndZipLogs({
        traceId: 'test',
        payload: payloadWithoutUserId,
      });
      expect(result).toStrictEqual({
        success: false,
        message: 'Missing required payload fields: startDate, endDate, or userId'
      });
    });

    it('should handle mkdirSync errors', async () => {
      const mockPayload = {
        userId: 'test-user',
        startDate: '2024-01-01',
        endDate: '2024-01-01',
        projectWorkerMap: [
          {
            projectId: 'project-1',
            workerIds: ['worker-1'],
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = await activity.fetchAndZipLogs({ traceId: 'test', payload: mockPayload });
      expect(result).toStrictEqual({
        success: false,
        message: 'Permission denied'
      });
    });

    it('should handle unlinkSync errors', async () => {
      const mockPayload = {
        userId: 'test-user',
        startDate: '2024-01-01',
        endDate: '2024-01-01',
        projectWorkerMap: [
          {
            projectId: 'project-1',
            workerIds: ['worker-1'],
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockImplementation(() => {
        throw new Error('File is locked');
      });

      const result = await activity.fetchAndZipLogs({ traceId: 'test', payload: mockPayload });
      expect(result).toStrictEqual({
        success: false,
        message: 'File is locked'
      });
    });

    it('should handle missing projectWorkerMap', async () => {
      const mockPayload = {
        userId: 'test-user',
        startDate: '2024-01-01',
        endDate: '2024-01-01',
      };

      const result = await activity.fetchAndZipLogs({ traceId: 'test', payload: mockPayload });
      expect(result).toStrictEqual({
        success: false,
        message: 'Missing or invalid projectWorkerMap in payload. Expected an array.'
      });
    });

    it('should handle invalid projectWorkerMap', async () => {
      const mockPayload = {
        userId: 'test-user',
        startDate: '2024-01-01',
        endDate: '2024-01-01',
        projectWorkerMap: 'invalid'
      };

      const result = await activity.fetchAndZipLogs({ traceId: 'test', payload: mockPayload });
      expect(result).toStrictEqual({
        success: false,
        message: 'Missing or invalid projectWorkerMap in payload. Expected an array.'
      });
    });

    it('should handle findFilesInDirectory error gracefully', async () => {
      const mockPayload = {
        userId: 'test-user',
        startDate: '2024-01-01',
        endDate: '2024-01-01',
        projectWorkerMap: [
          {
            projectId: 'project-1',
            workerIds: ['worker-1'],
          },
        ],
      };

      mockFs.existsSync.mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr === baseLogPath) return true;
        if (pathStr === outputZipPath) return true;
        if (pathStr.includes('2024-01-01')) return true;
        if (pathStr.includes('project-1')) return true;
        if (pathStr.includes('control_plane') || pathStr.includes('worker')) return true;
        return false;
      });

      // Mock exec to fail with error
      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(new Error('Find command failed'), '', 'Find command failed');
        }, 0);
        return {} as any;
      });

      const result = await activity.fetchAndZipLogs({ traceId: 'test', payload: mockPayload });
      expect(result).toStrictEqual({
        success: false,
        message: 'No matching log files found for the specified criteria (2024-01-01 to 2024-01-01) with provided project-worker mapping'
      });
    });

    it('should handle finalize error', async () => {
      const mockPayload = {
        userId: 'test-user',
        startDate: '2024-01-01',
        endDate: '2024-01-01',
        projectWorkerMap: [
          {
            projectId: 'project-1',
            workerIds: ['worker-1'],
          },
        ],
      };

      mockFs.existsSync.mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr === baseLogPath) return true;
        if (pathStr === outputZipPath) return true;
        if (pathStr.includes('2024-01-01')) return true;
        if (pathStr.includes('project-1')) return true;
        if (pathStr.includes('control_plane') || pathStr.includes('worker')) return true;
        return false;
      });

      const mockOutput = {
        on: jest.fn(),
      };

      const mockArchive = {
        on: jest.fn(),
        pipe: jest.fn(),
        file: jest.fn(),
        finalize: jest.fn().mockRejectedValue(new Error('Finalize failed')),
        pointer: jest.fn().mockReturnValue(1024),
      };

      mockFs.createWriteStream.mockReturnValue(mockOutput as any);
      mockArchiver.mockReturnValue(mockArchive as any);

      // Mock the exec function to return test files
      mockExec.mockImplementation((cmd, callback) => {
        callback(null, '/test/logs/2024-01-01/project-1/control_plane/test1.log\n', '');
      });

      const result = await activity.fetchAndZipLogs({ traceId: 'test', payload: mockPayload });
      expect(result).toStrictEqual({
        success: false,
        message: 'Failed to finalize zip archive: Finalize failed'
      });
    });
  });
});
