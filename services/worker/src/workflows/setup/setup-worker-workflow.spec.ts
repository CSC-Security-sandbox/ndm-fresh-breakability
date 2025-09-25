import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { SetupWorkerWorkflow } from './setup-worker-workflow';
import { JobServiceJobType } from 'src/activities/common/enums';

// Mock WinShellService to prevent actual shell creation
jest.mock('src/activities/common/win-shell.service');

const mockedActivities = {
    setup: jest.fn(),
    speedTestSetup: jest.fn(),
};

describe('SetupWorkerWorkflow', () => {
    let testEnv: TestWorkflowEnvironment;
    let worker: Worker;

    beforeAll(async () => {
        try {
            testEnv = await TestWorkflowEnvironment.createTimeSkipping();
        } catch (e) {
            console.error('Error during test environment setup:', e);
            if (!!testEnv) {
                await testEnv.teardown();
            }
        }
    });

    afterAll(async () => {
        if (worker && ['RUNNING', 'STARTED'].includes(worker.getState())) {
            await worker?.shutdown();
        }
        await testEnv.teardown();
        // workflowCoverage.mergeIntoGlobalCoverage();
    });

    beforeEach(async () => {
        jest.clearAllMocks();
        
        // Reset mocks for each test
        mockedActivities.setup.mockReset();
        mockedActivities.speedTestSetup.mockReset();
    });

    it('should call setup activity for non-speed test jobs', async () => {
        const jobRunId = 'test-job-run-id';
        const args = { jobRunId, traceId: 'test-trace-id', fileServer: { jobConfig: { jobType: JobServiceJobType.CUT_OVER } } };

        mockedActivities.setup.mockResolvedValue({ success: true });

        worker = await Worker.create({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./setup-worker-workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        });

        await worker.runUntil(async () => {
            const workflowHandle = await testEnv.client.workflow.start(SetupWorkerWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: 'test-setup-workflow-id-1',
            });

            const result = await workflowHandle.result();
            expect(result).toEqual({ success: true });
            expect(mockedActivities.setup).toHaveBeenCalledWith(jobRunId);
        });
    }, 1000 * 60 * 2);

    it('should call speedTestSetup activity for speed test jobs', async () => {
        const jobRunId = 'test-job-run-id';
        const args = {
            jobRunId,
            traceId: 'test-trace-id',
            fileServer: { jobConfig: { jobType: JobServiceJobType.SPEED_TEST } },
            hostname: 'test-hostname',
            protocols: ['http'],
            pathId: 'test-path-id',
        };

        mockedActivities.speedTestSetup.mockResolvedValue({ success: true });

        worker = await Worker.create({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./setup-worker-workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        });

        await worker.runUntil(async () => {
            const workflowHandle = await testEnv.client.workflow.start(SetupWorkerWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: 'test-setup-workflow-id-2',
            });

            const result = await workflowHandle.result();
            expect(result).toEqual({ success: true });
            expect(mockedActivities.speedTestSetup).toHaveBeenCalled();
        });
    }, 1000 * 60 * 2);
});