import { CommandStatus, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { RetryExceededError } from 'src/errors/errors.types';
import { CommonTaskService } from './common-task.service';
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
    let logger: any;
    let redisService: any;

    beforeEach(() => {
        configService = {
            get: jest.fn((key) => {
                if (key === 'worker.workerId') return 'worker-1';
                if (key === 'worker.maxRetryCount') return 2;
                return undefined;
            }),
        };
        logger = {
            debug: jest.fn(),
            error: jest.fn(),
        };
        redisService = {
            getJobManagerContext: jest.fn(),
        };
        service = new CommonTaskService(configService, logger, redisService);
    });

    describe('constructor', () => {
        it('should set workerId and maxRetryCount', () => {
            expect(service.workerId).toBe('worker-1');
            expect(service.maxRetryCount).toBe(2);
        });
    });

    describe('getGroupOfTasksActivity', () => {
        let jobContext: any;
        beforeEach(() => {
            jobContext = {
                groupReadCommandStream: jest.fn(),
                setTaskIfNotExists: jest.fn(),
                groupAckCommandStream: jest.fn(),
            };
            redisService.getJobManagerContext.mockResolvedValue(jobContext);
        });

        it('should process commands and return taskIds', async () => {
            // Simulate async generator
            const commands = Array.from({ length: 105 }, (_, i) => ({
                data: { id: i, retryCount: 0, status: CommandStatus.READY },
                id: `stream-${i}`,
            }));
            jobContext.groupReadCommandStream.mockImplementation(async function* () {
                for (const cmd of commands) yield cmd;
            });
            jobContext.setTaskIfNotExists.mockResolvedValue(undefined);
            jobContext.groupAckCommandStream.mockResolvedValue(undefined);

            const result = await service.getGroupOfTasksActivity('jobRunId');
            // Should create 2 tasks (100 + 5)
            expect(result).toEqual(['mock-hash', 'mock-hash']);
            expect(jobContext.setTaskIfNotExists).toHaveBeenCalledTimes(2);
            expect(jobContext.groupAckCommandStream).toHaveBeenCalledWith(
                expect.any(Array),
                expect.anything()
            );
        });

        it('should handle errors and clear interval', async () => {
            redisService.getJobManagerContext.mockRejectedValue(new Error('fail'));
            await expect(service.getGroupOfTasksActivity('jobRunId')).rejects.toThrow(
                /Failed to get group of tasks activity/
            );
            expect(logger.error).toHaveBeenCalled();
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
            const mockDescribe = jest.fn().mockResolvedValue({
                workflowExecutionInfo: { status: 1 },
            });
            const mockConnection = {
                workflowService: {
                    describeWorkflowExecution: mockDescribe,
                },
            };
            Connection.connect.mockResolvedValue(mockConnection);

            const result = await service.isWorkflowRunningActivity('wf-1');
            expect(result).toBe(true);
            expect(mockDescribe).toHaveBeenCalled();
        });

        it('should return false if workflow is not running', async () => {
            const mockDescribe = jest.fn().mockResolvedValue({
                workflowExecutionInfo: { status: 2 },
            });
            const mockConnection = {
                workflowService: {
                    describeWorkflowExecution: mockDescribe,
                },
            };
            Connection.connect.mockResolvedValue(mockConnection);

            const result = await service.isWorkflowRunningActivity('wf-2');
            expect(result).toBe(false);
        });

        it('should return false if workflowExecutionInfo is undefined', async () => {
            const mockDescribe = jest.fn().mockResolvedValue({
            workflowExecutionInfo: undefined,
            });
            const mockConnection = {
            workflowService: {
                describeWorkflowExecution: mockDescribe,
            },
            };
            Connection.connect.mockResolvedValue(mockConnection);

            const result = await service.isWorkflowRunningActivity('wf-3');
            expect(result).toBe(false);
        });

        it('should throw if Connection.connect fails', async () => {
            Connection.connect.mockRejectedValue(new Error('connection error'));
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
            preBatchedId: 'batch1',
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
            preBatchedId: 'batch2',
            } as any);

            expect(jobContext.setTaskIfNotExists).toHaveBeenCalled();
        });
        });
});