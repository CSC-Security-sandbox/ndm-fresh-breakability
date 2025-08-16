import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { CleanupWorkerWorkflow } from './cleanup-worker-workflow'
import { JobServiceJobType } from 'src/activities/common/enums';


const mockedActivities = {
    cleanup: jest.fn(),
    speedTestCleanup: jest.fn()
};

describe('CleanupWorkerWorkflow', () => {
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
    });

    it('should call cleanup activity for non-speed test jobs', async () => {
        const jobRunId = 'test-job-run-id';
        const args = { jobRunId, traceId: 'test-trace-id', fileServer: { jobConfig: { jobType: JobServiceJobType.CUT_OVER } } };

        mockedActivities.cleanup.mockResolvedValue({ success: true });

        worker = await Worker.create({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./cleanup-worker-workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        });

        await worker.runUntil(async () => {
            const workflowHandle = await testEnv.client.workflow.start(CleanupWorkerWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: 'test-cleanup-workflow-id-1',
            });

            const result = await workflowHandle.result();
            expect(result).toEqual({ success: true });
            expect(mockedActivities.cleanup).toHaveBeenCalledWith(jobRunId);
        });
    }, 1000 * 60 * 2);

    it('should call speedTestCleanup activity for speed test jobs', async () => {
        const jobRunId = 'test-job-run-id';
        const fsDetails = { jobConfig: { jobType: JobServiceJobType.SPEED_TEST } };
        const protocolType = 'test-protocol-type';
        const args = { jobRunId, traceId: 'test-trace-id', fsDetails, jobType: fsDetails.jobConfig.jobType, protocolType };

        mockedActivities.speedTestCleanup.mockResolvedValue({ success: true });

        worker = await Worker.create({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./cleanup-worker-workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        });

        await worker.runUntil(async () => {
            const workflowHandle = await testEnv.client.workflow.start(CleanupWorkerWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: 'test-cleanup-workflow-id-2',
            });

            const result = await workflowHandle.result();
            expect(result).toEqual({ success: true });
            expect(mockedActivities.speedTestCleanup).toHaveBeenCalled();
            expect(mockedActivities.speedTestCleanup).toHaveBeenCalledWith(jobRunId, fsDetails, protocolType);
        });
    }, 1000 * 60 * 2);
});