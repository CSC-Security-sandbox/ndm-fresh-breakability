import { FetchFailedOperationsActivity } from './fetch-failed-operations.activity';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service';
import { AuthService } from 'src/auth/auth.service';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { RetryableError } from 'src/errors/errors.types';
import axios from 'axios';
import { RetryBatchInfo } from '@netapp-cloud-datamigrate/jobs-lib';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('FetchFailedOperationsActivity', () => {
    let activity: FetchFailedOperationsActivity;
    let configService: jest.Mocked<ConfigService>;
    let redisService: jest.Mocked<RedisService>;
    let authService: jest.Mocked<AuthService>;
    let loggerFactory: jest.Mocked<LoggerFactory>;
    let mockLogger: jest.Mocked<LoggerService>;

    const jobRunId = 'retry-job-123';
    const originalJobRunId = 'original-job-456';

    const mockJobContext = {
        jobConfig: {
            sourceFileServer: {
                pathId: 'source-path-id',
                protocols: [{ type: 'NFS' }],
            },
            destinationFileServer: {
                pathId: 'target-path-id',
            },
            options: {
                skipsFilesModifiedInLast: '2d',
                excludeFilePattern: 'node_modules,.git',
            },
        },
        getRetryCursor: jest.fn().mockResolvedValue(null),
        setRetryCursor: jest.fn().mockResolvedValue(undefined),
        setRetryBatch: jest.fn().mockResolvedValue(undefined),
    };

    const mockFailedOperations = [
        { id: 'op-1', fPath: '/data/folder1/file1.txt', errorCode: 'ENOENT' },
        { id: 'op-2', fPath: '/data/folder1/file2.txt', errorCode: 'EACCES' },
        { id: 'op-3', fPath: '/data/folder2/file3.txt', errorCode: 'ENOENT' },
    ];

    beforeEach(() => {
        jest.clearAllMocks();

        mockLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            log: jest.fn(),
        } as any;

        loggerFactory = {
            create: jest.fn().mockReturnValue(mockLogger),
        } as any;

        configService = {
            get: jest.fn((key: string) => {
                switch (key) {
                    case 'worker.connection.workerJobServiceUrl': return 'http://jobs-service:3000';
                    case 'worker.retryFetchBatchSize': return 4000;
                    case 'worker.projectId': return 'test-project';
                    default: return undefined;
                }
            }),
        } as any;

        redisService = {
            getJobManagerContext: jest.fn().mockResolvedValue(mockJobContext),
        } as any;

        authService = {
            getAccessToken: jest.fn().mockResolvedValue('test-access-token'),
        } as any;

        activity = new FetchFailedOperationsActivity(
            configService,
            loggerFactory,
            redisService,
            authService
        );

        // Default successful API response
        mockedAxios.get.mockResolvedValue({
            data: {
                data: {
                    items: {
                        data: mockFailedOperations,
                        nextCursor: null,
                    },
                },
            },
        });
        mockedAxios.isAxiosError = jest.fn().mockReturnValue(false);
    });

    describe('fetchFailedOperations', () => {
        it('should fetch failed operations from API', async () => {
            const result = await activity.fetchFailedOperations({
                jobRunId,
                originalJobRunId,
            });

            expect(mockedAxios.get).toHaveBeenCalledWith(
                'http://jobs-service:3000/api/v1/job-run/failed-operations',
                expect.objectContaining({
                    params: {
                        jobRunId: originalJobRunId,
                        cursor: undefined,
                        limit: 4000,
                    },
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer test-access-token',
                        'projectId': 'test-project',
                    }),
                })
            );
            expect(result.opsBatchIds.length).toBeGreaterThan(0);
        });

        it('should group operations by parent directory', async () => {
            const result = await activity.fetchFailedOperations({
                jobRunId,
                originalJobRunId,
            });

            // 3 operations should be grouped into 2 batches (folder1 and folder2)
            expect(result.opsBatchIds).toHaveLength(2);
            expect(mockJobContext.setRetryBatch).toHaveBeenCalledTimes(2);
        });

        it('should return hasMore=false when no more pages', async () => {
            mockedAxios.get.mockResolvedValue({
                data: {
                    data: {
                        items: {
                            data: mockFailedOperations,
                            nextCursor: null,
                        },
                    },
                },
            });

            const result = await activity.fetchFailedOperations({
                jobRunId,
                originalJobRunId,
            });

            expect(result.hasMore).toBe(false);
        });

        it('should return hasMore=true when more pages exist', async () => {
            mockedAxios.get.mockResolvedValue({
                data: {
                    data: {
                        items: {
                            data: mockFailedOperations,
                            nextCursor: 'next-cursor-token',
                        },
                    },
                },
            });

            const result = await activity.fetchFailedOperations({
                jobRunId,
                originalJobRunId,
            });

            expect(result.hasMore).toBe(true);
            expect(mockJobContext.setRetryCursor).toHaveBeenCalledWith('next-cursor-token');
        });

        it('should use cursor from previous fetch', async () => {
            mockJobContext.getRetryCursor.mockResolvedValue('previous-cursor');

            await activity.fetchFailedOperations({
                jobRunId,
                originalJobRunId,
            });

            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    params: expect.objectContaining({
                        cursor: 'previous-cursor',
                    }),
                })
            );
        });

        it('should return settings extracted from job context', async () => {
            const result = await activity.fetchFailedOperations({
                jobRunId,
                originalJobRunId,
            });

            expect(result.settings).toBeDefined();
            expect(result.settings.skipFile).toBe('2d');
            expect(result.settings.excludePatterns).toEqual(['node_modules', '.git']);
            expect(result.settings.isSMB).toBe(false);
        });

        it('should detect SMB protocol', async () => {
            mockJobContext.jobConfig.sourceFileServer.protocols = [{ type: 'SMB' }];

            const result = await activity.fetchFailedOperations({
                jobRunId,
                originalJobRunId,
            });

            expect(result.settings.isSMB).toBe(true);
        });

        it('should use empty excludePatterns when options.excludeFilePattern is missing', async () => {
            mockJobContext.jobConfig.options = { skipsFilesModifiedInLast: '2d' };

            const result = await activity.fetchFailedOperations({
                jobRunId,
                originalJobRunId,
            });

            expect(result.settings.excludePatterns).toEqual([]);
        });

        it('should use empty string for skipFile when options.skipsFilesModifiedInLast is missing', async () => {
            mockJobContext.jobConfig.options = { excludeFilePattern: 'node_modules' };

            const result = await activity.fetchFailedOperations({
                jobRunId,
                originalJobRunId,
            });

            expect(result.settings.sourcePrefix).toBeDefined();
            expect(result.settings.skipFile).toBe('');
        });

        it('should set isSMB false when protocols is undefined', async () => {
            delete mockJobContext.jobConfig.sourceFileServer.protocols;

            const result = await activity.fetchFailedOperations({
                jobRunId,
                originalJobRunId,
            });

            expect(result.settings.isSMB).toBe(false);
        });

        it('should not call setRetryCursor when nextCursor is null', async () => {
            mockedAxios.get.mockResolvedValue({
                data: {
                    data: {
                        items: {
                            data: mockFailedOperations,
                            nextCursor: null,
                        },
                    },
                },
            });

            await activity.fetchFailedOperations({ jobRunId, originalJobRunId });

            expect(mockJobContext.setRetryCursor).not.toHaveBeenCalled();
        });

        it('should return empty result when no operations', async () => {
            mockedAxios.get.mockResolvedValue({
                data: {
                    data: {
                        items: {
                            data: [],
                            nextCursor: null,
                        },
                    },
                },
            });

            const result = await activity.fetchFailedOperations({
                jobRunId,
                originalJobRunId,
            });

            expect(result.opsBatchIds).toHaveLength(0);
            expect(result.hasMore).toBe(false);
        });
    });

    describe('error handling', () => {
        it('should throw RetryableError when access token is missing', async () => {
            authService.getAccessToken.mockResolvedValue(null);

            await expect(
                activity.fetchFailedOperations({ jobRunId, originalJobRunId })
            ).rejects.toThrow(RetryableError);
        });

        it('should throw RetryableError on API 4xx errors', async () => {
            const axiosError = {
                response: { status: 400, data: { message: 'Bad request' } },
                message: 'Request failed',
            };
            mockedAxios.get.mockRejectedValue(axiosError);
            mockedAxios.isAxiosError.mockReturnValue(true);

            await expect(
                activity.fetchFailedOperations({ jobRunId, originalJobRunId })
            ).rejects.toThrow(RetryableError);
        });

        it('should throw RetryableError on API 5xx errors', async () => {
            const axiosError = {
                response: { status: 500, data: { message: 'Internal server error' } },
                message: 'Server error',
            };
            mockedAxios.get.mockRejectedValue(axiosError);
            mockedAxios.isAxiosError.mockReturnValue(true);

            await expect(
                activity.fetchFailedOperations({ jobRunId, originalJobRunId })
            ).rejects.toThrow(RetryableError);
        });

        it('should throw RetryableError on network errors', async () => {
            mockedAxios.get.mockRejectedValue(new Error('Network error'));

            await expect(
                activity.fetchFailedOperations({ jobRunId, originalJobRunId })
            ).rejects.toThrow(RetryableError);
        });

        it('should throw RetryableError with response message when API returns 404', async () => {
            const axiosError = {
                isAxiosError: true,
                response: { status: 404, data: { message: 'Not found' } },
                message: 'Request failed',
            };
            mockedAxios.get.mockRejectedValue(axiosError);
            mockedAxios.isAxiosError.mockReturnValue(true);

            await expect(
                activity.fetchFailedOperations({ jobRunId, originalJobRunId })
            ).rejects.toThrow(/HTTP 404 - Not found/);
        });

        it('should throw RetryableError with error.message when axios error has no response.data.message', async () => {
            const axiosError = {
                isAxiosError: true,
                response: { status: 500, data: {} },
                message: 'Internal Server Error',
            };
            mockedAxios.get.mockRejectedValue(axiosError);
            mockedAxios.isAxiosError.mockReturnValue(true);

            await expect(
                activity.fetchFailedOperations({ jobRunId, originalJobRunId })
            ).rejects.toThrow(/HTTP 500 - Internal Server Error/);
        });

        it('should throw RetryableError when axios error has no status (e.g. network timeout)', async () => {
            const axiosError = {
                isAxiosError: true,
                response: undefined,
                message: 'timeout of 5000ms exceeded',
            };
            mockedAxios.get.mockRejectedValue(axiosError);
            mockedAxios.isAxiosError.mockReturnValue(true);

            await expect(
                activity.fetchFailedOperations({ jobRunId, originalJobRunId })
            ).rejects.toThrow(RetryableError);
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('timeout'));
        });
    });

    describe('batch storage', () => {
        it('should store batches in Redis with calculated hash IDs', async () => {
            await activity.fetchFailedOperations({
                jobRunId,
                originalJobRunId,
            });

            expect(mockJobContext.setRetryBatch).toHaveBeenCalled();
            
            // Verify RetryBatchInfo was created with correct structure
            const calls = mockJobContext.setRetryBatch.mock.calls;
            expect(calls.length).toBe(2);
            
            // Each call should have a batchId (string) and RetryBatchInfo
            calls.forEach(([batchId, batch]) => {
                expect(typeof batchId).toBe('string');
                expect(batch).toBeInstanceOf(RetryBatchInfo);
            });
        });
    });
});
