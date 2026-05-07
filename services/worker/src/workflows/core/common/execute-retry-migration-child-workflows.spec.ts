import { JobRunStatus } from 'src/activities/common/enums';

const mockCancelWorkflowIfRunning = jest.fn();
const mockSignalIfRunning = jest.fn();
const mockGetUnifiedJobStatus = jest.fn();

jest.mock('./workflow-utils', () => ({
    cancelWorkflowIfRunning: (...args: any[]) => mockCancelWorkflowIfRunning(...args),
    signalIfRunning: (...args: any[]) => mockSignalIfRunning(...args),
    getUnifiedJobStatus: (...args: any[]) => mockGetUnifiedJobStatus(...args),
}));

const mockSetHandler = jest.fn();
const mockStartChild = jest.fn();
const mockCondition = jest.fn();

jest.mock('@temporalio/workflow', () => ({
    defineSignal: jest.fn((name) => name),
    setHandler: (...args: any[]) => mockSetHandler(...args),
    startChild: (...args: any[]) => mockStartChild(...args),
    proxyActivities: () => ({
        updateLastEntry: jest.fn().mockResolvedValue(undefined),
        updateWorkerResponse: jest.fn().mockResolvedValue(undefined),
        getWorkerScanConfig: jest.fn().mockResolvedValue({ concurrency: 20, batchSize: 100 }),
    }),
    isCancellation: jest.fn((error) => error?.isCancellation === true),
    condition: (...args: any[]) => mockCondition(...args),
    ChildWorkflowCancellationType: { WAIT_CANCELLATION_COMPLETED: 'WAIT_CANCELLATION_COMPLETED' },
    ParentClosePolicy: { TERMINATE: 'TERMINATE' },
}));

import { executeRetryMigrationChildWorkflows } from './execute-retry-migration-child-workflows';

describe('executeRetryMigrationChildWorkflows', () => {
    const jobRunId = 'retry-job-123';
    const originalJobRunId = 'original-job-456';
    const parentWorkflowId = `RetryMigrationWorkflow-${jobRunId}`;

    let mockRetryScanWorkflowHandle: any;
    let mockSyncWorkflowHandle: any;
    let signalHandlers: Record<string, Function>;

    beforeEach(() => {
        jest.clearAllMocks();
        signalHandlers = {};

        mockRetryScanWorkflowHandle = {
            workflowId: `RetryScanWorkflow-${jobRunId}`,
        };

        mockSyncWorkflowHandle = {
            workflowId: `RetrySyncWorkflow-${jobRunId}`,
        };

        mockStartChild.mockImplementation((workflowName: string) => {
            if (workflowName === 'ChildRetryScanWorkflow') {
                return Promise.resolve(mockRetryScanWorkflowHandle);
            }
            if (workflowName === 'ChildSyncWorkflow') {
                return Promise.resolve(mockSyncWorkflowHandle);
            }
            return Promise.reject(new Error(`Unknown workflow: ${workflowName}`));
        });

        mockSetHandler.mockImplementation((signalName: string, handler: Function) => {
            signalHandlers[signalName] = handler;
        });

        mockGetUnifiedJobStatus.mockImplementation((scan, sync) => {
            if (scan === JobRunStatus.Failed || sync === JobRunStatus.Failed) return JobRunStatus.Failed;
            if (scan === JobRunStatus.Stopped || sync === JobRunStatus.Stopped) return JobRunStatus.Stopped;
            return JobRunStatus.Completed;
        });
    });

    describe('successful execution', () => {
        beforeEach(() => {
            let conditionCallCount = 0;
            mockCondition.mockImplementation(async (fn: () => boolean) => {
                conditionCallCount++;
                if (conditionCallCount === 1) {
                    // Phase 1: simulate scan completed signal
                    signalHandlers['childWorkflowDone']('scan', { status: JobRunStatus.Completed });
                } else if (conditionCallCount === 2) {
                    // Phase 2: simulate sync completed signal
                    signalHandlers['childWorkflowDone']('sync', { status: JobRunStatus.Completed });
                }
                await new Promise(resolve => setImmediate(resolve));
            });
        });

        it('should start both child workflows with correct parameters', async () => {
            await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(mockStartChild).toHaveBeenCalledWith('ChildRetryScanWorkflow', {
                args: [{ jobRunId, originalJobRunId, workerConcurrency: 20, batchSize: 100, parentWorkflowId }],
                workflowId: `RetryScanWorkflow-${jobRunId}`,
                taskQueue: `${jobRunId}-TaskQueue`,
                cancellationType: 'WAIT_CANCELLATION_COMPLETED',
                parentClosePolicy: 'TERMINATE',
            });

            expect(mockStartChild).toHaveBeenCalledWith('ChildSyncWorkflow', {
                args: [{ jobRunId, scanWorkflowStatus: JobRunStatus.Running, parentWorkflowId }],
                workflowId: `RetrySyncWorkflow-${jobRunId}`,
                taskQueue: `${jobRunId}-TaskQueue`,
                cancellationType: 'WAIT_CANCELLATION_COMPLETED',
                parentClosePolicy: 'TERMINATE',
            });
        });

        it('should return Completed status when both workflows complete successfully', async () => {
            const result = await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(result.status).toBe(JobRunStatus.Completed);
            expect(result.retryScanJobStatus).toBe(JobRunStatus.Completed);
            expect(result.syncJobStatus).toBe(JobRunStatus.Completed);
        });

        it('should signal sync workflow with scan result after scan completes', async () => {
            await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(mockSignalIfRunning).toHaveBeenCalledWith(
                mockSyncWorkflowHandle,
                'scanResultSignal',
                JobRunStatus.Completed
            );
        });

        it('should register signal handlers', async () => {
            await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(signalHandlers['childWorkflowDone']).toBeDefined();
            expect(signalHandlers['childWorkflowFailed']).toBeDefined();
            expect(signalHandlers['action']).toBeDefined();
        });
    });

    describe('error handling - sync fails during scan phase', () => {
        beforeEach(() => {
            mockCondition.mockImplementation(async (fn: () => boolean) => {
                // Simulate sync failure signal arriving
                signalHandlers['childWorkflowFailed']('sync', 'Fatal error: EROFS');
                await new Promise(resolve => setImmediate(resolve));
            });
        });

        it('should cancel both workflows and return Failed', async () => {
            const result = await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(mockCancelWorkflowIfRunning).toHaveBeenCalledWith(`RetryScanWorkflow-${jobRunId}`);
            expect(mockCancelWorkflowIfRunning).toHaveBeenCalledWith(`RetrySyncWorkflow-${jobRunId}`);
            expect(result.syncJobStatus).toBe(JobRunStatus.Failed);
            expect(result.status).toBe(JobRunStatus.Failed);
        });
    });

    describe('error handling - sync fails after scan completes', () => {
        beforeEach(() => {
            let conditionCallCount = 0;
            mockCondition.mockImplementation(async (fn: () => boolean) => {
                conditionCallCount++;
                if (conditionCallCount === 1) {
                    signalHandlers['childWorkflowDone']('scan', { status: JobRunStatus.Completed });
                } else if (conditionCallCount === 2) {
                    signalHandlers['childWorkflowFailed']('sync', 'Fatal: ENOSPC');
                }
                await new Promise(resolve => setImmediate(resolve));
            });
        });

        it('should cancel workflows and return Failed', async () => {
            const result = await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(result.syncJobStatus).toBe(JobRunStatus.Failed);
            expect(result.status).toBe(JobRunStatus.Failed);
        });
    });

    describe('error handling - scan fails', () => {
        beforeEach(() => {
            mockCondition.mockImplementation(async (fn: () => boolean) => {
                signalHandlers['childWorkflowFailed']('scan', 'Scan fatal error');
                await new Promise(resolve => setImmediate(resolve));
            });
        });

        it('should cancel both and return Failed', async () => {
            const result = await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(result.retryScanJobStatus).toBe(JobRunStatus.Failed);
            expect(result.status).toBe(JobRunStatus.Failed);
        });
    });

    describe('stop signal handling', () => {
        beforeEach(() => {
            mockCondition.mockImplementation(async (fn: () => boolean) => {
                // Simulate stop signal
                await signalHandlers['action'](JobRunStatus.Stopped);
                await new Promise(resolve => setImmediate(resolve));
            });
        });

        it('should cancel both workflows and return Stopped', async () => {
            const result = await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(mockCancelWorkflowIfRunning).toHaveBeenCalledWith(`RetryScanWorkflow-${jobRunId}`);
            expect(mockCancelWorkflowIfRunning).toHaveBeenCalledWith(`RetrySyncWorkflow-${jobRunId}`);
            expect(result.status).toBe(JobRunStatus.Stopped);
        });
    });
});
