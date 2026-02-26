import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CommandStatus, TaskInfo, TaskStatus, TaskType } from '@netapp-cloud-datamigrate/jobs-lib';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLogger } from 'src/auth/auth.service.spec';
import { FatalError, RetryExceededError } from 'src/errors/errors.types';
import { RedisService } from 'src/redis/redis.service';
import { CommonTaskService } from '../common/common-task.service';
import { CommandExecService } from './command-execution/command-execution.service';
import { SyncService } from './sync-activity.service';

// Mock the @temporalio/activity Context
jest.mock('@temporalio/activity', () => ({
    Context: {
        current: jest.fn(() => ({
            heartbeat: jest.fn(),
        })),
    },
}));

// Mock utils functions
jest.mock('src/activities/utils/utils', () => {
    const basePrefix = jest.fn((jobRunId, pathId, directoryPath?: string) => {
        const sanitizedDir = directoryPath ? directoryPath.replace(/^\/+/g, '') : '';
        return sanitizedDir
            ? `/base/${jobRunId}/${pathId}/${sanitizedDir}`
            : `/base/${jobRunId}/${pathId}`;
    });

    return {
        basePrefix,
        isFatalError: jest.fn((error) => error === 'FATAL'),
        isSourceFatalError: jest.fn((error) => error === 'SOURCE_FATAL'),
        isTransientError: jest.fn((error) => error === 'TRANSIENT'),
    };
});

describe('SyncService', () => {
    let service: SyncService;
    let configService: jest.Mocked<ConfigService>;
    let loggerFactory: jest.Mocked<LoggerFactory>;
    let redisService: jest.Mocked<RedisService>;
    let commonTaskService: jest.Mocked<CommonTaskService>;
    let commandExecService: jest.Mocked<CommandExecService>;
    let mockJobContext: any;
    let originalPlatform: string;

    beforeEach(async () => {
        originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        configService = {
            get: jest.fn().mockImplementation((key: string) => {
                switch (key) {
                    case 'worker.workerId':
                        return 'test-worker-1';
                    case 'worker.maxRetryCount':
                        return 3;
                    case 'worker.maxCommandConcurrency':
                        return 100;
                    default:
                        return undefined;
                }
            }),
        } as any;

        loggerFactory = {
            create: jest.fn().mockReturnValue(mockLogger),
        } as any;

        mockJobContext = {
            getTask: jest.fn(),
            publishToTaskStream: jest.fn(),
            setTask: jest.fn(),
            deleteTask: jest.fn(),
            jobConfig: {
                sourceDirectoryPath: '/source-dir',
                destinationDirectoryPath: '/target-dir',
            },
        };

        redisService = {
            getJobManagerContext: jest.fn().mockResolvedValue(mockJobContext),
        } as any;

        commonTaskService = {
            ensureTaskValid: jest.fn(),
        } as any;

        commandExecService = {
            executeCommand: jest.fn(),
            executeCommandsWithBatchAcl: jest.fn().mockImplementation((inputs: any[]) => ({
                sourceErrors: [] as string[],
                targetErrors: [] as string[],
                cmd: inputs?.[0]?.command ?? {},
            })),
        } as any;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SyncService,
                { provide: ConfigService, useValue: configService },
                { provide: LoggerFactory, useValue: loggerFactory },
                { provide: RedisService, useValue: redisService },
                { provide: CommonTaskService, useValue: commonTaskService },
                { provide: CommandExecService, useValue: commandExecService },
            ],
        }).compile();

        service = module.get<SyncService>(SyncService);
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with correct configuration values', () => {
            expect(service.workerId).toBe('test-worker-1');
            expect(service.maxRetryCount).toBe(3);
            expect(service.maxConcurrency).toBe(100);
            expect(configService.get).toHaveBeenCalledWith('worker.workerId');
            expect(configService.get).toHaveBeenCalledWith('worker.maxRetryCount');
            expect(configService.get).toHaveBeenCalledWith('worker.maxCommandConcurrency');
        });

        it('should use default values when config is not provided', async () => {
            configService.get.mockImplementation((key: string) => {
                if (key === 'worker.workerId') return 'test-worker-1';
                return undefined; // Return undefined for other keys to test defaults
            });

            const module = await Test.createTestingModule({
                providers: [
                    SyncService,
                    { provide: ConfigService, useValue: configService },
                    { provide: LoggerFactory, useValue: loggerFactory },
                    { provide: RedisService, useValue: redisService },
                    { provide: CommonTaskService, useValue: commonTaskService },
                    { provide: CommandExecService, useValue: commandExecService },
                ],
            }).compile();

            const serviceWithDefaults = module.get<SyncService>(SyncService);
            expect(serviceWithDefaults.maxRetryCount).toBe(3); // Default value
            expect(serviceWithDefaults.maxConcurrency).toBe(100); // Default value
        });
    });

    describe('syncTaskActivity', () => {
        const mockSyncInput = {
            jobRunId: 'job-123',
            taskId: 'task-456',
        };

        it('should return early when task is not found', async () => {
            mockJobContext.getTask.mockResolvedValue(null);

            const result = await service.syncTaskActivity(mockSyncInput);

            expect(result.status).toBe(TaskStatus.PENDING);
            expect(result.errors.source).toEqual([]);
            expect(result.errors.target).toEqual([]);
            expect(commonTaskService.ensureTaskValid).not.toHaveBeenCalled();
        });

        it('should handle and rethrow FatalError', async () => {
            const mockTask = new TaskInfo(
                'task-456',
                'job-123',
                TaskType.SCAN,
                TaskStatus.PENDING,
                '',
                'source-path',
                []
            );
            
            mockJobContext.getTask.mockResolvedValue(mockTask);
            const fatalError = new FatalError('Fatal error occurred');
            commonTaskService.ensureTaskValid.mockRejectedValue(fatalError);

            await expect(service.syncTaskActivity(mockSyncInput)).rejects.toThrow(FatalError);
            expect(mockLogger.error).toHaveBeenCalled(); // FatalError should not be logged
        });

        it('should handle and rethrow non-FatalError', async () => {
            const mockTask = new TaskInfo(
                'task-456',
                'job-123',
                TaskType.SCAN,
                TaskStatus.PENDING,
                '',
                'source-path',
                []
            );
            
            mockJobContext.getTask.mockResolvedValue(mockTask);
            const error = new Error('General error');
            commonTaskService.ensureTaskValid.mockRejectedValue(error);

            await expect(service.syncTaskActivity(mockSyncInput)).rejects.toThrow('General error');
            expect(mockLogger.error).toHaveBeenCalledWith(
                '[job-123] Error in syncTaskActivity: General error',
                error.stack
            );
        });

        it('should clear heartbeat interval on completion', async () => {
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
            mockJobContext.getTask.mockResolvedValue(null);
            
            await service.syncTaskActivity(mockSyncInput);

            expect(clearIntervalSpy).toHaveBeenCalled();
        });

        it('should clear heartbeat interval on error', async () => {
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
            const mockTask = new TaskInfo(
                'task-456',
                'job-123',
                TaskType.SCAN,
                TaskStatus.PENDING,
                '',
                'source-path',
                []
            );
            
            mockJobContext.getTask.mockResolvedValue(mockTask);
            const error = new Error('Test error');
            commonTaskService.ensureTaskValid.mockRejectedValue(error);

            await expect(service.syncTaskActivity(mockSyncInput)).rejects.toThrow();
            expect(clearIntervalSpy).toHaveBeenCalled();
        });

        it('should successfully complete sync task', async () => {
            const mockTask = new TaskInfo(
                'task-456',
                'job-123',
                TaskType.MIGRATE,
                TaskStatus.PENDING,
                '',
                'source-path',
                [{ id: 'cmd-1', status: CommandStatus.COMPLETED, fPath: '/file1.txt' } as any],
                'target-path'
            );

            mockJobContext.getTask.mockResolvedValue(mockTask);
            commonTaskService.ensureTaskValid.mockResolvedValue(mockTask);
            commandExecService.executeCommand.mockResolvedValue({
                sourceErrors: [],
                targetErrors: [],
                cmd: {} as any,
            });

            // Mock the executeSyncTask to return a successful result
            jest.spyOn(service, 'executeSyncTask').mockResolvedValue({
                errors: { source: [], target: [] },
                status: TaskStatus.COMPLETED,
                error: 0,
            });

            const updateSpy = jest.spyOn(service, 'updateAndReportTaskStatus').mockResolvedValue();

            const result = await service.syncTaskActivity(mockSyncInput);

            expect(result.status).toBe(TaskStatus.COMPLETED);
            expect(result.errors.source).toEqual([]);
            expect(result.errors.target).toEqual([]);
            expect(result.error).toBe(0);

            expect(redisService.getJobManagerContext).toHaveBeenCalledWith('job-123');
            expect(mockJobContext.getTask).toHaveBeenCalledWith('task-456');
            expect(commonTaskService.ensureTaskValid).toHaveBeenCalledWith({
                task: mockTask,
                jobContext: mockJobContext,
            });
            expect(mockJobContext.publishToTaskStream).toHaveBeenCalledWith({
                ...mockTask,
                status: TaskStatus.RUNNING,
                workerId: 'test-worker-1',
            });
            expect(updateSpy).toHaveBeenCalled();
        });
    });

    describe('executeSyncTask', () => {
        it('should execute sync task and skip completed commands', async () => {
            const mockTask = new TaskInfo(
                'task-456',
                'job-123',
                TaskType.MIGRATE,
                TaskStatus.RUNNING,
                'test-worker-1',
                'source-path',
                [
                    { id: 'cmd-1', status: CommandStatus.READY, fPath: '/file1.txt' } as any,
                    { id: 'cmd-2', status: CommandStatus.COMPLETED, fPath: '/file2.txt' } as any,
                ],
                'target-path'
            );
            mockTask.retryCount = 1;

            commandExecService.executeCommand.mockResolvedValue({
                sourceErrors: [],
                targetErrors: [],
                cmd: {} as any,
            });

            const result = await service.executeSyncTask('task-hash-456', mockTask, mockJobContext);

            expect(result.status).toBe(TaskStatus.PENDING);
            expect(result.errors.source).toEqual([]);
            expect(result.errors.target).toEqual([]);

            // Should only call executeCommand for non-completed commands (cmd-1)
            expect(commandExecService.executeCommand).toHaveBeenCalledTimes(1);
            expect(mockJobContext.setTask).toHaveBeenCalledTimes(1);
        });

        it('should collect errors from command execution', async () => {
            const mockTask = new TaskInfo(
                'task-456',
                'job-123',
                TaskType.MIGRATE,
                TaskStatus.RUNNING,
                'test-worker-1',
                'source-path',
                [{ id: 'cmd-1', status: CommandStatus.READY, fPath: '/file1.txt' } as any],
                'target-path'
            );
            mockTask.retryCount = 1;

            commandExecService.executeCommand.mockResolvedValue({
                sourceErrors: ['source-error-1'],
                targetErrors: ['target-error-1'],
                cmd: {} as any,
            });

            const result = await service.executeSyncTask('task-hash-456', mockTask, mockJobContext);

            expect(result.errors.source).toEqual(['source-error-1']);
            expect(result.errors.target).toEqual(['target-error-1']);
        });

        it('should use executeCommandsWithBatchAcl on Windows', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            const mockTask = new TaskInfo(
                'task-456',
                'job-123',
                TaskType.MIGRATE,
                TaskStatus.RUNNING,
                'test-worker-1',
                'source-path',
                [{ id: 'cmd-1', status: CommandStatus.READY, fPath: '/file1.txt' } as any],
                'target-path'
            );
            mockTask.retryCount = 0;
            commandExecService.executeCommandsWithBatchAcl.mockResolvedValue({
                sourceErrors: [],
                targetErrors: [],
                cmd: {} as any,
            });

            await service.executeSyncTask('task-hash-456', mockTask, mockJobContext);

            expect(commandExecService.executeCommandsWithBatchAcl).toHaveBeenCalledTimes(1);
            expect(commandExecService.executeCommandsWithBatchAcl).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        sourcePath: expect.any(String),
                        targetPath: expect.any(String),
                        command: expect.any(Object),
                        jobContext: mockJobContext,
                    }),
                ])
            );
            expect(commandExecService.executeCommand).not.toHaveBeenCalled();
            Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        });
    });

    describe('updateAndReportTaskStatus', () => {
        it('should complete task when all commands are completed', async () => {
            const mockTask = new TaskInfo(
                'task-456',
                'job-123',
                TaskType.MIGRATE,
                TaskStatus.RUNNING,
                'test-worker-1',
                'source-path',
                [
                    { status: CommandStatus.COMPLETED } as any,
                    { status: CommandStatus.COMPLETED } as any,
                ]
            );

            const mockInput = {
                errors: { source: [], target: [] },
                jobContext: mockJobContext,
                taskHashId: 'task-hash-456',
                task: mockTask,
            };

            await service.updateAndReportTaskStatus(mockInput);

            expect(mockTask.status).toBe(TaskStatus.COMPLETED);
            expect(mockJobContext.publishToTaskStream).toHaveBeenCalledWith(mockTask);
            expect(mockJobContext.deleteTask).toHaveBeenCalledWith('task-hash-456');
        });

        it('should throw FatalError for fatal source errors', async () => {
            const mockTask = new TaskInfo(
                'task-456',
                'job-123',
                TaskType.MIGRATE,
                TaskStatus.RUNNING,
                'test-worker-1',
                'source-path',
                [{ status: CommandStatus.READY } as any]
            );

            const inputWithFatalSourceError = {
                errors: {
                    source: ['SOURCE_FATAL'],
                    target: [],
                },
                jobContext: mockJobContext,
                taskHashId: 'task-hash-456',
                task: mockTask,
            };

            await expect(service.updateAndReportTaskStatus(inputWithFatalSourceError))
                .rejects.toThrow(FatalError);

            expect(mockTask.status).toBe(TaskStatus.ERRORED);
            expect(mockJobContext.publishToTaskStream).toHaveBeenCalledWith(mockTask);
            expect(mockJobContext.deleteTask).toHaveBeenCalledWith('task-hash-456');
        });

        it('should throw RetryExceededError when retry count exceeds maximum', async () => {
            const mockTask = new TaskInfo(
                'task-456',
                'job-123',
                TaskType.MIGRATE,
                TaskStatus.RUNNING,
                'test-worker-1',
                'source-path',
                [{ status: CommandStatus.READY } as any]
            );
            mockTask.retryCount = 3; // Equals maxRetryCount

            const inputWithMaxRetries = {
                errors: {
                    source: ['recoverable-error'],
                    target: [],
                },
                jobContext: mockJobContext,
                taskHashId: 'task-hash-456',
                task: mockTask,
            };

            await expect(service.updateAndReportTaskStatus(inputWithMaxRetries))
                .rejects.toThrow(RetryExceededError);

            expect(mockTask.status).toBe(TaskStatus.ERRORED);
            expect(mockJobContext.deleteTask).toHaveBeenCalledWith('task-hash-456');
        });

       
    });

    describe('error handling edge cases', () => {
        it('should handle empty commands array in executeSyncTask', async () => {
            const taskWithNoCommands = new TaskInfo(
                'task-456',
                'job-123',
                TaskType.MIGRATE,
                TaskStatus.RUNNING,
                'test-worker-1',
                'source-path',
                [] // Empty commands array
            );
            taskWithNoCommands.retryCount = 1;

            const result = await service.executeSyncTask('task-hash-456', taskWithNoCommands, mockJobContext);

            expect(result.status).toBe(TaskStatus.PENDING);
            expect(result.errors.source).toEqual([]);
            expect(result.errors.target).toEqual([]);
            expect(commandExecService.executeCommand).not.toHaveBeenCalled();
        });

        describe('8.3 Collision Detection Error Handling', () => {
            it('should treat E8DOT3_COLLISION as TRANSIENT_ERROR when max retries exceeded', async () => {
                const collisionCommand = {
                    id: 'collision-cmd',
                    fPath: '/LONGLO~1/test.txt',
                    status: CommandStatus.READY,
                    isDir: false,
                    ops: {},
                    metadata: {
                        size: 1024,
                        mtime: new Date(),
                        atime: new Date(),
                        ctime: new Date(),
                        birthtime: new Date(),
                        mode: 644,
                        uid: 1000,
                        gid: 1000,
                        sid: 'test-sid',
                        inode: 123456
                    },
                    serialize: jest.fn(),
                };

                const taskWithCollision = new TaskInfo(
                    'task-collision-1',
                    'job-collision-123',
                    TaskType.MIGRATE,
                    TaskStatus.RUNNING,
                    'test-worker-1',
                    'source-collision',
                    [collisionCommand],
                    'target-collision'
                );
                taskWithCollision.retryCount = 3; // At max retry count

                const collisionError: any = new Error('8.3 short filename collision detected');
                collisionError.code = 'E8DOT3_COLLISION';
                
                const collisionResult = {
                    cmd: { ...collisionCommand, status: 'ERROR' },
                    sourceErrors: ['E8DOT3_COLLISION'],
                    targetErrors: [],
                    shouldStampMeta: false,
                    shouldUpdateItemInfo: false,
                };
                
                commandExecService.executeCommand.mockResolvedValue(collisionResult);

                const result = await service.executeSyncTask('task-hash-collision', taskWithCollision, mockJobContext);

                expect(result.status).toBe('PENDING');
                expect(result.errors.source).toContain('E8DOT3_COLLISION');
                expect(commandExecService.executeCommand).toHaveBeenCalledWith(
                    expect.objectContaining({
                        sourcePath: `/base/job-collision-123/source-collision/source-dir/LONGLO~1/test.txt`,
                        targetPath: `/base/job-collision-123/target-collision/target-dir/LONGLO~1/test.txt`,
                        command: collisionCommand,
                        errorType: 'TRANSIENT_ERROR' // Should be TRANSIENT_ERROR due to max retries
                    })
                );
            });

            it('should treat E8DOT3_COLLISION as RECOVERABLE_ERROR when under max retries', async () => {
                const collisionCommand = {
                    id: 'collision-cmd-2',
                    fPath: '/SHORTF~1/document.docx',
                    status: CommandStatus.READY,
                    isDir: false,
                    ops: {},
                    metadata: {
                        size: 2048,
                        mtime: new Date(),
                        atime: new Date(),
                        ctime: new Date(),
                        birthtime: new Date(),
                        mode: 644,
                        uid: 1000,
                        gid: 1000,
                        sid: 'test-sid-2',
                        inode: 123457
                    },
                    serialize: jest.fn(),
                };

                const taskWithCollision = new TaskInfo(
                    'task-collision-2',
                    'job-collision-456',
                    TaskType.MIGRATE,
                    TaskStatus.RUNNING,
                    'test-worker-1',
                    'source-collision-2',
                    [collisionCommand],
                    'target-collision-2'
                );
                taskWithCollision.retryCount = 1; // Under max retry count

                const collisionResult = {
                    cmd: { ...collisionCommand, status: 'ERROR' },
                    sourceErrors: ['E8DOT3_COLLISION'],
                    targetErrors: [],
                    shouldStampMeta: false,
                    shouldUpdateItemInfo: false,
                };
                
                commandExecService.executeCommand.mockResolvedValue(collisionResult);

                const result = await service.executeSyncTask('task-hash-collision-2', taskWithCollision, mockJobContext);

                expect(result.status).toBe('PENDING');
                expect(result.errors.source).toContain('E8DOT3_COLLISION');
                expect(commandExecService.executeCommand).toHaveBeenCalledWith(
                    expect.objectContaining({
                        sourcePath: `/base/job-collision-456/source-collision-2/source-dir/SHORTF~1/document.docx`,
                        targetPath: `/base/job-collision-456/target-collision-2/target-dir/SHORTF~1/document.docx`,
                        command: collisionCommand,
                        errorType: 'RECOVERABLE_ERROR' // Should be RECOVERABLE_ERROR under max retries
                    })
                );
            });

            it('should handle successful command execution on tilde paths', async () => {
                const successCommand = {
                    id: 'success-cmd',
                    fPath: '/LONGLO~1/success.txt',
                    status: CommandStatus.READY,
                    isDir: false,
                    ops: {},
                    metadata: {
                        size: 512,
                        mtime: new Date(),
                        atime: new Date(),
                        ctime: new Date(),
                        birthtime: new Date(),
                        mode: 644,
                        uid: 1000,
                        gid: 1000,
                        sid: 'success-sid',
                        inode: 123458
                    },
                    serialize: jest.fn(),
                };

                const taskWithTildePath = new TaskInfo(
                    'task-success-1',
                    'job-success-123',
                    TaskType.MIGRATE,
                    TaskStatus.RUNNING,
                    'test-worker-1',
                    'source-success',
                    [successCommand],
                    'target-success'
                );
                taskWithTildePath.retryCount = 0;

                const successResult = {
                    cmd: { ...successCommand, status: CommandStatus.COMPLETED },
                    sourceErrors: [],
                    targetErrors: [],
                    shouldStampMeta: true,
                    shouldUpdateItemInfo: true,
                };

                commandExecService.executeCommand.mockResolvedValue(successResult);

                const result = await service.executeSyncTask('task-hash-success', taskWithTildePath, mockJobContext);

                expect(result.status).toBe(TaskStatus.PENDING);
                expect(result.errors.source).toEqual([]);
                expect(result.errors.target).toEqual([]);
                expect(commandExecService.executeCommand).toHaveBeenCalledWith(
                    expect.objectContaining({
                        sourcePath: `/base/job-success-123/source-success/source-dir/LONGLO~1/success.txt`,
                        targetPath: `/base/job-success-123/target-success/target-dir/LONGLO~1/success.txt`,
                        command: successCommand,
                        errorType: 'RECOVERABLE_ERROR'
                    })
                );
            });

            it('should aggregate collision errors properly in batch processing', async () => {
                const commands = [
                    {
                        id: 'cmd-1',
                        fPath: '/NORMFI~1.txt',
                        status: CommandStatus.READY,
                        isDir: false,
                        ops: {},
                        metadata: {
                            size: 256,
                            mtime: new Date(),
                            atime: new Date(),
                            ctime: new Date(),
                            birthtime: new Date(),
                            mode: 644,
                            uid: 1000,
                            gid: 1000,
                            sid: 'batch-sid-1',
                            inode: 123459
                        },
                        serialize: jest.fn(),
                    },
                    {
                        id: 'cmd-2',
                        fPath: '/LONGLO~1/file.pdf',
                        status: CommandStatus.READY,
                        isDir: false,
                        ops: {},
                        metadata: {
                            size: 4096,
                            mtime: new Date(),
                            atime: new Date(),
                            ctime: new Date(),
                            birthtime: new Date(),
                            mode: 644,
                            uid: 1000,
                            gid: 1000,
                            sid: 'batch-sid-2',
                            inode: 123460
                        },
                        serialize: jest.fn(),
                    }
                ];

                const taskWithMultipleCommands = new TaskInfo(
                    'task-batch-1',
                    'job-batch-789',
                    TaskType.MIGRATE,
                    TaskStatus.RUNNING,
                    'test-worker-1',
                    'source-batch',
                    commands,
                    'target-batch'
                );
                taskWithMultipleCommands.retryCount = 2;

                // First command succeeds
                const successResult = {
                    cmd: { ...commands[0], status: CommandStatus.COMPLETED },
                    sourceErrors: [],
                    targetErrors: [],
                    shouldStampMeta: true,
                    shouldUpdateItemInfo: true,
                };

                // Second command has collision error
                const collisionResult = {
                    cmd: { ...commands[1], status: CommandStatus.ERROR },
                    sourceErrors: [],
                    targetErrors: ['E8DOT3_COLLISION'],
                    shouldStampMeta: false,
                    shouldUpdateItemInfo: false,
                };

                commandExecService.executeCommand
                    .mockResolvedValueOnce(successResult)
                    .mockResolvedValueOnce(collisionResult);

                const result = await service.executeSyncTask('task-hash-batch', taskWithMultipleCommands, mockJobContext);

                expect(result.status).toBe(TaskStatus.PENDING);
                expect(result.errors.target).toContain('E8DOT3_COLLISION');
                expect(commandExecService.executeCommand).toHaveBeenCalledTimes(2);
            });
        });
    });
});
