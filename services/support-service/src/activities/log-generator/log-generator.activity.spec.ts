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
    exec: (cmd: string, callback: (error: any, stdout: string, stderr: string) => void) => {
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
            get: jest.fn(),
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
            expect(configService.get).toHaveBeenCalledWith('support-bundle.bundle.baseLogPath');
            expect(configService.get).toHaveBeenCalledWith('support-bundle.bundle.outputZipPath');
        });

        it('should throw error when baseLogPath is missing', () => {
            configService.get.mockImplementation((key: string) => {
                if (key === 'support-bundle.bundle.baseLogPath') return undefined;
                if (key === 'support-bundle.bundle.outputZipPath') return outputZipPath;
                return undefined;
            });

            expect(() => {
                new LogGeneratorActivity(configService);
            }).toThrow('Missing required configuration for baseLogPath or outputZipPath');
        });

        it('should throw error when outputZipPath is missing', () => {
            configService.get.mockImplementation((key: string) => {
                if (key === 'support-bundle.bundle.baseLogPath') return baseLogPath;
                if (key === 'support-bundle.bundle.outputZipPath') return undefined;
                return undefined;
            });

            expect(() => {
                new LogGeneratorActivity(configService);
            }).toThrow('Missing required configuration for baseLogPath or outputZipPath');
        });

        it('should throw error when both configurations are missing', () => {
            configService.get.mockReturnValue(undefined);

            expect(() => {
                new LogGeneratorActivity(configService);
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

        beforeEach(() => {
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
                    callback(null, '/test/logs/2024-01-01/project-1\n/test/logs/2024-01-01/project-2\n', '');
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
                finalize: jest.fn(),
            };

            mockFs.createWriteStream.mockReturnValue(mockOutput as any);
            mockArchiver.mockReturnValue(mockArchive as any);

            const result = await activity.fetchAndZipLogs({ traceId, payload: mockPayload });

            expect(result).toBe(path.join(outputZipPath, 'ndm_test-user-123.zip'));
            expect(mockLogger.log).toHaveBeenCalledWith('[trace-123] Started fetchAndZipLogsUsingFind activity');
            expect(mockLogger.log).toHaveBeenCalledWith('[trace-123] Zip created at: /test/output/ndm_test-user-123.zip');
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

            expect(mockFs.unlinkSync).toHaveBeenCalledWith('/test/output/ndm_test-user-123.zip');
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

            expect(mockFs.mkdirSync).toHaveBeenCalledWith(outputZipPath, { recursive: true });
        });

        it('should throw error for invalid start date', async () => {
            const invalidPayload = {
                ...mockPayload,
                startDate: 'invalid-date',
            };

            await expect(activity.fetchAndZipLogs({ traceId, payload: invalidPayload }))
                .rejects.toThrow('Invalid date range: invalid-date to 2024-01-03');
        });

        it('should throw error for invalid end date', async () => {
            const invalidPayload = {
                ...mockPayload,
                endDate: 'invalid-date',
            };

            await expect(activity.fetchAndZipLogs({ traceId, payload: invalidPayload }))
                .rejects.toThrow('Invalid date range: 2024-01-01 to invalid-date');
        });

        it('should throw error when start date is after end date', async () => {
            const invalidPayload = {
                ...mockPayload,
                startDate: '2024-01-05',
                endDate: '2024-01-01',
            };

            await expect(activity.fetchAndZipLogs({ traceId, payload: invalidPayload }))
                .rejects.toThrow('Invalid date range: 2024-01-05 to 2024-01-01');
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
            expect(execCall).toContain('-path "/test/logs/2024-01-01/worker/worker-1"');
            expect(execCall).toContain('-path "/test/logs/2024-01-01/worker/worker-2"');
            expect(execCall).toContain('-path "/test/logs/2024-01-01/worker/worker-3"');
        });

        it('should handle empty projectWorkerMap', async () => {
            const emptyMapPayload = {
                ...mockPayload,
                projectWorkerMap: [],
            };

            await expect(activity.fetchAndZipLogs({ traceId, payload: emptyMapPayload }))
                .rejects.toThrow('No paths generated from inputs');
        });

        it('should handle projectWorkerMap with missing projectId', async () => {
            const invalidMapPayload = {
                ...mockPayload,
                projectWorkerMap: [
                    {
                        workerIds: ['worker-1'],
                    },
                ],
            };

            await expect(activity.fetchAndZipLogs({ traceId, payload: invalidMapPayload }))
                .rejects.toThrow('No paths generated from inputs');
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
                    callback({ stderr: 'Find command failed', message: 'Command execution failed' }, '', 'Find command failed');
                }, 0);
                return {} as any;
            });

            await expect(activity.fetchAndZipLogs({ traceId, payload: mockPayload }))
                .rejects.toThrow('Failed to execute find command');

            expect(mockLogger.error).toHaveBeenCalledWith('Error executing find:', 'Find command failed');
        });

        it('should throw error when no matching directories found', async () => {
            mockExec.mockImplementation((cmd, callback) => {
                setTimeout(() => {
                    callback(null, '', '');
                }, 0);
                return {} as any;
            });

            await expect(activity.fetchAndZipLogs({ traceId, payload: mockPayload }))
                .rejects.toThrow('No matching directories found in the given date range.');
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

            await expect(activity.fetchAndZipLogs({ traceId, payload: mockPayload }))
                .rejects.toThrow('Archiver failed');

            expect(mockLogger.error).toHaveBeenCalledWith('[trace-123] Archiving error:', expect.any(Error));
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

            const result = await activity.fetchAndZipLogs({ traceId, payload: specialUserPayload });

            expect(result).toBe(path.join(outputZipPath, 'ndm_test@user-123_special.chars.zip'));
        });

        it('should filter out empty stdout lines', async () => {
            mockExec.mockImplementation((cmd, callback) => {
                setTimeout(() => {
                    callback(null, '/test/logs/2024-01-01/project-1\n\n/test/logs/2024-01-01/project-2\n\n', '');
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

            await expect(activity.fetchAndZipLogs({ traceId, payload: mockPayload }))
                .rejects.toThrow('General processing error');

            expect(mockLogger.error).toHaveBeenCalledWith('[trace-123] Error in fetchAndZipLogsUsingFind:', 'General processing error');
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
                    callback(null, '/test/logs/2024-01-01/project-1\n/test/logs/2024-01-01/project-2\n', '');
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

            await activity.fetchAndZipLogs({ traceId: 'leap-year-test', payload: leapYearPayload });

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

            await activity.fetchAndZipLogs({ traceId: 'month-boundary-test', payload: monthBoundaryPayload });

            const execCall = mockExec.mock.calls[0][0] as string;
            expect(execCall).toContain('2024-01-30');
            expect(execCall).toContain('2024-01-31');
            expect(execCall).toContain('2024-02-01');
            expect(execCall).toContain('2024-02-02');
        });
    });
});
