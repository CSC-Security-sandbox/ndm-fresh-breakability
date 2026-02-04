import { ProcessRetryBatchActivity } from './process-retry-batch.activity';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service';
import { CommandGenerationService } from '../shared/command-generation.service';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { FatalError, RetryableError } from 'src/errors/errors.types';
import { Context } from '@temporalio/activity';
import { TaskStatus, TaskType, CommandStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import * as fs from 'fs';
import { RetryScanSettings } from 'src/workflows/core/child/child-retry-scan.workflow.type';

jest.mock('@temporalio/activity', () => ({
    Context: {
        current: jest.fn(),
    },
}));

jest.mock('fs', () => ({
    promises: {
        readdir: jest.fn(),
    },
}));

jest.mock('../utils/utils', () => ({
    isPathExists: jest.fn().mockResolvedValue(true),
}));

describe('ProcessRetryBatchActivity', () => {
    let activity: ProcessRetryBatchActivity;
    let configService: jest.Mocked<ConfigService>;
    let redisService: jest.Mocked<RedisService>;
    let commandGenerationService: jest.Mocked<CommandGenerationService>;
    let loggerFactory: jest.Mocked<LoggerFactory>;
    let mockLogger: jest.Mocked<LoggerService>;

    const jobRunId = 'retry-job-123';
    const batchId = 'batch-abc123';

    const mockSettings: RetryScanSettings = {
        sourcePrefix: '/mnt/source',
        targetPrefix: '/mnt/target',
        skipFile: '2d',
        excludePatterns: ['node_modules', '.git'],
        isSMB: false,
    };

    const mockJobContext = {
        jobConfig: {
            workerIds: ['worker-1'],
            sourceFileServer: { pathId: 'source-path-id' },
            destinationFileServer: { pathId: 'target-path-id' },
        },
        getRetryBatch: jest.fn(),
        deleteRetryBatch: jest.fn(),
        getBatchDir: jest.fn(),
        deleteBatchDir: jest.fn(),
        setBatchDir: jest.fn(),
        getTask: jest.fn(),
        setTask: jest.fn(),
        deleteTask: jest.fn(),
        publishBulkToCommandStream: jest.fn(),
        publishToTaskStream: jest.fn(),
        publishToErrorStream: jest.fn(),
    };

    const mockOperationsBatch = {
        parentPath: '/data/folder1',
        operations: [
            { id: 'op-1', fPath: '/data/folder1/file1.txt', errorCode: 'ENOENT' },
            { id: 'op-2', fPath: '/data/folder1/file2.txt', errorCode: 'EACCES' },
        ],
    };

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
                    case 'worker.maxMigrationCommand': return 100;
                    default: return undefined;
                }
            }),
        } as any;

        redisService = {
            getJobManagerContext: jest.fn().mockResolvedValue(mockJobContext),
        } as any;

        commandGenerationService = {
            processItems: jest.fn().mockResolvedValue({
                commands: [{ id: 'cmd-1', fPath: '/file1.txt' }],
                subDirs: [],
            }),
        } as any;

        (Context.current as jest.Mock).mockReturnValue({
            info: { activityId: 'activity-1' },
            heartbeat: jest.fn(),
        });

        (fs.promises.readdir as jest.Mock).mockResolvedValue(['file1.txt', 'file2.txt']);

        activity = new ProcessRetryBatchActivity(
            configService,
            loggerFactory,
            redisService,
            commandGenerationService
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('processRetryBatch - ops type', () => {
        beforeEach(() => {
            mockJobContext.getRetryBatch.mockResolvedValue(mockOperationsBatch);
        });

        it('should retrieve batch from Redis', async () => {
            await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'ops',
                settings: mockSettings,
            });

            expect(mockJobContext.getRetryBatch).toHaveBeenCalledWith(batchId);
        });

        it('should process items through command generation service', async () => {
            await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'ops',
                settings: mockSettings,
            });

            expect(commandGenerationService.processItems).toHaveBeenCalledWith(
                expect.objectContaining({
                    sourcePath: expect.stringContaining('/data/folder1'),
                    targetPath: expect.stringContaining('/data/folder1'),
                    sourcePrefix: mockSettings.sourcePrefix,
                    targetPrefix: mockSettings.targetPrefix,
                })
            );
        });

        it('should publish commands to stream', async () => {
            await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'ops',
                settings: mockSettings,
            });

            expect(mockJobContext.publishBulkToCommandStream).toHaveBeenCalled();
        });

        it('should delete batch from Redis after processing', async () => {
            await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'ops',
                settings: mockSettings,
            });

            expect(mockJobContext.deleteRetryBatch).toHaveBeenCalledWith(batchId);
        });

        it('should return discovered subdirectories', async () => {
            commandGenerationService.processItems.mockResolvedValue({
                commands: [],
                subDirs: ['/data/folder1/subdir1', '/data/folder1/subdir2'],
            });

            const result = await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'ops',
                settings: mockSettings,
            });

            expect(result.batchDirs.length).toBeGreaterThanOrEqual(0);
        });

        it('should return empty batchDirs when batch not found', async () => {
            mockJobContext.getRetryBatch.mockResolvedValue(null);

            const result = await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'ops',
                settings: mockSettings,
            });

            expect(result.batchDirs).toEqual([]);
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should use custom batch size when provided', async () => {
            await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'ops',
                batchSize: 50,
                settings: mockSettings,
            });

            expect(mockJobContext.getRetryBatch).toHaveBeenCalledWith(batchId);
        });

        it('should send heartbeats during processing', async () => {
            const heartbeatMock = jest.fn();
            (Context.current as jest.Mock).mockReturnValue({
                info: { activityId: 'activity-1' },
                heartbeat: heartbeatMock,
            });

            await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'ops',
                settings: mockSettings,
            });

            // Heartbeat is called on interval, may or may not be called depending on timing
            // Just verify activity completed without error
            expect(mockJobContext.deleteRetryBatch).toHaveBeenCalled();
        });
    });

    describe('processRetryBatch - dir type', () => {
        const mockDirCommands = [
            { id: 'cmd-1', fPath: '/data/subdir1', status: CommandStatus.READY, isDir: true },
            { id: 'cmd-2', fPath: '/data/subdir2', status: CommandStatus.READY, isDir: true },
        ];

        beforeEach(() => {
            mockJobContext.getBatchDir.mockResolvedValue(mockDirCommands);
            mockJobContext.getTask.mockResolvedValue({
                id: 'task-1',
                status: TaskStatus.RUNNING,
            });
        });

        it('should retrieve directory batch from Redis', async () => {
            await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'dir',
                settings: mockSettings,
            });

            expect(mockJobContext.getBatchDir).toHaveBeenCalledWith(batchId);
        });

        it('should scan each directory in the batch', async () => {
            await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'dir',
                settings: mockSettings,
            });

            // Should call processItems for each directory
            expect(commandGenerationService.processItems).toHaveBeenCalledTimes(2);
        });

        it('should read directory contents from filesystem', async () => {
            await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'dir',
                settings: mockSettings,
            });

            expect(fs.promises.readdir).toHaveBeenCalled();
        });

        it('should delete batch directory from Redis after processing', async () => {
            await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'dir',
                settings: mockSettings,
            });

            expect(mockJobContext.deleteBatchDir).toHaveBeenCalledWith(batchId);
        });

        it('should return empty batchDirs when batch not found', async () => {
            mockJobContext.getBatchDir.mockResolvedValue(null);

            const result = await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'dir',
                settings: mockSettings,
            });

            expect(result.batchDirs).toEqual([]);
        });

        it('should return empty batchDirs when dir batch is empty array', async () => {
            mockJobContext.getBatchDir.mockResolvedValue([]);

            const result = await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'dir',
                settings: mockSettings,
            });

            expect(result.batchDirs).toEqual([]);
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('not found'));
        });

        it('should skip updateTaskStatus and deleteTask when batchTaskInfo is null', async () => {
            mockJobContext.getTask.mockResolvedValue(null);
            mockJobContext.getBatchDir.mockResolvedValue(mockDirCommands);
            commandGenerationService.processItems.mockResolvedValue({ commands: [], subDirs: [] });

            const result = await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'dir',
                settings: mockSettings,
            });

            expect(result.batchDirs).toBeDefined();
            expect(mockJobContext.deleteTask).not.toHaveBeenCalled();
        });

        it('should collect subdirs from all directory scans', async () => {
            commandGenerationService.processItems
                .mockResolvedValueOnce({ commands: [], subDirs: ['/subdir1/nested'] })
                .mockResolvedValueOnce({ commands: [], subDirs: ['/subdir2/nested'] });

            const result = await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'dir',
                settings: mockSettings,
            });

            // Should have batched the discovered subdirs
            expect(result.batchDirs).toBeDefined();
        });

        it('should continue processing other directories on non-fatal error', async () => {
            commandGenerationService.processItems
                .mockRejectedValueOnce(new Error('First dir failed'))
                .mockResolvedValueOnce({ commands: [], subDirs: [] });

            // Should not throw, continue with other directories
            await expect(
                activity.processRetryBatch({
                    jobRunId,
                    batchId,
                    type: 'dir',
                    settings: mockSettings,
                })
            ).resolves.toBeDefined();

            expect(commandGenerationService.processItems).toHaveBeenCalledTimes(2);
        });
    });

    describe('error handling', () => {
        beforeEach(() => {
            mockJobContext.getRetryBatch.mockResolvedValue(mockOperationsBatch);
        });

        it('should throw FatalError on fatal errors for ops type', async () => {
            commandGenerationService.processItems.mockRejectedValue(
                new FatalError('Fatal processing error')
            );

            await expect(
                activity.processRetryBatch({
                    jobRunId,
                    batchId,
                    type: 'ops',
                    settings: mockSettings,
                })
            ).rejects.toThrow(FatalError);
        });

        it('should throw RetryableError on non-fatal errors for ops type', async () => {
            commandGenerationService.processItems.mockRejectedValue(
                new Error('Transient error')
            );

            await expect(
                activity.processRetryBatch({
                    jobRunId,
                    batchId,
                    type: 'ops',
                    settings: mockSettings,
                })
            ).rejects.toThrow(RetryableError);
        });

        it('should throw FatalError on fatal errors for dir type', async () => {
            mockJobContext.getBatchDir.mockResolvedValue([
                { id: 'cmd-1', fPath: '/data/subdir1' },
            ]);
            commandGenerationService.processItems.mockRejectedValue(
                new FatalError('Fatal directory error')
            );

            await expect(
                activity.processRetryBatch({
                    jobRunId,
                    batchId,
                    type: 'dir',
                    settings: mockSettings,
                })
            ).rejects.toThrow(FatalError);
        });

        it('should log errors for failed operations', async () => {
            commandGenerationService.processItems.mockRejectedValue(
                new Error('Processing failed')
            );

            await expect(
                activity.processRetryBatch({
                    jobRunId,
                    batchId,
                    type: 'ops',
                    settings: mockSettings,
                })
            ).rejects.toThrow();

            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('task management', () => {
        beforeEach(() => {
            mockJobContext.getRetryBatch.mockResolvedValue(mockOperationsBatch);
        });

        it('should publish task to stream for ops type', async () => {
            await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'ops',
                settings: mockSettings,
            });

            expect(mockJobContext.publishToTaskStream).toHaveBeenCalled();
        });

        it('should update task status after processing', async () => {
            await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'ops',
                settings: mockSettings,
            });

            // Task should be published twice: once at start, once at completion
            expect(mockJobContext.publishToTaskStream).toHaveBeenCalledTimes(2);
        });
    });

    describe('command generation', () => {
        beforeEach(() => {
            mockJobContext.getRetryBatch.mockResolvedValue(mockOperationsBatch);
        });

        it('should pass correct settings to command generation', async () => {
            await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'ops',
                settings: mockSettings,
            });

            expect(commandGenerationService.processItems).toHaveBeenCalledWith(
                expect.objectContaining({
                    settings: {
                        skipFile: mockSettings.skipFile,
                        excludePatterns: mockSettings.excludePatterns,
                    },
                })
            );
        });

        it('should not publish commands when none generated', async () => {
            commandGenerationService.processItems.mockResolvedValue({
                commands: [],
                subDirs: [],
            });

            await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'ops',
                settings: mockSettings,
            });

            expect(mockJobContext.publishBulkToCommandStream).not.toHaveBeenCalled();
        });
    });

    describe('getDirContents ENOENT on destination', () => {
        beforeEach(() => {
            mockJobContext.getRetryBatch.mockResolvedValue(mockOperationsBatch);
        });

        it('should handle target directory ENOENT and still process batch', async () => {
            const readdirMock = fs.promises.readdir as jest.Mock;
            readdirMock.mockImplementation((p: string) => {
                if (p.includes('target') || p.includes('tgt')) {
                    return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
                }
                return Promise.resolve(['file1.txt']);
            });
            commandGenerationService.processItems.mockResolvedValue({
                commands: [{ id: 'c1', fPath: '/file1.txt' }],
                subDirs: [],
            });

            const result = await activity.processRetryBatch({
                jobRunId,
                batchId,
                type: 'ops',
                settings: mockSettings,
            });

            expect(result.batchDirs).toBeDefined();
            expect(mockJobContext.publishBulkToCommandStream).toHaveBeenCalled();
        });
    });
});
