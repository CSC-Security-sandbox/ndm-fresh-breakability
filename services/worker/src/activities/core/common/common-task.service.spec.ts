import { CommandStatus, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { RetryExceededError } from 'src/errors/errors.types';
import { CommonTaskService } from './common-task.service';
const { Connection } = require('@temporalio/client');

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

    describe('buildOrGetValidScanTask', () => {
        let jobContext: any;
        beforeEach(() => {
            jobContext = {
                getTask: jest.fn(),
                setTaskIfNotExists: jest.fn(),
            };
        });

        it('should return existing task if found', async () => {
            const task = { id: 't1', commands: [], status: TaskStatus.PENDING };
            jobContext.getTask.mockResolvedValue(task);
            service.ensureTaskValid = jest.fn().mockResolvedValue(task);

            const result = await service.buildOrGetValidScanTask({
                dirToScans: [],
                jobContext,
                taskHashId: 'hash',
                jobRunId: 'job',
            });
            expect(result).toBe(task);
            expect(jobContext.setTaskIfNotExists).not.toHaveBeenCalled();
        });

        it('should create and return new task if not found', async () => {
            jobContext.getTask.mockResolvedValue(undefined);
            jobContext.setTaskIfNotExists.mockResolvedValue(undefined);
            service.ensureTaskValid = jest.fn().mockResolvedValue({ id: 't2' });

            const result = await service.buildOrGetValidScanTask({
                dirToScans: ['a', 'b'],
                jobContext,
                taskHashId: 'hash',
                jobRunId: 'job',
            });
            expect(jobContext.setTaskIfNotExists).toHaveBeenCalled();
            expect(result).toEqual({ id: 't2' });
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
    });
});