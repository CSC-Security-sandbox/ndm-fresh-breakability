import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { SyncWorkflow, syncWorkerListSignal, isScanCompletedSignal } from './sync.workflow';
import { WorkflowCoverage } from '@temporalio/nyc-test-coverage';
import { JobRunStatus } from 'src/activities/discovery/enums';

const workflowCoverage = new WorkflowCoverage();

const mockedActivities = {
    syncTask: jest.fn(),
    updateStatus: jest.fn(),
    updateLastEntry: jest.fn(),
    getJobState: jest.fn(),
    setJobState: jest.fn(),
    getJobStateAndUpdateTaskList: jest.fn(),
    hasRunningSyncTask: jest.fn()
}

describe('SyncWorkflow', () => {
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
    
    it('should handle syncWorkerListSignal', async () => {
        const args = {
            jobRunId: 'test-job-run-id',
            workers: ['worker1'],
            failedWorkers: [],
            isScanCompleted: false
        }

        mockedActivities.getJobStateAndUpdateTaskList.mockResolvedValue({
            status: JobRunStatus.Running
        });

        let syncCallCount = 0;
        mockedActivities.syncTask.mockImplementation(() => {
            syncCallCount++;
            if(syncCallCount < 10) {
                return Promise.resolve({
                    isFatal: false,
                    noTaskFound: false,
                });
            } else {
                mockedActivities.hasRunningSyncTask.mockResolvedValue(false);
                return Promise.resolve({
                    isFatal: false,
                    noTaskFound: true,
                });
            }
        });

        worker = await Worker.create(workflowCoverage.augmentWorkerOptions({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./sync.workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        }));

        await worker.runUntil(async () => {
            const syncWorkflowHandle = await testEnv.client.workflow.start(SyncWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: 'test-sync-workflow-1',
            });

            await syncWorkflowHandle.signal(syncWorkerListSignal, ['worker2', 'worker3']);
            await syncWorkflowHandle.signal(isScanCompletedSignal);

            const result = await syncWorkflowHandle.result();
            expect(result.status).toBe(JobRunStatus.Completed);
            expect(result.workers).toContain('worker1');
            expect(result.workers).toContain('worker2');
            expect(result.workers).toContain('worker3');
            expect(result.failedWorkers).toEqual([]);
        });
    }, 1000 * 60 * 2);

    it('should handle isScanCompletedSignal', async () => {
        const args = {
            jobRunId: 'test-job-run-id',
            workers: ['worker1'],
            failedWorkers: [],
            isScanCompleted: false
        }

        mockedActivities.getJobStateAndUpdateTaskList.mockResolvedValue({
            status: JobRunStatus.Running
        });

        worker = await Worker.create(workflowCoverage.augmentWorkerOptions({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./sync.workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        }));

        await worker.runUntil(async () => {
            const syncWorkflowHandle = await testEnv.client.workflow.start(SyncWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: 'test-sync-workflow-2',
            });

            await syncWorkflowHandle.signal(isScanCompletedSignal);

            const result = await syncWorkflowHandle.result();
            expect(result.status).toBe(JobRunStatus.Completed);
        });
    }, 1000 * 60 * 2);

    it('should return stopped status when job is stopped', async () => {
        const args = {
            jobRunId: 'test-job-run-id',
            workers: ['worker1'],
            failedWorkers: [],
            isScanCompleted: false
        }

        mockedActivities.getJobStateAndUpdateTaskList.mockResolvedValue({
            status: JobRunStatus.Stopped
        });

        worker = await Worker.create(workflowCoverage.augmentWorkerOptions({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./sync.workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        }));

        await worker.runUntil(async () => {
            const syncWorkflowHandle = await testEnv.client.workflow.start(SyncWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: 'test-sync-workflow-3',
            });

            const result = await syncWorkflowHandle.result();
            expect(result.status).toBe(JobRunStatus.Stopped);
        });
    });

    it('should return paused status when job is paused', async () => {
        const args = {
            jobRunId: 'test-job-run-id',
            workers: ['worker1'],
            failedWorkers: [],
            isScanCompleted: false
        }

        mockedActivities.getJobStateAndUpdateTaskList.mockResolvedValue({
            status: JobRunStatus.Paused
        });

        worker = await Worker.create(workflowCoverage.augmentWorkerOptions({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./sync.workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        }));

        await worker.runUntil(async () => {
            const syncWorkflowHandle = await testEnv.client.workflow.start(SyncWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: 'test-sync-workflow-4',
            });

            const result = await syncWorkflowHandle.result();
            expect(result.status).toBe(JobRunStatus.Paused);
        });
    });

    it('should handle continueAsNew scenario', async () => {
        const args = {
            jobRunId: 'test-job-run-id',
            workers: ['worker1'],
            failedWorkers: [],
            isScanCompleted: false
        }

        mockedActivities.getJobStateAndUpdateTaskList.mockResolvedValue({
            status: JobRunStatus.Running
        });

        let syncCallCount = 0;
        mockedActivities.syncTask.mockImplementation(() => {
            syncCallCount++;
            if(syncCallCount < 110) {
                return Promise.resolve({
                    isFatal: false,
                    noTaskFound: false,
                });
            } else {
                mockedActivities.hasRunningSyncTask.mockResolvedValue(false);
                return Promise.resolve({
                    isFatal: false,
                    noTaskFound: true,
                });
            }
        });

        worker = await Worker.create(workflowCoverage.augmentWorkerOptions({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./sync.workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        }));

        await worker.runUntil(async () => {
            const syncWorkflowHandle = await testEnv.client.workflow.start(SyncWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: 'test-sync-workflow-5',
            });

            await syncWorkflowHandle.signal(isScanCompletedSignal);

            const result = await syncWorkflowHandle.result();
            const { runId: firstRunId } = await syncWorkflowHandle.describe();

            // check if the workflow continued as new
            const isContinuedAsNew = syncWorkflowHandle.workflowId !== firstRunId;

            expect(result.status).toBe(JobRunStatus.Completed);
            expect(result.workers).toContain('worker1');
            expect(result.failedWorkers).toEqual([]);
            expect(isContinuedAsNew).toBe(true);
            expect(syncCallCount).toBeGreaterThan(110);
        });
    }, 1000 * 60 * 2);

    it('should handle multiple workers syncing', async () => {
        const args = {
            jobRunId: 'test-job-run-id',
            workers: ['worker1', 'worker2'],
            failedWorkers: [],
            isScanCompleted: false
        }

        mockedActivities.getJobStateAndUpdateTaskList.mockResolvedValue({
            status: JobRunStatus.Running
        });

        let syncCallCount = 0;
        mockedActivities.syncTask.mockImplementation(() => {
            syncCallCount++;
            if(syncCallCount < 10) {
                return Promise.resolve({
                    isFatal: false,
                    noTaskFound: false,
                });
            } else {
                mockedActivities.hasRunningSyncTask.mockResolvedValue(false);
                return Promise.resolve({
                    isFatal: false,
                    noTaskFound: true,
                });
            }
        });

        worker = await Worker.create(workflowCoverage.augmentWorkerOptions({
            connection: testEnv.nativeConnection,
            workflowsPath: require.resolve('./sync.workflow'),
            activities: mockedActivities,
            taskQueue: 'test-task-queue',
        }));

        await worker.runUntil(async () => {
            const syncWorkflowHandle = await testEnv.client.workflow.start(SyncWorkflow, {
                args: [args],
                taskQueue: 'test-task-queue',
                workflowId: 'test-sync-workflow-6',
            });

            await syncWorkflowHandle.signal(isScanCompletedSignal);

            const result = await syncWorkflowHandle.result();
            const { runId: firstRunId } = await syncWorkflowHandle.describe();

            // check if the workflow continued as new
            const isContinuedAsNew = syncWorkflowHandle.workflowId !== firstRunId;

            expect(result.status).toBe(JobRunStatus.Completed);
            expect(result.workers).toContain('worker1');
            expect(result.workers).toContain('worker2');
            expect(result.failedWorkers).toEqual([]);
            expect(isContinuedAsNew).toBe(true);
            expect(syncCallCount).toBeGreaterThan(10);
        });
    });
});