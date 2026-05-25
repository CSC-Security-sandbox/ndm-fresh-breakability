import { JobRunStatus } from 'src/activities/common/enums';
import * as wf from '@temporalio/workflow';

// Mock the workflow-utils before importing the module under test
const mockCancelWorkflowIfRunning = jest.fn();
const mockSignalIfRunning = jest.fn();
const mockGetUnifiedJobStatus = jest.fn();

jest.mock('./workflow-utils', () => ({
    cancelWorkflowIfRunning: (...args: any[]) => mockCancelWorkflowIfRunning(...args),
    signalIfRunning: (...args: any[]) => mockSignalIfRunning(...args),
    getUnifiedJobStatus: (...args: any[]) => mockGetUnifiedJobStatus(...args),
}));

// Mock Temporal workflow module
const mockSetHandler = jest.fn();
const mockStartChild = jest.fn();
const mockGetWorkerScanConfig = jest.fn().mockResolvedValue({ concurrency: 20, batchSize: 100 });

jest.mock('@temporalio/workflow', () => ({
    defineSignal: jest.fn(() => 'actionSignal'),
    setHandler: (...args: any[]) => mockSetHandler(...args),
    startChild: (...args: any[]) => mockStartChild(...args),
    proxyActivities: () => ({
        updateLastEntry: jest.fn().mockResolvedValue(undefined),
        updateWorkerResponse: jest.fn().mockResolvedValue(undefined),
        getWorkerScanConfig: (...args: any[]) => mockGetWorkerScanConfig(...args),
    }),
    isCancellation: jest.fn((error) => error?.isCancellation === true),
    ChildWorkflowCancellationType: { WAIT_CANCELLATION_COMPLETED: 'WAIT_CANCELLATION_COMPLETED' },
    ParentClosePolicy: { TERMINATE: 'TERMINATE' },
}));

import { executeRetryMigrationChildWorkflows, actionSignal } from './execute-retry-migration-child-workflows';


describe('executeRetryMigrationChildWorkflows', () => {
    const jobRunId = 'retry-job-123';
    const originalJobRunId = 'original-job-456';

    let mockRetryScanWorkflowHandle: any;
    let mockSyncWorkflowHandle: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetWorkerScanConfig.mockResolvedValue({ concurrency: 20, batchSize: 100 });

        // Setup mock workflow handles
        mockRetryScanWorkflowHandle = {
            workflowId: `RetryScanWorkflow-${jobRunId}`,
            result: jest.fn().mockResolvedValue({ status: JobRunStatus.Completed }),
        };

        mockSyncWorkflowHandle = {
            workflowId: `RetrySyncWorkflow-${jobRunId}`,
            result: jest.fn().mockResolvedValue({ status: JobRunStatus.Completed }),
        };

        // Setup startChild mock to return appropriate handles
        mockStartChild.mockImplementation((workflowName: string) => {
            if (workflowName === 'ChildRetryScanWorkflow') {
                return Promise.resolve(mockRetryScanWorkflowHandle);
            }
            if (workflowName === 'ChildSyncWorkflow') {
                return Promise.resolve(mockSyncWorkflowHandle);
            }
            return Promise.reject(new Error(`Unknown workflow: ${workflowName}`));
        });

        // Default mock for getUnifiedJobStatus
        mockGetUnifiedJobStatus.mockImplementation((scan, sync) => {
            if (scan === JobRunStatus.Failed || sync === JobRunStatus.Failed) return JobRunStatus.Failed;
            if (scan === JobRunStatus.Stopped || sync === JobRunStatus.Stopped) return JobRunStatus.Stopped;
            return JobRunStatus.Completed;
        });
    });

    describe('successful execution', () => {
        it('should start both child workflows with correct parameters', async () => {
            await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(mockStartChild).toHaveBeenCalledWith('ChildRetryScanWorkflow', {
                args: [{
                    jobRunId,
                    originalJobRunId,
                    workerConcurrency: 20,
                    batchSize: 100,
                }],
                workflowId: `RetryScanWorkflow-${jobRunId}`,
                taskQueue: `${jobRunId}-TaskQueue`,
                cancellationType: 'WAIT_CANCELLATION_COMPLETED',
                parentClosePolicy: 'TERMINATE',
            });

            expect(mockStartChild).toHaveBeenCalledWith('ChildSyncWorkflow', {
                args: [{ jobRunId, scanWorkflowStatus: JobRunStatus.Running, actionState: JobRunStatus.Running }],
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

        it('should register action signal handler', async () => {
            await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(mockSetHandler).toHaveBeenCalled();
            const [signal, handler] = mockSetHandler.mock.calls[0];
            expect(signal).toBe('actionSignal');
            expect(typeof handler).toBe('function');
        });
    });

    describe('signal handling', () => {
        it('should hard-cancel retry scan but gracefully signal sync when stop arrives after children start', async () => {
            let capturedHandler: (action: string) => Promise<void>;
            mockSyncWorkflowHandle.result.mockResolvedValue({ status: JobRunStatus.Stopped });

            mockSetHandler.mockImplementation((signal, handler) => {
                capturedHandler = handler;
            });

            const workflowPromise = executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });
            await new Promise((resolve) => setImmediate(resolve));

            if (capturedHandler!) {
                await capturedHandler(JobRunStatus.Stopped);
            }

            const result = await workflowPromise;

            expect(mockStartChild).toHaveBeenCalledTimes(2);
            expect(mockCancelWorkflowIfRunning).toHaveBeenCalledWith(`RetryScanWorkflow-${jobRunId}`);
            expect(mockSignalIfRunning).toHaveBeenCalledWith(
                expect.objectContaining({ workflowId: `RetrySyncWorkflow-${jobRunId}` }),
                'syncActionSignal',
                JobRunStatus.Stopped,
            );
            expect(mockCancelWorkflowIfRunning).not.toHaveBeenCalledWith(`RetrySyncWorkflow-${jobRunId}`);
            expect(mockSyncWorkflowHandle.result).toHaveBeenCalled();
            expect(result.syncJobStatus).toBe(JobRunStatus.Stopped);
            expect(result.status).toBe(JobRunStatus.Stopped);
        });

        it('when stop arrives during getWorkerScanConfig, should still start children and await sync drain', async () => {
            let capturedHandler: (action: string) => Promise<void>;
            let releaseConfig!: () => void;

            mockGetWorkerScanConfig.mockImplementation(
                () =>
                    new Promise<{ concurrency: number; batchSize: number }>((resolve) => {
                        releaseConfig = () => resolve({ concurrency: 20, batchSize: 100 });
                    }),
            );
            mockRetryScanWorkflowHandle.result.mockResolvedValue({ status: JobRunStatus.Stopped });
            mockSyncWorkflowHandle.result.mockResolvedValue({ status: JobRunStatus.Stopped });

            mockSetHandler.mockImplementation((signal, handler) => {
                capturedHandler = handler;
            });

            const workflowPromise = executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });
            await new Promise((resolve) => setImmediate(resolve));

            if (capturedHandler!) {
                await capturedHandler(JobRunStatus.Stopped);
            }
            releaseConfig();
            const result = await workflowPromise;

            expect(mockStartChild).toHaveBeenCalledTimes(2);
            expect(result.retryScanJobStatus).toBe(JobRunStatus.Stopped);
            expect(mockSyncWorkflowHandle.result).toHaveBeenCalled();
            expect(result.syncJobStatus).toBe(JobRunStatus.Stopped);
            expect(result.status).toBe(JobRunStatus.Stopped);
        });

        it('should forward pause signal to child workflows', async () => {
            let capturedHandler: (action: string) => Promise<void>;
            mockSetHandler.mockImplementation((signal, handler) => {
                capturedHandler = handler;
            });

            const workflowPromise = executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });
            await new Promise(resolve => setImmediate(resolve));

            if (capturedHandler!) {
                await capturedHandler(JobRunStatus.Paused);
            }

            expect(mockSignalIfRunning).toHaveBeenCalledWith(
                mockRetryScanWorkflowHandle,
                'retryScanActionSignal',
                JobRunStatus.Paused
            );
            expect(mockSignalIfRunning).toHaveBeenCalledWith(
                mockSyncWorkflowHandle,
                'syncActionSignal',
                JobRunStatus.Paused
            );
        });
    });

    describe('error handling', () => {
        it('should handle retry scan workflow failure', async () => {
            mockRetryScanWorkflowHandle.result.mockRejectedValue(new Error('Scan failed'));
            mockGetUnifiedJobStatus.mockReturnValue(JobRunStatus.Failed);

            const result = await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(result.retryScanJobStatus).toBe(JobRunStatus.Failed);
            expect(mockCancelWorkflowIfRunning).toHaveBeenCalledWith(`RetrySyncWorkflow-${jobRunId}`);
        });

        it('should handle sync workflow failure', async () => {
            mockSyncWorkflowHandle.result.mockRejectedValue(new Error('Sync failed'));
            mockGetUnifiedJobStatus.mockReturnValue(JobRunStatus.Failed);

            const result = await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(result.syncJobStatus).toBe(JobRunStatus.Failed);
        });

        it('should detect cancellation and set Stopped status without hard-cancelling sync', async () => {
            const cancellationError = { cause: { isCancellation: true } };
            mockRetryScanWorkflowHandle.result.mockRejectedValue(cancellationError);
            mockSyncWorkflowHandle.result.mockResolvedValue({ status: JobRunStatus.Stopped });
            mockGetUnifiedJobStatus.mockReturnValue(JobRunStatus.Stopped);

            const result = await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(result.retryScanJobStatus).toBe(JobRunStatus.Stopped);
            expect(mockCancelWorkflowIfRunning).not.toHaveBeenCalledWith(`RetrySyncWorkflow-${jobRunId}`);
            expect(mockSyncWorkflowHandle.result).toHaveBeenCalled();
        });
    });

    describe('status determination', () => {
        it('should return Failed if scan fails', async () => {
            mockRetryScanWorkflowHandle.result.mockResolvedValue({ status: JobRunStatus.Failed });
            mockGetUnifiedJobStatus.mockReturnValue(JobRunStatus.Failed);

            const result = await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(result.status).toBe(JobRunStatus.Failed);
        });

        it('should return Failed if sync fails', async () => {
            mockSyncWorkflowHandle.result.mockResolvedValue({ status: JobRunStatus.Failed });
            mockGetUnifiedJobStatus.mockReturnValue(JobRunStatus.Failed);

            const result = await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(result.status).toBe(JobRunStatus.Failed);
        });

        it('should return Stopped if either workflow is stopped', async () => {
            mockRetryScanWorkflowHandle.result.mockResolvedValue({ status: JobRunStatus.Stopped });
            mockGetUnifiedJobStatus.mockReturnValue(JobRunStatus.Stopped);

            const result = await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(result.status).toBe(JobRunStatus.Stopped);
        });
    });
});
