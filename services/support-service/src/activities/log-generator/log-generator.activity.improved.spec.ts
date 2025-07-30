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

// Create a simple mock for the exec function
const mockExecFunction = jest.fn();
jest.mock('util', () => ({
  ...jest.requireActual('util'),
  promisify: () => mockExecFunction,
}));

describe('LogGeneratorActivity', () => {
  let activity: LogGeneratorActivity;
  let configService: ConfigService;
  let mockLogger: Logger;

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
    configService = module.get<ConfigService>(ConfigService);

    // Mock logger
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      fatal: jest.fn(),
      setContext: jest.fn(),
      localInstance: {} as any,
    } as jest.Mocked<Logger>;
    (activity as any).logger = mockLogger;

    // Reset all mocks
    jest.clearAllMocks();

    // Setup fs mocks
    (mockFs.existsSync as any) = jest.fn().mockReturnValue(false);
    (mockFs.mkdirSync as any) = jest.fn().mockReturnValue(undefined);
    (mockFs.unlinkSync as any) = jest.fn().mockReturnValue(undefined);
    (mockFs.createWriteStream as any) = jest.fn().mockReturnValue({
      on: jest.fn(),
    });

    // Setup archiver mock
    const mockArchive = {
      on: jest.fn(),
      pipe: jest.fn(),
      directory: jest.fn(),
      finalize: jest.fn(),
    };
    mockArchiver.mockReturnValue(mockArchive as any);

    // Setup exec mock
    mockExecFunction.mockResolvedValue({
      stdout: '/test/logs/2024-01-01/project-1\\n/test/logs/2024-01-01/project-2\\n',
      stderr: '',
    });
  });

  describe('Constructor', () => {
    it('should initialize with valid configuration', () => {
      expect(activity).toBeDefined();
    });

    it('should throw error when baseLogPath is missing', () => {
      const badConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'support-bundle.bundle.outputZipPath') return outputZipPath;
          return undefined;
        }),
      };

      expect(() => {
        new LogGeneratorActivity(badConfigService as any);
      }).toThrow('Missing required configuration for baseLogPath or outputZipPath');
    });

    it('should throw error when outputZipPath is missing', () => {
      const badConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'support-bundle.bundle.baseLogPath') return baseLogPath;
          return undefined;
        }),
      };

      expect(() => {
        new LogGeneratorActivity(badConfigService as any);
      }).toThrow('Missing required configuration for baseLogPath or outputZipPath');
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
          workerIds: ['worker-1', 'worker-2'],
        },
        {
          projectId: 'project-2',
          workerIds: ['worker-3'],
        },
      ],
    };

    const traceId = 'trace-123';

    it('should successfully create zip when everything is valid', async () => {
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
        directory: jest.fn(),
        finalize: jest.fn(),
      };

      (mockFs.createWriteStream as any) = jest.fn().mockReturnValue(mockOutput);
      mockArchiver.mockReturnValue(mockArchive as any);

      const result = await activity.fetchAndZipLogs({
        traceId,
        payload: mockPayload,
      });

      expect(result).toBe(path.join(outputZipPath, 'ndm_test-user-123.zip'));
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[trace-123] Started fetchAndZipLogsUsingFind activity',
      );
    });

    it('should remove existing zip file if it exists', async () => {
      (mockFs.existsSync as any) = jest.fn().mockReturnValue(true);

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(), 0);
          }
        }),
      };
      (mockFs.createWriteStream as any) = jest.fn().mockReturnValue(mockOutput);

      await activity.fetchAndZipLogs({ traceId, payload: mockPayload });

      expect(mockFs.unlinkSync).toHaveBeenCalledWith(
        '/test/output/ndm_test-user-123.zip',
      );
    });

    it('should create output directory if it does not exist', async () => {
      (mockFs.existsSync as any) = jest.fn().mockImplementation((filePath) => {
        if (filePath === outputZipPath) return false;
        return false;
      });

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(), 0);
          }
        }),
      };
      (mockFs.createWriteStream as any) = jest.fn().mockReturnValue(mockOutput);

      await activity.fetchAndZipLogs({ traceId, payload: mockPayload });

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(outputZipPath, {
        recursive: true,
      });
    });

    it('should throw error for invalid start date', async () => {
      const invalidPayload = {
        ...mockPayload,
        startDate: 'invalid-date',
      };

      await expect(
        activity.fetchAndZipLogs({ traceId, payload: invalidPayload }),
      ).rejects.toThrow('Invalid date range: invalid-date to 2024-01-03');
    });

    it('should throw error for invalid end date', async () => {
      const invalidPayload = {
        ...mockPayload,
        endDate: 'invalid-date',
      };

      await expect(
        activity.fetchAndZipLogs({ traceId, payload: invalidPayload }),
      ).rejects.toThrow('Invalid date range: 2024-01-01 to invalid-date');
    });

    it('should throw error when start date is after end date', async () => {
      const invalidPayload = {
        ...mockPayload,
        startDate: '2024-01-05',
        endDate: '2024-01-01',
      };

      await expect(
        activity.fetchAndZipLogs({ traceId, payload: invalidPayload }),
      ).rejects.toThrow('Invalid date range: 2024-01-05 to 2024-01-01');
    });

    it('should handle empty projectWorkerMap', async () => {
      const emptyMapPayload = {
        ...mockPayload,
        projectWorkerMap: [],
      };

      await expect(
        activity.fetchAndZipLogs({ traceId, payload: emptyMapPayload }),
      ).rejects.toThrow('No paths generated from inputs');
    });

    it('should handle single date range', async () => {
      const singleDatePayload = {
        ...mockPayload,
        startDate: '2024-01-01',
        endDate: '2024-01-01',
      };

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(), 0);
          }
        }),
      };
      (mockFs.createWriteStream as any) = jest.fn().mockReturnValue(mockOutput);

      await activity.fetchAndZipLogs({ traceId, payload: singleDatePayload });

      expect(mockExecFunction).toHaveBeenCalled();
      const execCall = mockExecFunction.mock.calls[0][0] as string;
      expect(execCall).toContain('2024-01-01');
      expect(execCall).not.toContain('2024-01-02');
    });

    it('should generate correct path expressions for projects and workers', async () => {
      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(), 0);
          }
        }),
      };
      (mockFs.createWriteStream as any) = jest.fn().mockReturnValue(mockOutput);

      await activity.fetchAndZipLogs({ traceId, payload: mockPayload });

      const execCall = mockExecFunction.mock.calls[0][0] as string;
      expect(execCall).toContain('-path "/test/logs/2024-01-01/project-1"');
      expect(execCall).toContain('-path "/test/logs/2024-01-01/project-2"');
      expect(execCall).toContain('-path "/test/logs/2024-01-01/worker/worker-1"');
      expect(execCall).toContain('-path "/test/logs/2024-01-01/worker/worker-2"');
      expect(execCall).toContain('-path "/test/logs/2024-01-01/worker/worker-3"');
    });

    it('should throw error when find command fails', async () => {
      mockExecFunction.mockRejectedValue({
        stderr: 'Find command failed',
        message: 'Command execution failed',
      });

      await expect(
        activity.fetchAndZipLogs({ traceId, payload: mockPayload }),
      ).rejects.toThrow('Failed to execute find command');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error executing find:',
        'Find command failed',
      );
    });

    it('should throw error when no matching directories found', async () => {
      mockExecFunction.mockResolvedValue({ stdout: '', stderr: '' });

      await expect(
        activity.fetchAndZipLogs({ traceId, payload: mockPayload }),
      ).rejects.toThrow(
        'No matching directories found in the given date range.',
      );
    });

    it('should handle archiver error', async () => {
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
        directory: jest.fn(),
        finalize: jest.fn(),
      };

      (mockFs.createWriteStream as any) = jest.fn().mockReturnValue(mockOutput);
      mockArchiver.mockReturnValue(mockArchive as any);

      await expect(
        activity.fetchAndZipLogs({ traceId, payload: mockPayload }),
      ).rejects.toThrow('Archiver failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[trace-123] Archiving error:',
        expect.any(Error),
      );
    });

    it('should handle multiple date ranges correctly', async () => {
      const multiDatePayload = {
        ...mockPayload,
        startDate: '2024-01-01',
        endDate: '2024-01-05',
      };

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(), 0);
          }
        }),
      };
      (mockFs.createWriteStream as any) = jest.fn().mockReturnValue(mockOutput);

      await activity.fetchAndZipLogs({ traceId, payload: multiDatePayload });

      const execCall = mockExecFunction.mock.calls[0][0] as string;
      expect(execCall).toContain('2024-01-01');
      expect(execCall).toContain('2024-01-02');
      expect(execCall).toContain('2024-01-03');
      expect(execCall).toContain('2024-01-04');
      expect(execCall).toContain('2024-01-05');
    });

    it('should handle exec error with message only', async () => {
      mockExecFunction.mockRejectedValue({ message: 'Command not found' });

      await expect(
        activity.fetchAndZipLogs({ traceId, payload: mockPayload }),
      ).rejects.toThrow('Failed to execute find command');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error executing find:',
        'Command not found',
      );
    });

    it('should filter out empty stdout lines', async () => {
      mockExecFunction.mockResolvedValue({
        stdout: '/test/logs/2024-01-01/project-1\\n\\n/test/logs/2024-01-01/project-2\\n\\n',
        stderr: '',
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
        directory: jest.fn(),
        finalize: jest.fn(),
      };

      (mockFs.createWriteStream as any) = jest.fn().mockReturnValue(mockOutput);
      mockArchiver.mockReturnValue(mockArchive as any);

      await activity.fetchAndZipLogs({ traceId, payload: mockPayload });

      expect(mockArchive.directory).toHaveBeenCalledTimes(2);
    });

    it('should log error and rethrow when general error occurs', async () => {
      const error = new Error('General processing error');
      (mockFs.createWriteStream as any) = jest.fn().mockImplementation(() => {
        throw error;
      });

      await expect(
        activity.fetchAndZipLogs({ traceId, payload: mockPayload }),
      ).rejects.toThrow('General processing error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[trace-123] Error in fetchAndZipLogsUsingFind:',
        'General processing error',
      );
    });

    it('should handle missing userId gracefully', async () => {
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

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(), 0);
          }
        }),
      };
      (mockFs.createWriteStream as any) = jest.fn().mockReturnValue(mockOutput);

      const result = await activity.fetchAndZipLogs({
        traceId: 'test',
        payload: payloadWithoutUserId,
      });
      expect(result).toContain('ndm_undefined.zip');
    });

    it('should properly use relative paths in archive', async () => {
      mockExecFunction.mockResolvedValue({
        stdout: '/test/logs/2024-01-01/project-1\\n/test/logs/2024-01-02/project-2\\n',
        stderr: '',
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
        directory: jest.fn(),
        finalize: jest.fn(),
      };

      (mockFs.createWriteStream as any) = jest.fn().mockReturnValue(mockOutput);
      mockArchiver.mockReturnValue(mockArchive as any);

      await activity.fetchAndZipLogs({ traceId, payload: mockPayload });

      expect(mockArchive.directory).toHaveBeenCalledWith(
        '/test/logs/2024-01-01/project-1',
        'ndm_logs/2024-01-01/project-1'
      );
      expect(mockArchive.directory).toHaveBeenCalledWith(
        '/test/logs/2024-01-02/project-2', 
        'ndm_logs/2024-01-02/project-2'
      );
    });

    it('should handle projectWorkerMap with missing workerIds', async () => {
      const noWorkersPayload = {
        ...mockPayload,
        projectWorkerMap: [
          {
            projectId: 'project-1',
          },
        ],
      };

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(), 0);
          }
        }),
      };
      (mockFs.createWriteStream as any) = jest.fn().mockReturnValue(mockOutput);

      await activity.fetchAndZipLogs({ traceId, payload: noWorkersPayload });

      const execCall = mockExecFunction.mock.calls[0][0] as string;
      expect(execCall).toContain('-path "/test/logs/2024-01-01/project-1"');
      expect(execCall).not.toContain('worker');
    });

    it('should handle duplicate project paths in implementation', async () => {
      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(), 0);
          }
        }),
      };
      (mockFs.createWriteStream as any) = jest.fn().mockReturnValue(mockOutput);

      await activity.fetchAndZipLogs({ traceId, payload: mockPayload });

      const execCall = mockExecFunction.mock.calls[0][0] as string;
      // The implementation has duplicate project paths due to control plane logic
      const projectPathCount = (execCall.match(/project-1/g) || []).length;
      expect(projectPathCount).toBeGreaterThan(1);
    });
  });
});
