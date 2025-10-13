import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { RedisMemoryCheckWorkflow } from './redis.memorycheck.workflow';


jest.mock('@temporalio/workflow', () => ({
    ...jest.requireActual('@temporalio/workflow'),
    sleep: jest.fn(),
}));

const mockedActivities = {
    checkMemoryUsage: jest.fn(),
};

describe('RedisMemoryCheckWorkflow', () => {
    let testEnv: TestWorkflowEnvironment;
    let worker: Worker;

    beforeAll(async () => {
        try {
            testEnv = await TestWorkflowEnvironment.createTimeSkipping();
        } catch (error) {
            console.error('Error creating TestWorkflowEnvironment:', error);
        }
    }, 15000); // 15 second timeout

    afterAll(async () => {
        if (worker && ['RUNNING', 'STARTED'].includes(worker.getState())) {
            await worker.shutdown();
        }
        if (testEnv) {
            await testEnv.teardown();
        }
        // workflowCoverage.mergeIntoGlobalCoverage();
    });

    beforeEach(async () => {
        jest.clearAllMocks();
    });

    afterEach(async () => {
        if (!!worker && worker.getState() !== 'STOPPED') {
            await worker.shutdown();
        }
    });


    it('should return true if memory is ok', async () => {
        const args = { traceId: 'test-memory-check-workflow-1' }

        mockedActivities.checkMemoryUsage.mockReturnValue(true)

        worker = await Worker.create({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./redis.memorycheck.workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        });

        await worker.runUntil(async () => {
            const memoryCheckWorkflowHandle = await testEnv.client.workflow.start(RedisMemoryCheckWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: 'test-redis-memory-check-workflow-1',
            });

            const result = await memoryCheckWorkflowHandle.result();
            expect(result).toBe(true);
        });
    },1000 * 60 * 2);

    it('should retry and continue as new if memory is not ok', async () => {
        const args = { traceId: 'test-memory-check-workflow-2' }

        let checkCallCount = 0;
        mockedActivities.checkMemoryUsage.mockImplementation(() => {
            checkCallCount++;
            if (checkCallCount < 30) {
                return Promise.resolve(false);
            }
            return Promise.resolve(true);
        });

        worker = await Worker.create({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./redis.memorycheck.workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        });

        await worker.runUntil(async () => {
            const memoryCheckWorkflowHandle = await testEnv.client.workflow.start(RedisMemoryCheckWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: 'test-redis-memory-check-workflow-2',
            });

            const result = await memoryCheckWorkflowHandle.result();
             const { runId: firstRunId } = await memoryCheckWorkflowHandle.describe();

            // check if the workflow continued as new
            const isContinuedAsNew = memoryCheckWorkflowHandle.workflowId !== firstRunId;

            expect(result).toBe(true);
            expect(isContinuedAsNew).toBe(true);
            expect(checkCallCount).toBeGreaterThan(29);
        });
    },1000 * 60 * 2);
});