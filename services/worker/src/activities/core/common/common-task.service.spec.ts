import { CommandStatus, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { RetryExceededError } from 'src/errors/errors.types';
import { CommonTaskService } from './common-task.service';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLogger } from 'src/auth/auth.service.spec';

const { Connection } = require('@temporalio/client');
const { calculateHash } = require('src/activities/utils/checksum-utils');

jest.mock('@temporalio/activity', () => ({
    Context: {
        current: jest.fn(() => ({
            heartbeat: jest.fn(),
        })),
    },
}));
jest.mock('@temporalio/client', () => ({
    Connection: {
        connect: jest.fn(),
    },
}));
jest.mock('src/utils/temporal.utils', () => ({
    buildTemporalConfig: jest.fn(),
    createClientConnection: jest.fn(),
}));
jest.mock('@temporalio/workflow', () => ({
    uuid4: jest.fn(() => 'mock-uuid'),
}));
jest.mock('../../utils/utils', () => ({
    buildTask: jest.fn((type, jobRunId, jobContext, commands) => ({
        id: 'mock-task-id',
        type,
        jobRunId,
        jobContext,
        commands,
        status: TaskStatus.PENDING,
    })),
    calculateCommandHash: jest.fn(() => 'mock-hash'),
}));

describe('CommonTaskService', () => {
    let service: CommonTaskService;
    let configService: any;
    let loggerFactory: LoggerFactory;
    let logger: Partial<LoggerService>;
    let redisService: any;
    let authService: any;

    const mockLoggerFactory: Partial<LoggerFactory> = {
        create: jest.fn().mockReturnValue(mockLogger),
    };
  
    beforeEach(() => {
        configService = {
            get: jest.fn((key) => {
                if (key === 'worker.workerId') return 'worker-1';
                if (key === 'worker.maxRetryCount') return 2;
                if (key === 'temporal.address') return 'localhost:7233';
                if (key === 'worker.maxCmdStreamLen') return 5000;
                return undefined;
            }),
        };
        logger = mockLogger;
        redisService = {
            getJobManagerContext: jest.fn(),
        };
        authService = {
            getAccessToken: jest.fn().mockResolvedValue('mock-token'),
        };
        service = new CommonTaskService(configService, mockLoggerFactory as LoggerFactory, redisService, authService);
    });

    describe('constructor', () => {
        it('should set workerId and maxRetryCount', () => {
            expect(service.workerId).toBe('worker-1');
            expect(service.maxRetryCount).toBe(2);
        });
    });


    describe('ensureTaskValid', () => {
        let jobContext: any;
        beforeEach(() => {
            jobContext = {
                publishToTaskStream: jest.fn(),
            };
        });

        it('should set commands to IN_PROCESS if not COMPLETED', async () => {
            const task = {
                id: 't1',
                commands: [
                    { retryCount: 0, status: CommandStatus.READY },
                    { retryCount: 1, status: CommandStatus.COMPLETED },
                ],
                status: TaskStatus.PENDING,
            };
            const result = await service.ensureTaskValid({ task, jobContext } as any);
            expect(result.commands[0].status).toBe(CommandStatus.IN_PROCESS);
            expect(result.commands[1].status).toBe(CommandStatus.COMPLETED);
            expect(result.status).toBe(TaskStatus.PENDING);
        });

        it('should throw RetryExceededError if retryCount >= maxRetryCount', async () => {
            const task = {
                id: 't2',
                commands: [
                    { retryCount: 2, status: CommandStatus.READY },
                ],
                retryCount: 2, // Set retryCount to equal maxRetryCount (2) to trigger the error
                status: TaskStatus.PENDING,
            };
            await expect(
                service.ensureTaskValid({ task, jobContext } as any)
            ).rejects.toThrow(RetryExceededError);
            expect(jobContext.publishToTaskStream).toHaveBeenCalledWith(task);
            expect(task.status).toBe(TaskStatus.ERRORED);
        });
    });

    describe('isWorkflowRunningActivity', () => {
        it('should return true if workflow is running', async () => {
            const { buildTemporalConfig, createClientConnection } = require('src/utils/temporal.utils');
            buildTemporalConfig.mockResolvedValue({ address: 'localhost:7233' });
            const mockDescribe = jest.fn().mockResolvedValue({
                workflowExecutionInfo: { status: 1 },
            });
            const mockConnection = {
                workflowService: {
                    describeWorkflowExecution: mockDescribe,
                },
                close: jest.fn().mockResolvedValue(undefined),
            };
            createClientConnection.mockResolvedValue(mockConnection);

            const result = await service.isWorkflowRunningActivity('wf-1');
            expect(result).toBe(true);
            expect(mockDescribe).toHaveBeenCalled();
            expect(mockConnection.close).toHaveBeenCalled();
        });

        it('should return false if workflow is not running', async () => {
            const { buildTemporalConfig, createClientConnection } = require('src/utils/temporal.utils');
            buildTemporalConfig.mockResolvedValue({ address: 'localhost:7233' });
            const mockDescribe = jest.fn().mockResolvedValue({
                workflowExecutionInfo: { status: 2 },
            });
            const mockConnection = {
                workflowService: {
                    describeWorkflowExecution: mockDescribe,
                },
                close: jest.fn().mockResolvedValue(undefined),
            };
            createClientConnection.mockResolvedValue(mockConnection);

            const result = await service.isWorkflowRunningActivity('wf-2');
            expect(result).toBe(false);
            expect(mockConnection.close).toHaveBeenCalled();
        });

        it('should return false if workflowExecutionInfo is undefined', async () => {
            const { buildTemporalConfig, createClientConnection } = require('src/utils/temporal.utils');
            buildTemporalConfig.mockResolvedValue({ address: 'localhost:7233' });
            const mockDescribe = jest.fn().mockResolvedValue({
            workflowExecutionInfo: undefined,
            });
            const mockConnection = {
            workflowService: {
                describeWorkflowExecution: mockDescribe,
            },
            close: jest.fn().mockResolvedValue(undefined),
            };
            createClientConnection.mockResolvedValue(mockConnection);

            const result = await service.isWorkflowRunningActivity('wf-3');
            expect(result).toBe(false);
            expect(mockConnection.close).toHaveBeenCalled();
        });

        it('should throw if createClientConnection fails', async () => {
            const { buildTemporalConfig, createClientConnection } = require('src/utils/temporal.utils');
            buildTemporalConfig.mockResolvedValue({ address: 'localhost:7233' });
            createClientConnection.mockRejectedValue(new Error('connection error'));
            await expect(service.isWorkflowRunningActivity('wf-err')).rejects.toThrow('connection error');
        });
        });

        describe('buildOrGetValidScanTask', () => {
        let jobContext: any;
        beforeEach(() => {
            jobContext = {
            getTask: jest.fn(),
            getBatchDir: jest.fn(),
            setTaskIfNotExists: jest.fn(),
            jobConfig: {
                workerIds: ['worker-1'],
                sourceFileServer: {
                pathId: 'source-path-id'
                },
                destinationFileServer: {
                pathId: 'dest-path-id'
                }
            }
            };
            service.ensureTaskValid = jest.fn(async ({ task }) => task);
        });

        it('should return existing task if found', async () => {
            const existingTask = { id: 'existing', commands: [] };
            jobContext.getTask.mockResolvedValue(existingTask);

            const result = await service.buildOrGetValidScanTask({
            jobContext,
            taskHashId: 'hash1',
            jobRunId: 'job1',
            preBatchedId: undefined,
            } as any);

            expect(result).toBe(existingTask);
            expect(jobContext.getTask).toHaveBeenCalledWith('hash1');
            expect(jobContext.getBatchDir).not.toHaveBeenCalled();
        });

        it('should create new task from batch if not found', async () => {
            jobContext.getTask.mockResolvedValue(undefined);
            jobContext.getBatchDir.mockResolvedValue(['dir1', 'dir2']);
            jobContext.setTaskIfNotExists.mockResolvedValue(undefined);

            const result = await service.buildOrGetValidScanTask({
            jobContext,
            taskHashId: 'hash2',
            jobRunId: 'job2',
            batchId: 'batch1',
            } as any);

            expect(jobContext.getBatchDir).toHaveBeenCalledWith('batch1');
            expect(jobContext.setTaskIfNotExists).toHaveBeenCalled();
            expect(result).toHaveProperty('commands');
        });

        it('should call setTaskIfNotExists even if batch is undefined', async () => {
            jobContext.getTask.mockResolvedValue(undefined);
            jobContext.getBatchDir.mockResolvedValue(undefined);
            jobContext.setTaskIfNotExists.mockResolvedValue(undefined);

            await service.buildOrGetValidScanTask({
            jobContext,
            taskHashId: 'hash3',
            jobRunId: 'job3',
            batchId: 'batch2',
            } as any);

            expect(jobContext.setTaskIfNotExists).toHaveBeenCalled();
        });

    });

    describe('getGroupOfTasksActivity', () => {
        let jobContext: any;
        let groupReadCommandStreamMock: any;
        let setTaskIfNotExistsMock: any;
        let groupAckCommandStreamMock: any;

        beforeEach(() => {
            jest.useFakeTimers();
            groupReadCommandStreamMock = async function* () {
                yield { data: { id: 'cmd1' }, id: 'stream1' };
                yield { data: { id: 'cmd2' }, id: 'stream2' };
            };
            setTaskIfNotExistsMock = jest.fn();
            groupAckCommandStreamMock = jest.fn();
            jobContext = {
                groupReadCommandStream: groupReadCommandStreamMock,
                setTaskIfNotExists: setTaskIfNotExistsMock,
                groupAckCommandStream: groupAckCommandStreamMock,
                jobConfig: {
                    workerIds: ['worker-1'],
                    sourceFileServer: {
                        pathId: 'source-path-id'
                    },
                    destinationFileServer: {
                        pathId: 'dest-path-id'
                    }
                }
            };
            redisService.getJobManagerContext.mockResolvedValue(jobContext);
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should create tasks and return their hash keys', async () => {
            const result = await service.getGroupOfTasksActivity('jobRunId');
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBeGreaterThan(0);
            expect(setTaskIfNotExistsMock).toHaveBeenCalled();
            expect(groupAckCommandStreamMock).toHaveBeenCalledWith(['stream1', 'stream2'], expect.anything());
        });

        it('should handle error and clear interval', async () => {
            redisService.getJobManagerContext.mockRejectedValueOnce(new Error('fail'));
            await expect(service.getGroupOfTasksActivity('jobRunId')).rejects.toThrow('Failed to get group of tasks activity: fail');
        });
    });

    describe('isCmdStreamLenValid', () => {
        it('should return true when current stream length is within max', async () => {
            const jobContext = { getCmdStreamLen: jest.fn().mockResolvedValue(100) };
            redisService.getJobManagerContext.mockResolvedValue(jobContext);

            const result = await service.isCmdStreamLenValid('job-123');

            expect(result).toBe(true);
            expect(jobContext.getCmdStreamLen).toHaveBeenCalled();
        });

        it('should return false when current stream length exceeds max', async () => {
            const jobContext = { getCmdStreamLen: jest.fn().mockResolvedValue(10000) };
            redisService.getJobManagerContext.mockResolvedValue(jobContext);

            const result = await service.isCmdStreamLenValid('job-456');

            expect(result).toBe(false);
            expect(jobContext.getCmdStreamLen).toHaveBeenCalled();
        });

        it('should return true when current stream length equals max', async () => {
            const jobContext = { getCmdStreamLen: jest.fn().mockResolvedValue(5000) };
            redisService.getJobManagerContext.mockResolvedValue(jobContext);

            const result = await service.isCmdStreamLenValid('job-eq');

            expect(result).toBe(true);
        });
    });
});