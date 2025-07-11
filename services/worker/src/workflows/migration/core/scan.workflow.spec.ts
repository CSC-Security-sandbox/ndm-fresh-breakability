import { JobRunStatus } from 'src/activities/discovery/enums';
import { ScanWorkflow, syncWorkerListSignal } from './scan.workflow';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { temporal } from '@temporalio/proto';


const mockedActivities = {
    scanPath: jest.fn(),
    publishScanTask: jest.fn(),
    getJobState: jest.fn(),
    updateStatus: jest.fn(),
    setJobState: jest.fn(),
    updateLastEntry: jest.fn(),
    getJobStateWithStreamLoad: jest.fn(),
    hasRunningScanTask: jest.fn(),
}

describe('ScanWorkflow', () => {
    let env: TestWorkflowEnvironment;
    let worker: Worker;

    beforeAll(async () => {
        try {
            env = await TestWorkflowEnvironment.createTimeSkipping();
        } catch (e) {
            console.error('Error during test environment setup:', e);
            if (!!env) {
                await env.teardown();
            }
        }
    });

    afterAll(async () => {
        if (worker && ['RUNNING', 'STARTED'].includes(worker.getState())) {
            await worker?.shutdown();
        }
        await env.teardown();
        // workflowCoverage.mergeIntoGlobalCoverage();
    });

    beforeEach(async () => {
        jest.clearAllMocks();
    });

    it('should handle syncWorkerListSignal correctly', async () => {
        const args = {
            jobRunId: 'test-job-run-id',
            workers: ['worker1'],
            failedWorkers: []
        }

        mockedActivities.getJobState.mockResolvedValue({
            status: JobRunStatus.Running,
        });

        mockedActivities.getJobStateWithStreamLoad.mockResolvedValue({
            jobRunState: {
                status: JobRunStatus.Running,
            },
            isStreamOverloaded: false
        });

        let scanCallCount = 0;
        mockedActivities.scanPath.mockImplementation(() => {
            scanCallCount++;
            if(scanCallCount < 50) {
                return Promise.resolve({
                    isFatalErrored: false,
                    noTaskFound: false,
                    files: 0,
                    folders: 0
                });
            } else {
                return Promise.resolve({
                    isFatalErrored: false,
                    noTaskFound: true,
                    files: 0,
                    folders: 0
                });
            }
        })

        mockedActivities.publishScanTask.mockResolvedValue({
            jobRunId: args.jobRunId,
            status: 'success',
            message: 'Task published successfully'
        });

        worker = await Worker.create({
            connection: env.nativeConnection,
            workflowsPath: require.resolve('./scan.workflow'),
            activities: mockedActivities,
            taskQueue: 'scan-task-queue'
        });

        await worker.runUntil(async () => {
            const scanWorkflow = await env.client.workflow.start(ScanWorkflow, {
                args: [args],
                taskQueue: 'scan-task-queue',
                workflowId: 'scan-workflow-test'
            });

            await scanWorkflow.signal(syncWorkerListSignal, ['worker2', 'worker3']);
            const { runId } = await scanWorkflow.describe();
            const result = await scanWorkflow.result();
            expect(result.workers).toContain('worker1');
            expect(result.workers).toContain('worker2');
            expect(result.workers).toContain('worker3');
        });
    }, 1000 * 15);

    it('should return stopped status when job is stopped', async () => {
        const args = {
            jobRunId: 'test-job-run-id',
            workers: ['worker1'],
            failedWorkers: []
        }

        mockedActivities.updateStatus.mockResolvedValue({
            jobRunId: args.jobRunId,
            status: JobRunStatus.Stopped,
        });

        mockedActivities.getJobStateWithStreamLoad.mockResolvedValue({
            jobState: {
                status: JobRunStatus.Stopped,
            },
            isStreamOverloaded: false
        });

        worker = await Worker.create({
            connection: env.nativeConnection,
            workflowsPath: require.resolve('./scan.workflow'),
            activities: mockedActivities,
            taskQueue: 'scan-task-queue'
        });

        await worker.runUntil(async () => {
            const scanWorkflow = await env.client.workflow.start(ScanWorkflow, {
                args: [args],
                taskQueue: 'scan-task-queue',
                workflowId: 'scan-workflow-test-stopped'
            });

            const result = await scanWorkflow.result();
            expect(result.status).toBe(JobRunStatus.Stopped);
            expect(result.workers).toContain('worker1');
            expect(result.failedWorkers).toEqual([]);
            expect(result.jobRunId).toBe(args.jobRunId);
        });
    }, 1000 * 60 * 5);

    it('should return paused status when job is paused', async () => {
        const args = {
            jobRunId: 'test-job-run-id',
            workers: ['worker1'],
            failedWorkers: []
        }

        mockedActivities.updateStatus.mockResolvedValue({
            jobRunId: args.jobRunId,
            status: JobRunStatus.Paused,
        });

        mockedActivities.getJobStateWithStreamLoad.mockResolvedValue({
            jobState: {
                status: JobRunStatus.Paused,
            },
            isStreamOverloaded: false
        });

        worker = await Worker.create({
            connection: env.nativeConnection,
            workflowsPath: require.resolve('./scan.workflow'),
            activities: mockedActivities,
            taskQueue: 'scan-task-queue'
        });

        await worker.runUntil(async () => {
            const scanWorkflow = await env.client.workflow.start(ScanWorkflow, {
                args: [args],
                taskQueue: 'scan-task-queue',
                workflowId: 'scan-workflow-test-paused'
            });

            const result = await scanWorkflow.result();
            expect(result.status).toBe(JobRunStatus.Paused);
        });
    });

    it('should handle fatal errors during scan', async () => {
        const args = {
            jobRunId: 'test-job-run-id',
            workers: ['worker1'],
            failedWorkers: []
        }

        mockedActivities.getJobState.mockResolvedValue({
            status: JobRunStatus.Running,
        });

        mockedActivities.getJobStateWithStreamLoad.mockResolvedValue({
            jobRunState: {
                status: JobRunStatus.Running,
            },
            isStreamOverloaded: false
        });

        mockedActivities.scanPath.mockResolvedValue({
            isFatalErrored: true,
            noTaskFound: false,
            files: 0,
            folders: 0
        });

        worker = await Worker.create({
            connection: env.nativeConnection,
            workflowsPath: require.resolve('./scan.workflow'),
            activities: mockedActivities,
            taskQueue: 'scan-task-queue'
        });

        await worker.runUntil(async () => {
            const scanWorkflow = await env.client.workflow.start(ScanWorkflow, {
                args: [args],
                taskQueue: 'scan-task-queue',
                workflowId: 'scan-workflow-test-fatal-error'
            });

            const result = await scanWorkflow.result();
            expect(result.status).toBe(JobRunStatus.Errored);
            expect(result.error).toBeDefined();
        });
    });

    it('should handle no task found scenario', async () => {
        const args = {
            jobRunId: 'test-job-run-id',
            workers: ['worker1'],
            failedWorkers: []
        }

        mockedActivities.getJobState.mockResolvedValue({
            status: JobRunStatus.Running,
        });

        mockedActivities.getJobStateWithStreamLoad.mockResolvedValue({
            jobState: {
                status: JobRunStatus.Running,
            },
            isStreamOverloaded: false
        });

        mockedActivities.scanPath.mockImplementation(() => {
            return Promise.resolve({
                isFatalErrored: false,
                noTaskFound: true,
                files: 0,
                folders: 0
            });
        });

        worker = await Worker.create({
            connection: env.nativeConnection,
            workflowsPath: require.resolve('./scan.workflow'),
            activities: mockedActivities,
            taskQueue: 'scan-task-queue'
        });

        await worker.runUntil(async () => {
            const scanWorkflow = await env.client.workflow.start(ScanWorkflow, {
                args: [args],
                taskQueue: 'scan-task-queue',
                workflowId: 'scan-workflow-test-no-task-found'
            });

            const result = await scanWorkflow.result();
            expect(result.status).toBe(JobRunStatus.Completed);
        });
    });

    it('should complete scan with single worker successfully', async () => {
        const args = {
            jobRunId: 'test-job-run-id',
            workers: ['worker1'],
            failedWorkers: []
        }

        mockedActivities.getJobState.mockResolvedValue({
            status: JobRunStatus.Running,
        });

        mockedActivities.getJobStateWithStreamLoad.mockResolvedValue({
            jobState: {
                status: JobRunStatus.Running,
            },
            isStreamOverloaded: false
        });

        let scanCallCount = 0;
        mockedActivities.scanPath.mockImplementation(() => {
            scanCallCount++;
            if(scanCallCount === 1) {
                return Promise.resolve({
                    isFatalErrored: false,
                    noTaskFound: false,
                    files: 10,
                    folders: 5
                });
            } else return Promise.resolve({
                isFatalErrored: false,
                noTaskFound: true,
                files: 0,
                folders: 0
            });
        });

        worker = await Worker.create({
            connection: env.nativeConnection,
            workflowsPath: require.resolve('./scan.workflow'),
            activities: mockedActivities,
            taskQueue: 'scan-task-queue'
        });

        await worker.runUntil(async () => {
            const scanWorkflow = await env.client.workflow.start(ScanWorkflow, {
                args: [args],
                taskQueue: 'scan-task-queue',
                workflowId: 'scan-workflow-test-single-worker'
            });

            const result = await scanWorkflow.result();
            expect(result.status).toBe(JobRunStatus.Completed);
            expect(result.workers).toContain('worker1');
        });
    });

    it('should complete scan with multiple workers successfully', async () => {
        const args = {
            jobRunId: 'test-job-run-id',
            workers: ['worker1', 'worker2'],
            failedWorkers: []
        }

        mockedActivities.getJobState.mockResolvedValue({
            status: JobRunStatus.Running,
        });

        mockedActivities.getJobStateWithStreamLoad.mockResolvedValue({
            jobState: {
                status: JobRunStatus.Running,
            },
            isStreamOverloaded: false
        });

        let scanCallCount = 0;
        mockedActivities.scanPath.mockImplementation(() => {
            scanCallCount++;
            if(scanCallCount < 10) {
                return Promise.resolve({
                    isFatalErrored: false,
                    noTaskFound: false,
                    files: 10,
                    folders: 5
                });
            } else {
                return Promise.resolve({
                    isFatalErrored: false,
                    noTaskFound: true,
                    files: 0,
                    folders: 0
                });
            }
        });

        worker = await Worker.create({
            connection: env.nativeConnection,
            workflowsPath: require.resolve('./scan.workflow'),
            activities: mockedActivities,
            taskQueue: 'scan-task-queue'
        });

        await worker.runUntil(async () => {
            const scanWorkflow = await env.client.workflow.start(ScanWorkflow, {
                args: [args],
                taskQueue: 'scan-task-queue',
                workflowId: 'scan-workflow-test-multiple-workers'
            });

            const result = await scanWorkflow.result();
            expect(result.status).toBe(JobRunStatus.Completed);
            expect(result.workers).toContain('worker1');
            expect(result.workers).toContain('worker2');
        });
    });

    it('should handle continueAsNew scenario', async () => {
        const args = {
            jobRunId: 'test-job-run-id',
            workers: ['worker1'],
            failedWorkers: []
        }

        mockedActivities.getJobState.mockResolvedValue({
            status: JobRunStatus.Running,
        });

        mockedActivities.getJobStateWithStreamLoad.mockResolvedValue({
            jobState: {
                status: JobRunStatus.Running,
            },
            isStreamOverloaded: false
        });

        let scanCallCount = 0;
        mockedActivities.scanPath.mockImplementation(() => {
            scanCallCount++;
            if(scanCallCount < 100) {
                return Promise.resolve({
                    isFatalErrored: false,
                    noTaskFound: false,
                    files: 10,
                    folders: 5
                });
            } else {
                return Promise.resolve({
                    isFatalErrored: false,
                    noTaskFound: true,
                    files: 0,
                    folders: 0
                });
            }
        });

        worker = await Worker.create({
            connection: env.nativeConnection,
            workflowsPath: require.resolve('./scan.workflow'),
            activities: mockedActivities,
            taskQueue: 'scan-task-queue'
        });

        await worker.runUntil(async () => {
            const scanWorkflow = await env.client.workflow.start(ScanWorkflow, {
                args: [args],
                taskQueue: 'scan-task-queue',
                workflowId: 'scan-workflow-test-continue-as-new'
            });

            const result = await scanWorkflow.result();
            const { runId: firstRunId } = await scanWorkflow.describe()
            const historyResponse = await env.client.workflowService.getWorkflowExecutionHistory({
                namespace: 'default',
                execution: { workflowId: scanWorkflow.workflowId, runId: firstRunId },
            });
            console.log('Workflow history:', historyResponse.history.events);
            const events = historyResponse.history.events;
            const continuedAsNew = events.some((event) =>
                event.eventType == temporal.api.enums.v1.EventType.EVENT_TYPE_WORKFLOW_EXECUTION_CONTINUED_AS_NEW
            );
            expect(result.status).toBe(JobRunStatus.Completed);
        });
    }, 1000 * 60 * 5);

    it('should handle unexpected job status gracefully', async () => {
        const args = { jobRunId: 'test-job-run-id', workers: ['worker1'], failedWorkers: [] };

        mockedActivities.getJobStateWithStreamLoad.mockResolvedValue({
            jobState: { status: 'Unknown' },
            isStreamOverloaded: false
        });

        worker = await Worker.create({
            connection: env.nativeConnection,
            workflowsPath: require.resolve('./scan.workflow'),
            activities: mockedActivities,
            taskQueue: 'scan-task-queue'
        });

        await worker.runUntil(async () => {
            const result = await env.client.workflow.start(ScanWorkflow, {
                args: [args],
                taskQueue: 'scan-task-queue',
                workflowId: 'scan-workflow-unexpected-status'
            })
            expect(result).toBeDefined();
        });
    });
});