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

// Stable references so tests can assert on calls to these activities
const mockUpdateWorkerResponse = jest.fn().mockResolvedValue(undefined);
const mockUpdateLastEntry = jest.fn().mockResolvedValue(undefined);

// Mock Temporal workflow module
const mockSetHandler = jest.fn();
const mockStartChild = jest.fn();

jest.mock('@temporalio/workflow', () => ({
    defineSignal: jest.fn(() => 'actionSignal'),
    setHandler: (...args: any[]) => mockSetHandler(...args),
    startChild: (...args: any[]) => mockStartChild(...args),
    proxyActivities: () => ({
        updateLastEntry: (...args: any[]) => mockUpdateLastEntry(...args),
        updateWorkerResponse: (...args: any[]) => mockUpdateWorkerResponse(...args),
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

        // Reset default behaviour for mocks whose implementations may be overridden per-test
        mockSignalIfRunning.mockResolvedValue(undefined);
        mockCancelWorkflowIfRunning.mockResolvedValue(undefined);
        mockUpdateWorkerResponse.mockResolvedValue(undefined);

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
                args: [{ jobRunId, originalJobRunId }],
                workflowId: `RetryScanWorkflow-${jobRunId}`,
                taskQueue: `${jobRunId}-TaskQueue`,
                cancellationType: 'WAIT_CANCELLATION_COMPLETED',
                parentClosePolicy: 'TERMINATE',
            });

            expect(mockStartChild).toHaveBeenCalledWith('ChildSyncWorkflow', {
                args: [{ jobRunId, scanWorkflowStatus: JobRunStatus.Running }],
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
        it('should cancel both workflows when stop signal is received', async () => {
            // Capture the signal handler
            let capturedHandler: (action: string) => Promise<void>;
            mockSetHandler.mockImplementation((signal, handler) => {
                capturedHandler = handler;
            });

            // Start the workflow execution (but we'll intercept before completion)
            const workflowPromise = executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            // Wait a tick for the handler to be registered
            await new Promise(resolve => setImmediate(resolve));

            // Simulate stop signal
            if (capturedHandler!) {
                await capturedHandler(JobRunStatus.Stopped);
            }

            expect(mockCancelWorkflowIfRunning).toHaveBeenCalledWith(`RetryScanWorkflow-${jobRunId}`);
            expect(mockCancelWorkflowIfRunning).toHaveBeenCalledWith(`RetrySyncWorkflow-${jobRunId}`);
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

        it('should detect cancellation and set Stopped status', async () => {
            const cancellationError = { cause: { isCancellation: true } };
            mockRetryScanWorkflowHandle.result.mockRejectedValue(cancellationError);
            mockGetUnifiedJobStatus.mockReturnValue(JobRunStatus.Stopped);

            const result = await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(result.retryScanJobStatus).toBe(JobRunStatus.Stopped);
        });

        it('should report SIGNAL_FAILURE and set Failed when cancelling child workflows throws on stop', async () => {
            mockCancelWorkflowIfRunning.mockRejectedValue(new Error('Cancel timed out'));

            let capturedHandler: (action: string) => Promise<void>;
            mockSetHandler.mockImplementation((_signal, handler) => {
                capturedHandler = handler;
            });

            const workflowPromise = executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });
            await new Promise(resolve => setImmediate(resolve));

            await capturedHandler!(JobRunStatus.Stopped);

            expect(mockUpdateWorkerResponse).toHaveBeenCalledWith(
                jobRunId, 'all',
                expect.objectContaining({
                    code: 'SIGNAL_FAILURE',
                    status: JobRunStatus.Failed,
                })
            );

            await workflowPromise;
        });

        it('should report SIGNAL_FAILURE when forwarding pause signal to children throws', async () => {
            mockSignalIfRunning.mockRejectedValue(new Error('Signal delivery failed'));

            let capturedHandler: (action: string) => Promise<void>;
            mockSetHandler.mockImplementation((_signal, handler) => {
                capturedHandler = handler;
            });

            const workflowPromise = executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });
            await new Promise(resolve => setImmediate(resolve));

            await capturedHandler!(JobRunStatus.Paused);

            expect(mockUpdateWorkerResponse).toHaveBeenCalledWith(
                jobRunId, 'all',
                expect.objectContaining({
                    code: 'SIGNAL_FAILURE',
                    status: JobRunStatus.Failed,
                })
            );

            // Resolve mocked workflows so the test can complete
            mockSignalIfRunning.mockResolvedValue(undefined);
            await workflowPromise;
        });

        it('should report SIGNAL_FAILURE and not await sync result when scanResultSignal throws', async () => {
            // Make scanResultSignal throw, all other signals succeed
            mockSignalIfRunning.mockImplementation((_wf, signalName) => {
                if (signalName === 'scanResultSignal') return Promise.reject(new Error('Signal lost'));
                return Promise.resolve();
            });
            mockGetUnifiedJobStatus.mockReturnValue(JobRunStatus.Failed);

            await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(mockUpdateWorkerResponse).toHaveBeenCalledWith(
                jobRunId, 'all',
                expect.objectContaining({
                    code: 'SIGNAL_FAILURE',
                    status: JobRunStatus.Failed,
                })
            );
            // sync workflow result should not be awaited once status is Failed
            expect(mockSyncWorkflowHandle.result).not.toHaveBeenCalled();
        });

        it('should complete successfully even if cleanup cancel throws after scan failure', async () => {
            // Scan workflow fails, and the cleanup cancel also fails
            mockRetryScanWorkflowHandle.result.mockRejectedValue(new Error('Scan crashed'));
            mockCancelWorkflowIfRunning.mockRejectedValue(new Error('Cancel also failed'));
            mockGetUnifiedJobStatus.mockReturnValue(JobRunStatus.Failed);

            // Should not propagate the cancel error — workflow completes cleanly
            await expect(
                executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId })
            ).resolves.toBeDefined();
        });

        it('should report SIGNAL_FAILURE when sync workflow throws', async () => {
            mockSyncWorkflowHandle.result.mockRejectedValue(new Error('Sync crashed'));
            mockGetUnifiedJobStatus.mockReturnValue(JobRunStatus.Failed);

            await executeRetryMigrationChildWorkflows({ jobRunId, originalJobRunId });

            expect(mockUpdateWorkerResponse).toHaveBeenCalledWith(
                jobRunId, 'all',
                expect.objectContaining({
                    code: 'SIGNAL_FAILURE',
                    status: JobRunStatus.Failed,
                })
            );
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
