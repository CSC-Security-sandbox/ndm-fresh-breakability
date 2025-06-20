import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { WorkflowCoverage } from '@temporalio/nyc-test-coverage';
import { ReportingWorkflow, isReportedQuery } from './reporting.workflow';
import { JobReportType } from './reporting.types';
import * as wf from '@temporalio/workflow';

const workflowCoverage = new WorkflowCoverage();

const mockedActivities = {
    generateDiscoveryReport: jest.fn(),
    generateCOCReport: jest.fn(),
    updateStatus: jest.fn(),
    generateJobsReport: jest.fn(),
};

describe('ReportingWorkflow', () => {
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
        workflowCoverage.mergeIntoGlobalCoverage();
    });

    beforeEach(async () => {
        jest.clearAllMocks();
    });

    it('should handle DISCOVER report type', async () => {
        const traceId = 'test-discover-report-workflow-1';
        const signalDefinition = wf.defineSignal<[string]>('signal');

        worker = await Worker.create(workflowCoverage.augmentWorkerOptions({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./reporting.workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        }));


        await worker.runUntil(async () => {
            const reportingWorkflowHandle = await testEnv.client.workflow.start(ReportingWorkflow, {
                args: [traceId, signalDefinition, false],
                taskQueue: 'test-task-queue',
                workflowId: traceId,
            });
            await reportingWorkflowHandle.signal(signalDefinition, JobReportType.DISCOVER);
            const result = await reportingWorkflowHandle.result();

            expect(result).toBe('REPORTING COMPLETED');
            expect(mockedActivities.generateDiscoveryReport).toHaveBeenCalledWith(traceId);
            expect(mockedActivities.updateStatus).toHaveBeenCalledWith({ jobRunId: traceId, status: 'COMPLETED' });
        });
    }, 1000 * 60 * 2);

    it('should handle CUT_OVER report type', async () => {
        const traceId = 'test-cutover-report-workflow-1';
        const signalDefinition = wf.defineSignal<[string]>('signal');

        worker = await Worker.create(workflowCoverage.augmentWorkerOptions({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./reporting.workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        }));

        await worker.runUntil(async () => {
            const reportingWorkflowHandle = await testEnv.client.workflow.start(ReportingWorkflow, {
                args: [traceId, signalDefinition, false],
                taskQueue: 'test-task-queue',
                workflowId: traceId,
            });
            await reportingWorkflowHandle.signal(signalDefinition, JobReportType.CUT_OVER);
            const result = await reportingWorkflowHandle.result();

            expect(result).toBe('REPORTING COMPLETED');
            expect(mockedActivities.generateCOCReport).toHaveBeenCalledWith(traceId);
            expect(mockedActivities.updateStatus).toHaveBeenCalledWith({ jobRunId: traceId, status: 'BLOCKED' });
            expect(mockedActivities.generateJobsReport).toHaveBeenCalledWith(traceId);
        });
    },1000 * 60 * 2);

    it('should handle MIGRATE report type', async () => {
        const traceId = 'test-migrate-report-workflow-1';
        const signalDefinition = wf.defineSignal<[string]>('signal');

        worker = await Worker.create(workflowCoverage.augmentWorkerOptions({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./reporting.workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        }));

        await worker.runUntil(async () => {
            const reportingWorkflowHandle = await testEnv.client.workflow.start(ReportingWorkflow, {
                args: [traceId, signalDefinition, false],
                taskQueue: 'test-task-queue',
                workflowId: traceId,
            });
            await reportingWorkflowHandle.signal(signalDefinition, JobReportType.MIGRATE);
            const result = await reportingWorkflowHandle.result();

            expect(result).toBe('REPORTING COMPLETED');
            expect(mockedActivities.generateCOCReport).toHaveBeenCalledWith(traceId);
            expect(mockedActivities.updateStatus).toHaveBeenCalledWith({ jobRunId: traceId, status: 'COMPLETED' });
        });
    },1000 * 60 * 2);

    it('should handle error case', async () => {
        const traceId = 'test-error-report-workflow-1';
        const signalDefinition = wf.defineSignal<[string]>('signal');

        worker = await Worker.create(workflowCoverage.augmentWorkerOptions({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./reporting.workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        }));

        await worker.runUntil(async () => {
            const reportingWorkflowHandle = await testEnv.client.workflow.start(ReportingWorkflow, {
                args: [traceId, signalDefinition, true],
                taskQueue: 'test-task-queue',
                workflowId: traceId,
            });
            await reportingWorkflowHandle.signal(signalDefinition, JobReportType.CUT_OVER);
            const result = await reportingWorkflowHandle.result();

            expect(result).toBe('REPORTING COMPLETED');
            expect(mockedActivities.generateCOCReport).toHaveBeenCalledWith(traceId);
            expect(mockedActivities.updateStatus).toHaveBeenCalledWith({ jobRunId: traceId, status: 'ERRORED' });
        });
    },1000 * 60 * 2);
});