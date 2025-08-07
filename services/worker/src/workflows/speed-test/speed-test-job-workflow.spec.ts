import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, Runtime } from '@temporalio/worker';
import { temporal } from '@temporalio/proto';
import { SpeedTestJobWorkflow } from './speed-test-job-workflow';
import { JobRunStatus } from 'src/activities/common/enums';


const mockedActivities = {
    readActivity: jest.fn(),
    writeActivity: jest.fn(),
    networkPerformanceActivity: jest.fn(),
    postResultsActivity: jest.fn(),
    updateStatus: jest.fn(),
    getJobState: jest.fn(),
}

describe('SpeedTestJobWorkflow', () => {
    let testEnv: TestWorkflowEnvironment;
    let worker: Worker;

    beforeAll(async () => {
        try {
            testEnv = await TestWorkflowEnvironment.createTimeSkipping();
        } catch (e) {
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

    it('should return message when job status is not running', async () => {
        const traceId = 'test-trace-id';
        const options = {};
        const workerId = 'test-worker-id';
        const volumeId = 'test-volume-id';
        const tests = { writeTest: true, readTest: true, networkPerformance: true };

        mockedActivities.getJobState.mockResolvedValue({
            status: JobRunStatus.Completed
        });

        mockedActivities.updateStatus.mockResolvedValue({});

        worker = await Worker.create({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./speed-test-job-workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        });

        // await worker.runUntil(async () => {
        //     const workflowHandle = await testEnv.client.workflow.start(SpeedTestJobWorkflow, {
        //         args: [{ traceId, options, workerId, volumeId, tests }],
        //         taskQueue: 'test-task-queue',
        //         workflowId: traceId,
        //     });
        //     const result = await workflowHandle.result();
        //     expect(result).toEqual({ message: 'Job status changed to COMPLETED' });
        //     expect(mockedActivities.updateStatus).toHaveBeenCalled();
        // });
    },1000 * 60 * 2);

    it('should write test results when writeTest is true', async () => {
        const args = {
            traceId: 'test-trace-id',
            options: {},
            workerId: 'test-worker-id',
            volumeId: 'test-volume-id',
            tests: { writeTest: true }
        }

        mockedActivities.updateStatus.mockResolvedValue({});

        mockedActivities.getJobState.mockResolvedValue({
            status: JobRunStatus.Running
        });

        mockedActivities.writeActivity.mockResolvedValue({
            speed: 100,
            latency: 10,
            status: 'success'
        });

        mockedActivities.postResultsActivity.mockResolvedValue({
            writeResultId: 'write-result-id',
            readResultId: 'read-result-id'
        });

        worker = await Worker.create({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./speed-test-job-workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        });

        await worker.runUntil(async () => {
            const workflowHandle = await testEnv.client.workflow.start(SpeedTestJobWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: args.traceId,
            });
            const result = await workflowHandle.result();
            expect(mockedActivities.writeActivity).toHaveBeenCalled();
        });
    },1000 * 60 * 2);

    it('should read test results when readTest is true', async () => {
        const args = {
            traceId: 'test-trace-id',
            options: {},
            workerId: 'test-worker-id',
            volumeId: 'test-volume-id',
            tests: { readTest: true }
        }

        mockedActivities.updateStatus.mockResolvedValue({});

        mockedActivities.getJobState.mockResolvedValue({
            status: JobRunStatus.Running
        });

        mockedActivities.readActivity.mockResolvedValue({
            speed: 100,
            latency: 10,
            status: 'success'
        });

        mockedActivities.postResultsActivity.mockResolvedValue({
            writeResultId: 'write-result-id',
            readResultId: 'read-result-id'
        });

        worker = await Worker.create({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./speed-test-job-workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        });

        await worker.runUntil(async () => {
            const workflowHandle = await testEnv.client.workflow.start(SpeedTestJobWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: args.traceId,
            });
            const result = await workflowHandle.result();
            expect(mockedActivities.readActivity).toHaveBeenCalled();
        });
    },1000 * 60 * 2);

    it('should perform network performance test when networkPerformance is true', async () => {
        const args = {
            traceId: 'test-trace-id',
            options: {},
            workerId: 'test-worker-id',
            volumeId: 'test-volume-id',
            tests: { networkPerformance: true }
        }

        mockedActivities.updateStatus.mockResolvedValue({});

        mockedActivities.getJobState.mockResolvedValue({
            status: JobRunStatus.Running
        });

        mockedActivities.networkPerformanceActivity.mockResolvedValue({
            speed: 100,
            latency: 10,
            status: 'success'
        });

        mockedActivities.postResultsActivity.mockResolvedValue({
            writeResultId: 'write-result-id',
            readResultId: 'read-result-id'
        });

        worker = await Worker.create({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./speed-test-job-workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        });

        await worker.runUntil(async () => {
            const workflowHandle = await testEnv.client.workflow.start(SpeedTestJobWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: args.traceId,
            });
            const result = await workflowHandle.result();
            expect(mockedActivities.networkPerformanceActivity).toHaveBeenCalled();
        });
    },1000 * 60 * 2);

    it('should handle activity errors gracefully', async () => {
        const args = {
            traceId: 'test-trace-id',
            options: {},
            workerId: 'test-worker-id',
            volumeId: 'test-volume-id',
            tests: { }
        }

        mockedActivities.updateStatus.mockResolvedValue({});
        mockedActivities.getJobState.mockResolvedValue({
            status: JobRunStatus.Running
        });

        let callCount = 0;
        mockedActivities.postResultsActivity.mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                return Promise.resolve({
                    writeResultId: 'dummy-write-id',
                    readResultId: 'dummy-read-id'
                });
            } else {
                return Promise.reject(new Error('Post results failed'));
            }
        });

        mockedActivities.writeActivity.mockResolvedValue({});
        mockedActivities.readActivity.mockResolvedValue({});
        mockedActivities.networkPerformanceActivity.mockResolvedValue({});

        worker = await Worker.create({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./speed-test-job-workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        });

        await worker.runUntil(async () => {
            const workflowHandle = await testEnv.client.workflow.start(SpeedTestJobWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: args.traceId,
            });
            const result = await workflowHandle.result();
            expect(result.message).toBe('Speed test failed');
        });
    },1000 * 60 * 2);
});