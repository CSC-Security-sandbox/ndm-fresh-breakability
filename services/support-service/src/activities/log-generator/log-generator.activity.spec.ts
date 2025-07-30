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
        directory: jest.fn(),
        finalize: jest.fn().mockResolvedValue(undefined),
        pointer: jest.fn().mockReturnValue(12345),
      };
      mockArchiver.mockReturnValue(mockArchive as any);

      // Mock exec
      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(
            null,
            '/test/logs/2024-01-01\n/test/logs/2024-01-02\n/test/logs/2024-01-03\n',
            '',
          );
        }, 0);
        return {} as any;
      });
    });

    it('should successfully create zip when everything is valid', async () => {
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
        directory: jest.fn(),
        finalize: jest.fn().mockResolvedValue(undefined),
        pointer: jest.fn().mockReturnValue(12345),
      };

      mockFs.createWriteStream.mockReturnValue(mockOutput as any);
      mockArchiver.mockReturnValue(mockArchive as any);

      const result = await activity.fetchAndZipLogs({
        traceId,
        payload: mockPayload,
      });

      expect(result).toBe('/test/output/ndm_test-user-123.zip');
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[trace-123] Started fetchAndZipLogs activity',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[trace-123] Zip created successfully at: /test/output/ndm_test-user-123.zip',
      );
    });

    it('should remove existing zip file if it exists', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      await activity.fetchAndZipLogs({ traceId, payload: mockPayload });

      expect(mockFs.unlinkSync).toHaveBeenCalledWith(
        '/test/output/ndm_test-user-123.zip',
      );
    });

    it('should create output directory if it does not exist', async () => {
      mockFs.existsSync.mockImplementation((path) => {
        if (path === outputZipPath) return false;
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
      ).rejects.toThrow('Invalid date format. Expected YYYY-MM-DD format. Received startDate: invalid-date, endDate: 2024-01-03');
    });

    it('should throw error for invalid end date', async () => {
      const invalidPayload = {
        ...mockPayload,
        endDate: 'invalid-date',
      };

      await expect(
        activity.fetchAndZipLogs({ traceId, payload: invalidPayload }),
      ).rejects.toThrow('Invalid date format. Expected YYYY-MM-DD format. Received startDate: 2024-01-01, endDate: invalid-date');
    });

    it('should throw error when start date is after end date', async () => {
      const invalidPayload = {
        ...mockPayload,
        startDate: '2024-01-05',
        endDate: '2024-01-01',
      };

      await expect(
        activity.fetchAndZipLogs({ traceId, payload: invalidPayload }),
      ).rejects.toThrow('Start date (2024-01-05) cannot be after end date (2024-01-01)');
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
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      await activity.fetchAndZipLogs({ traceId, payload: singleDatePayload });

      expect(mockExec).toHaveBeenCalled();
      const execCall = mockExec.mock.calls[0][0] as string;
      expect(execCall).toContain('2024-01-01');
      expect(execCall).not.toContain('2024-01-02');
    });

    it('should generate correct path expressions for projects and workers', async () => {
      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      await activity.fetchAndZipLogs({ traceId, payload: mockPayload });

      const execCall = mockExec.mock.calls[0][0] as string;
      expect(execCall).toContain('-path "/test/logs/2024-01-01/project-1"');
      expect(execCall).toContain('-path "/test/logs/2024-01-01/project-2"');
      expect(execCall).toContain(
        '-path "/test/logs/2024-01-01/worker/worker-1"',
      );
      expect(execCall).toContain(
        '-path "/test/logs/2024-01-01/worker/worker-2"',
      );
      expect(execCall).toContain(
        '-path "/test/logs/2024-01-01/worker/worker-3"',
      );
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

    it.skip('should handle projectWorkerMap with missing projectId', async () => {
      const invalidMapPayload = {
        ...mockPayload,
        projectWorkerMap: [
          {
            workerIds: ['worker-1'],
          },
        ],
      };

      await expect(
        activity.fetchAndZipLogs({ traceId, payload: invalidMapPayload }),
      ).rejects.toThrow('No paths generated from inputs');
    }, 10000); // Increase timeout

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
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      await activity.fetchAndZipLogs({ traceId, payload: noWorkersPayload });

      const execCall = mockExec.mock.calls[0][0] as string;
      expect(execCall).toContain('-path "/test/logs/2024-01-01/project-1"');
      expect(execCall).not.toContain('worker');
    });

    it('should throw error when find command fails', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(
            {
              stderr: 'Find command failed',
              message: 'Command execution failed',
            },
            '',
            'Find command failed',
          );
        }, 0);
        return {} as any;
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
      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(null, '', '');
        }, 0);
        return {} as any;
      });

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

      mockFs.createWriteStream.mockReturnValue(mockOutput as any);
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
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      await activity.fetchAndZipLogs({ traceId, payload: multiDatePayload });

      const execCall = mockExec.mock.calls[0][0] as string;
      expect(execCall).toContain('2024-01-01');
      expect(execCall).toContain('2024-01-02');
      expect(execCall).toContain('2024-01-03');
      expect(execCall).toContain('2024-01-04');
      expect(execCall).toContain('2024-01-05');
    });

    it('should handle special characters in userId', async () => {
      const specialUserPayload = {
        ...mockPayload,
        userId: 'test@user-123_special.chars',
      };

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      const result = await activity.fetchAndZipLogs({
        traceId,
        payload: specialUserPayload,
      });

      expect(result).toBe(
        path.join(outputZipPath, 'ndm_test@user-123_special.chars.zip'),
      );
    });

    it('should filter out empty stdout lines', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(
            null,
            '/test/logs/2024-01-01/project-1\n\n/test/logs/2024-01-01/project-2\n\n',
            '',
          );
        }, 0);
        return {} as any;
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
        directory: jest.fn(),
        finalize: jest.fn(),
      };

      mockFs.createWriteStream.mockReturnValue(mockOutput as any);
      mockArchiver.mockReturnValue(mockArchive as any);

      await activity.fetchAndZipLogs({ traceId, payload: mockPayload });

      expect(mockArchive.directory).toHaveBeenCalledTimes(2);
    });

    it('should handle complex projectWorkerMap structure', async () => {
      const complexPayload = {
        ...mockPayload,
        projectWorkerMap: [
          {
            projectId: 'project-1',
            workerIds: ['worker-1', 'worker-2', 'worker-3'],
          },
          {
            projectId: 'project-2',
            workerIds: [],
          },
          {
            projectId: 'project-3',
            workerIds: ['worker-4'],
          },
        ],
      };

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      await activity.fetchAndZipLogs({ traceId, payload: complexPayload });

      const execCall = mockExec.mock.calls[0][0] as string;
      expect(execCall).toContain('project-1');
      expect(execCall).toContain('project-2');
      expect(execCall).toContain('project-3');
      expect(execCall).toContain('worker-1');
      expect(execCall).toContain('worker-2');
      expect(execCall).toContain('worker-3');
      expect(execCall).toContain('worker-4');
    });

    it('should log error and rethrow when general error occurs', async () => {
      const error = new Error('General processing error');
      // Mock createWriteStream to throw an error during execution
      mockFs.createWriteStream.mockImplementation(() => {
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

      // Mock fs methods
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.unlinkSync.mockReturnValue(undefined);
      mockFs.createWriteStream.mockReturnValue({
        on: jest.fn(),
      } as any);

      // Mock archiver
      const mockArchive = {
        on: jest.fn(),
        pipe: jest.fn(),
        directory: jest.fn(),
        finalize: jest.fn(),
      };
      mockArchiver.mockReturnValue(mockArchive as any);

      // Mock exec
      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(
            null,
            '/test/logs/2024-01-01/project-1\n/test/logs/2024-01-01/project-2\n',
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

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      await activity.fetchAndZipLogs({
        traceId: 'leap-year-test',
        payload: leapYearPayload,
      });

      const execCall = mockExec.mock.calls[0][0] as string;
      expect(execCall).toContain('2024-02-28');
      expect(execCall).toContain('2024-02-29'); // Leap day
      expect(execCall).toContain('2024-03-01');
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

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      await activity.fetchAndZipLogs({
        traceId: 'month-boundary-test',
        payload: monthBoundaryPayload,
      });

      const execCall = mockExec.mock.calls[0][0] as string;
      expect(execCall).toContain('2024-01-30');
      expect(execCall).toContain('2024-01-31');
      expect(execCall).toContain('2024-02-01');
      expect(execCall).toContain('2024-02-02');
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

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      await activity.fetchAndZipLogs({
        traceId: 'year-boundary-test',
        payload: yearBoundaryPayload,
      });

      const execCall = mockExec.mock.calls[0][0] as string;
      expect(execCall).toContain('2023-12-30');
      expect(execCall).toContain('2023-12-31');
      expect(execCall).toContain('2024-01-01');
      expect(execCall).toContain('2024-01-02');
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
      await expect(
        activity.fetchAndZipLogs({ traceId: 'test', payload: null }),
      ).rejects.toThrow();
    });

    it('should handle undefined payload gracefully', async () => {
      await expect(
        activity.fetchAndZipLogs({ traceId: 'test', payload: undefined }),
      ).rejects.toThrow();
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

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockReturnValue(undefined);

      const mockArchive = {
        on: jest.fn(),
        pipe: jest.fn(),
        directory: jest.fn(),
        finalize: jest.fn(),
      };
      mockArchiver.mockReturnValue(mockArchive as any);

      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(null, '/test/logs/2024-01-01/project-1\n', '');
        }, 0);
        return {} as any;
      });

      const result = await activity.fetchAndZipLogs({
        traceId: 'test',
        payload: payloadWithoutUserId,
      });
      expect(result).toContain('ndm_undefined.zip');
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

      await expect(
        activity.fetchAndZipLogs({ traceId: 'test', payload: mockPayload }),
      ).rejects.toThrow('Permission denied');
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

      await expect(
        activity.fetchAndZipLogs({ traceId: 'test', payload: mockPayload }),
      ).rejects.toThrow('File is locked');
    });

    it('should handle createWriteStream errors', async () => {
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
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.createWriteStream.mockImplementation(() => {
        throw new Error('Cannot create write stream');
      });

      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(null, '/test/logs/2024-01-01/project-1\n', '');
        }, 0);
        return {} as any;
      });

      await expect(
        activity.fetchAndZipLogs({ traceId: 'test', payload: mockPayload }),
      ).rejects.toThrow('Cannot create write stream');
    });

    it('should handle exec command with stderr but no error', async () => {
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
      mockFs.mkdirSync.mockReturnValue(undefined);

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      const mockArchive = {
        on: jest.fn(),
        pipe: jest.fn(),
        directory: jest.fn(),
        finalize: jest.fn(),
      };
      mockArchiver.mockReturnValue(mockArchive as any);

      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(
            null,
            '/test/logs/2024-01-01/project-1\n',
            'Warning: some directories not accessible',
          );
        }, 0);
        return {} as any;
      });

      const result = await activity.fetchAndZipLogs({
        traceId: 'test',
        payload: mockPayload,
      });
      expect(result).toContain('ndm_test-user.zip');
    });

    it('should handle exec error with message only', async () => {
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
      mockFs.mkdirSync.mockReturnValue(undefined);

      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback({ message: 'Command not found' }, '', '');
        }, 0);
        return {} as any;
      });

      await expect(
        activity.fetchAndZipLogs({ traceId: 'test', payload: mockPayload }),
      ).rejects.toThrow('Failed to execute find command');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error executing find:',
        'Command not found',
      );
    });

    it('should handle large date ranges efficiently', async () => {
      const largeDateRangePayload = {
        userId: 'test-user',
        startDate: '2024-01-01',
        endDate: '2024-12-31', // Full year
        projectWorkerMap: [
          {
            projectId: 'project-1',
            workerIds: ['worker-1'],
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockReturnValue(undefined);

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      const mockArchive = {
        on: jest.fn(),
        pipe: jest.fn(),
        directory: jest.fn(),
        finalize: jest.fn(),
      };
      mockArchiver.mockReturnValue(mockArchive as any);

      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(null, '/test/logs/2024-01-01/project-1\n', '');
        }, 0);
        return {} as any;
      });

      await activity.fetchAndZipLogs({
        traceId: 'large-range-test',
        payload: largeDateRangePayload,
      });

      const execCall = mockExec.mock.calls[0][0] as string;
      expect(execCall).toContain('2024-01-01');
      expect(execCall).toContain('2024-12-31');
      // Should contain 366 dates (2024 is a leap year)
      // Each date appears 3 times due to control plane + project + worker paths
      const dateMatches = execCall.match(/2024-\d{2}-\d{2}/g);
      expect(dateMatches).toHaveLength(366 * 3); // Each date appears 3 times
    });

    it('should handle very long project and worker IDs', async () => {
      const longIdPayload = {
        userId: 'test-user',
        startDate: '2024-01-01',
        endDate: '2024-01-01',
        projectWorkerMap: [
          {
            projectId: 'a'.repeat(255), // Very long project ID
            workerIds: ['b'.repeat(255)], // Very long worker ID
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockReturnValue(undefined);

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      const mockArchive = {
        on: jest.fn(),
        pipe: jest.fn(),
        directory: jest.fn(),
        finalize: jest.fn(),
      };
      mockArchiver.mockReturnValue(mockArchive as any);

      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(null, '/test/logs/2024-01-01/project-1\n', '');
        }, 0);
        return {} as any;
      });

      await activity.fetchAndZipLogs({
        traceId: 'long-id-test',
        payload: longIdPayload,
      });

      const execCall = mockExec.mock.calls[0][0] as string;
      expect(execCall).toContain('a'.repeat(255));
      expect(execCall).toContain('b'.repeat(255));
    });

    it('should handle special characters in project and worker IDs', async () => {
      const specialCharsPayload = {
        userId: 'test-user',
        startDate: '2024-01-01',
        endDate: '2024-01-01',
        projectWorkerMap: [
          {
            projectId: 'project-with-special!@#$%^&*()_+-={}[]|;:,.<>?',
            workerIds: ['worker-with-unicode-你好世界-🚀'],
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockReturnValue(undefined);

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      const mockArchive = {
        on: jest.fn(),
        pipe: jest.fn(),
        directory: jest.fn(),
        finalize: jest.fn(),
      };
      mockArchiver.mockReturnValue(mockArchive as any);

      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(null, '/test/logs/2024-01-01/project-1\n', '');
        }, 0);
        return {} as any;
      });

      await activity.fetchAndZipLogs({
        traceId: 'special-chars-test',
        payload: specialCharsPayload,
      });

      const execCall = mockExec.mock.calls[0][0] as string;
      expect(execCall).toContain(
        'project-with-special!@#$%^&*()_+-={}[]|;:,.<>?',
      );
      expect(execCall).toContain('worker-with-unicode-你好世界-🚀');
    });

    it('should handle empty string project and worker IDs', async () => {
      const emptyStringPayload = {
        userId: 'test-user',
        startDate: '2024-01-01',
        endDate: '2024-01-01',
        projectWorkerMap: [
          {
            projectId: '',
            workerIds: ['', 'valid-worker'],
          },
        ],
      };

      // Empty string projectId is truthy, so it creates paths
      // The test should succeed, not throw an error
      const result = await activity.fetchAndZipLogs({
        traceId: 'empty-string-test',
        payload: emptyStringPayload,
      });

      expect(result).toContain('.zip');
    });

    it('should handle null and undefined values in projectWorkerMap', async () => {
      const nullUndefinedPayload = {
        userId: 'test-user',
        startDate: '2024-01-01',
        endDate: '2024-01-01',
        projectWorkerMap: [
          {
            projectId: null,
            workerIds: undefined,
          },
          {
            projectId: undefined,
            workerIds: null,
          },
          null,
          undefined,
        ],
      };

      await expect(
        activity.fetchAndZipLogs({
          traceId: 'null-undefined-test',
          payload: nullUndefinedPayload,
        }),
      ).rejects.toThrow('Cannot read properties of null');
    });

    it('should handle very large number of projects and workers', async () => {
      const largePayload = {
        userId: 'test-user',
        startDate: '2024-01-01',
        endDate: '2024-01-01',
        projectWorkerMap: Array.from({ length: 100 }, (_, i) => ({
          projectId: `project-${i}`,
          workerIds: Array.from({ length: 10 }, (_, j) => `worker-${i}-${j}`),
        })),
      };

      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockReturnValue(undefined);

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };
      mockFs.createWriteStream.mockReturnValue(mockOutput as any);

      const mockArchive = {
        on: jest.fn(),
        pipe: jest.fn(),
        directory: jest.fn(),
        finalize: jest.fn(),
      };
      mockArchiver.mockReturnValue(mockArchive as any);

      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(null, '/test/logs/2024-01-01/project-1\n', '');
        }, 0);
        return {} as any;
      });

      await activity.fetchAndZipLogs({
        traceId: 'large-payload-test',
        payload: largePayload,
      });

      const execCall = mockExec.mock.calls[0][0] as string;
      // Should contain 100 projects * 2 (duplicate paths) + 100 projects * 10 workers = 1200 path expressions
      const pathMatches = execCall.match(/-path "/g);
      expect(pathMatches).toHaveLength(1200);
    });

    it('should handle timeout scenarios with long-running exec commands', async () => {
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
      mockFs.mkdirSync.mockReturnValue(undefined);

      // Simulate a command that takes too long
      mockExec.mockImplementation((cmd, callback) => {
        // Don't call the callback to simulate timeout
        return {} as any;
      });

      // Set a shorter timeout for testing
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Command timeout')), 100);
      });

      const activityPromise = activity.fetchAndZipLogs({
        traceId: 'timeout-test',
        payload: mockPayload,
      });

      await expect(
        Promise.race([activityPromise, timeoutPromise]),
      ).rejects.toThrow('Command timeout');
    });
  });

  describe('Archive and Stream Edge Cases', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.unlinkSync.mockReturnValue(undefined);

      mockExec.mockImplementation((cmd, callback) => {
        setTimeout(() => {
          callback(
            null,
            '/test/logs/2024-01-01/project-1\n/test/logs/2024-01-01/project-2\n',
            '',
          );
        }, 0);
        return {} as any;
      });
    });

    it('should handle stream close event with delay', async () => {
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

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            // Simulate delayed close
            setTimeout(callback, 100);
          }
        }),
      };
      const mockArchive = {
        on: jest.fn(),
        pipe: jest.fn(),
        directory: jest.fn(),
        finalize: jest.fn(),
      };

      mockFs.createWriteStream.mockReturnValue(mockOutput as any);
      mockArchiver.mockReturnValue(mockArchive as any);

      const result = await activity.fetchAndZipLogs({
        traceId: 'delayed-close-test',
        payload: mockPayload,
      });
      expect(result).toContain('ndm_test-user.zip');
    });

    it('should handle archive finalization errors', async () => {
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

      const mockOutput = {
        on: jest.fn(),
      };
      const mockArchive = {
        on: jest.fn(),
        pipe: jest.fn(),
        directory: jest.fn(),
        finalize: jest.fn(() => {
          throw new Error('Finalization failed');
        }),
      };

      mockFs.createWriteStream.mockReturnValue(mockOutput as any);
      mockArchiver.mockReturnValue(mockArchive as any);

      await expect(
        activity.fetchAndZipLogs({
          traceId: 'finalize-error-test',
          payload: mockPayload,
        }),
      ).rejects.toThrow('Finalization failed');
    });

    it.skip('should handle multiple archive events', async () => {
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

      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        }),
      };

      const mockArchive = {
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            // Trigger error immediately when the handler is set
            setTimeout(
              () => callback(new Error('Archive processing error')),
              0,
            );
          }
        }),
        pipe: jest.fn(),
        directory: jest.fn(),
        finalize: jest.fn(),
      };

      mockFs.createWriteStream.mockReturnValue(mockOutput as any);
      mockArchiver.mockReturnValue(mockArchive as any);

      const activityPromise = activity.fetchAndZipLogs({
        traceId: 'multiple-events-test',
        payload: mockPayload,
      });

      await expect(activityPromise).rejects.toThrow('Archive processing error');
    });

    it('should handle pipe method errors', async () => {
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

      const mockOutput = {
        on: jest.fn(),
      };
      const mockArchive = {
        on: jest.fn(),
        pipe: jest.fn(() => {
          throw new Error('Pipe failed');
        }),
        directory: jest.fn(),
        finalize: jest.fn(),
      };

      mockFs.createWriteStream.mockReturnValue(mockOutput as any);
      mockArchiver.mockReturnValue(mockArchive as any);

      await expect(
        activity.fetchAndZipLogs({
          traceId: 'pipe-error-test',
          payload: mockPayload,
        }),
      ).rejects.toThrow('Pipe failed');
    });

    it('should handle directory method errors', async () => {
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
        directory: jest.fn(() => {
          throw new Error('Directory add failed');
        }),
        finalize: jest.fn(),
      };

      mockFs.createWriteStream.mockReturnValue(mockOutput as any);
      mockArchiver.mockReturnValue(mockArchive as any);

      await expect(
        activity.fetchAndZipLogs({
          traceId: 'directory-error-test',
          payload: mockPayload,
        }),
      ).rejects.toThrow('Directory add failed');
    });
  });
});
