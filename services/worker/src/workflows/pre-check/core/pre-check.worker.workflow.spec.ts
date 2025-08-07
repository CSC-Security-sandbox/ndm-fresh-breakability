import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, Runtime } from '@temporalio/worker';
import { PreCheckWorkerValidationWorkflow } from './pre-check.worker.workflow';

const mockedActivities = {
    preCheckPath: jest.fn(),
}

describe('PreCheckWorkerValidationWorkflow', () => {
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

    it('should return paths with pre-check results', async () => {
        const workerId = 'test-worker-id';
        const workerTaskPayload: any = {
            serverPaths: [
                { isSource: true, serverId: 'source-server', path: '/source/path' },
                { isSource: false, serverId: 'dest-server', path: '/dest/path' }
            ],
            serverCredentials: [
                { id: 'source-server', userName: 'user1', password: 'pass1' },
                { id: 'dest-server', userName: 'user2', password: 'pass2' }
            ],
            settings: {}
        };
        const traceId = 'test-trace-id';

        mockedActivities.preCheckPath.mockResolvedValue([{
            isValid: true,
            message: 'Pre-check passed',
            serverId: 'source-server',
            path: '/source/path'
        }]);

        worker = await Worker.create({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./pre-check.worker.workflow'),
            activities: mockedActivities,
            taskQueue: 'pre-check-task-queue',
        });

        await worker.runUntil(async () => {
            const workflowHandle = await testEnv.client.workflow.start(PreCheckWorkerValidationWorkflow, {
                args: [workerId, workerTaskPayload, traceId],
                taskQueue: 'pre-check-task-queue',
                workflowId: traceId,
            });
            const result: any = await workflowHandle.result();
            console.log(result);
            expect(result.workerId).toBe(workerId);
            expect(result.paths).toHaveLength(2);
            expect(result.paths[0][0].isValid).toBe(true);
            expect(result.paths[0][0].message).toBe('Pre-check passed');
            expect(result.paths[0][0].serverId).toBe('source-server');
            expect(result.paths[0][0].path).toBe('/source/path');

            expect(result.paths[1][0].isValid).toBe(true);
            expect(result.paths[1][0].message).toBe('Pre-check passed');
            expect(result.paths[1][0].serverId).toBe('source-server');
            expect(result.paths[1][0].path).toBe('/source/path');
        });
    },1000 * 60 * 2);
});