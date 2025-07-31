import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CommandStatus, ErrorType, TaskStatus, TaskType, TaskInfo } from '@netapp-cloud-datamigrate/jobs-lib';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { Context } from '@temporalio/activity';
import { SyncService } from './sync-activity.service';
import { CommonTaskService } from '../common/common-task.service';
import { CommandExecService } from './command-execution/command-execution.service';
import { RedisService } from 'src/redis/redis.service';
import { FatalError, RetryableError, RetryExceededError } from 'src/errors/errors.types';
import { mockLogger } from 'src/auth/auth.service.spec';

// Mock the @temporalio/activity Context
jest.mock('@temporalio/activity', () => ({
    Context: {
        current: jest.fn(() => ({
            heartbeat: jest.fn(),
        })),
    },
}));

// Mock utils functions
jest.mock('src/activities/utils/utils', () => ({
    basePrefix: jest.fn((jobRunId, pathId) => `/base/${jobRunId}/${pathId}/`),
    isFatalError: jest.fn((error) => error === 'FATAL'),
    isSourceFatalError: jest.fn((error) => error === 'SOURCE_FATAL'),
}));

describe('SyncService', () => {
    let service: SyncService;
    let configService: jest.Mocked<ConfigService>;
    let loggerFactory: jest.Mocked<LoggerFactory>;
    let redisService: jest.Mocked<RedisService>;
    let commonTaskService: jest.Mocked<CommonTaskService>;
    let commandExecService: jest.Mocked<CommandExecService>;
    let mockJobContext: any;

    beforeEach(async () => {
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
        };

        redisService = {
            getJobManagerContext: jest.fn().mockResolvedValue(mockJobContext),
        } as any;

        commonTaskService = {
            ensureTaskValid: jest.fn(),
        } as any;

        commandExecService = {
            executeCommand: jest.fn(),
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
            expect(mockLogger.error).not.toHaveBeenCalled(); // FatalError should not be logged
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
    });
});
