import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, Runtime } from '@temporalio/worker';
import { ValidateWorkerConnectionWorkflow } from './validate-worker-connection.workflow';
import { JobServiceJobType } from 'src/activities/common/enums';


const mockedActivities = {
  validate: jest.fn(),
};

describe('ValidateWorkerConnectionWorkflow', () => {
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
        Runtime.instance().shutdown(); // clean up native handles
        // workflowCoverage.mergeIntoGlobalCoverage();
    });

    beforeEach(async () => {
        jest.clearAllMocks();
    });

    it('should call validate activity', async () => {
        const jobRunId = 'test-job-run-id';
        const args = { jobRunId, traceId: 'test-trace-id', fileServer: { jobConfig: { jobType: JobServiceJobType.CUT_OVER }, protocols: ['NFS'] } };

        mockedActivities.validate.mockResolvedValue({ success: true });
        jest.spyOn(console, 'log').mockImplementation(() => {});

        worker = await Worker.create({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./validate-worker-connection.workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        });

        await worker.runUntil(async () => {
            const workflowHandle = await testEnv.client.workflow.start(ValidateWorkerConnectionWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: 'test-validate-workflow-id-1',
            });

            const result = await workflowHandle.result();
            expect(result[0].success).toBe(true);
            expect(mockedActivities.validate).toHaveBeenCalled();
        });
    }, 1000 * 60 * 2);
});