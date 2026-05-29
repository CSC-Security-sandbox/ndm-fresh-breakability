import { JobRunStatus } from 'src/activities/common/enums';

const mockCancelWorkflowIfRunning = jest.fn();
const mockSignalIfRunning = jest.fn();
const mockGetUnifiedJobStatus = jest.fn();
const mockUpdateLastEntry = jest.fn().mockResolvedValue(undefined);
const mockUpdateWorkerResponse = jest.fn().mockResolvedValue(undefined);

jest.mock('./workflow-utils', () => ({
    cancelWorkflowIfRunning: (...args: any[]) => mockCancelWorkflowIfRunning(...args),
    signalIfRunning: (...args: any[]) => mockSignalIfRunning(...args),
    getUnifiedJobStatus: (...args: any[]) => mockGetUnifiedJobStatus(...args),
}));

const mockSetHandler = jest.fn();
const mockStartChild = jest.fn();
const mockGetWorkerScanConfig = jest.fn().mockResolvedValue({ concurrency: 20, batchSize: 100 });

jest.mock('@temporalio/workflow', () => ({
    defineSignal: jest.fn(() => 'actionSignal'),
    setHandler: (...args: any[]) => mockSetHandler(...args),
    startChild: (...args: any[]) => mockStartChild(...args),
    proxyActivities: () => ({
        updateLastEntry: mockUpdateLastEntry,
        updateWorkerResponse: mockUpdateWorkerResponse,
        getWorkerScanConfig: (...args: any[]) => mockGetWorkerScanConfig(...args),
    }),
    isCancellation: jest.fn((error) => error?.isCancellation === true),
    ChildWorkflowCancellationType: { WAIT_CANCELLATION_COMPLETED: 'WAIT_CANCELLATION_COMPLETED' },
    ParentClosePolicy: { TERMINATE: 'TERMINATE' },
}));

import { executeMigrationChildWorkflows } from './execute-migration-child-workflows';

describe('executeMigrationChildWorkflows', () => {
    const jobRunId = 'migration-job-123';

    let mockScanWorkflowHandle: { workflowId: string; result: jest.Mock };
    let mockSyncWorkflowHandle: { workflowId: string; result: jest.Mock };

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetWorkerScanConfig.mockResolvedValue({ concurrency: 20, batchSize: 100 });

        mockScanWorkflowHandle = {
            workflowId: `ScanWorkflow-${jobRunId}`,
            result: jest.fn().mockResolvedValue({
                status: JobRunStatus.Completed,
                fileCount: 10,
                dirCount: 2,
                excludedPaths: [],
                skippedPaths: [],
            }),
        };

        mockSyncWorkflowHandle = {
            workflowId: `SyncWorkflow-${jobRunId}`,
            result: jest.fn().mockResolvedValue({ status: JobRunStatus.Completed }),
        };

        mockStartChild.mockImplementation((workflowName: string) => {
            if (workflowName === 'ChildScanWorkflow') {
                return Promise.resolve(mockScanWorkflowHandle);
            }
            if (workflowName === 'ChildSyncWorkflow') {
                return Promise.resolve(mockSyncWorkflowHandle);
            }
            return Promise.reject(new Error(`Unknown workflow: ${workflowName}`));
        });

        mockGetUnifiedJobStatus.mockImplementation((scan, sync) => {
            if (scan === JobRunStatus.Failed || sync === JobRunStatus.Failed) return JobRunStatus.Failed;
            if (scan === JobRunStatus.Stopped || sync === JobRunStatus.Stopped) return JobRunStatus.Stopped;
            return JobRunStatus.Completed;
        });
    });

    describe('successful execution', () => {
        it('should start scan and sync child workflows with correct parameters', async () => {
            await executeMigrationChildWorkflows({ jobRunId });

            expect(mockStartChild).toHaveBeenCalledWith('ChildScanWorkflow', {
                args: [{ jobRunId, isMigration: true, workerConcurrency: 20, batchSize: 100 }],
                workflowId: `ScanWorkflow-${jobRunId}`,
                taskQueue: `${jobRunId}-TaskQueue`,
                cancellationType: 'WAIT_CANCELLATION_COMPLETED',
                parentClosePolicy: 'TERMINATE',
            });

            expect(mockStartChild).toHaveBeenCalledWith('ChildSyncWorkflow', {
                args: [{ jobRunId, scanWorkflowStatus: JobRunStatus.Running, actionState: JobRunStatus.Running }],
                workflowId: `SyncWorkflow-${jobRunId}`,
                taskQueue: `${jobRunId}-TaskQueue`,
                cancellationType: 'WAIT_CANCELLATION_COMPLETED',
                parentClosePolicy: 'TERMINATE',
            });
        });

        it('should await both results and publish last entry on success', async () => {
            const result = await executeMigrationChildWorkflows({ jobRunId });

            expect(mockScanWorkflowHandle.result).toHaveBeenCalled();
            expect(mockSyncWorkflowHandle.result).toHaveBeenCalled();
            expect(mockUpdateLastEntry).toHaveBeenCalledWith(jobRunId);
            expect(result.status).toBe(JobRunStatus.Completed);
            expect(result.scanJobStatus).toBe(JobRunStatus.Completed);
            expect(result.syncJobStatus).toBe(JobRunStatus.Completed);
            expect(result.fileCount).toBe(10);
            expect(result.dirCount).toBe(2);
        });

        it('should signal sync with scanResultSignal when scan completes', async () => {
            await executeMigrationChildWorkflows({ jobRunId });

            expect(mockSignalIfRunning).toHaveBeenCalledWith(
                mockSyncWorkflowHandle,
                'scanResultSignal',
                JobRunStatus.Completed,
            );
        });
    });

    describe('signal handling', () => {
        it('when stop arrives during getWorkerScanConfig, should start scan but not sync', async () => {
            let capturedHandler: (action: string) => Promise<void>;
            let releaseConfig!: () => void;

            mockGetWorkerScanConfig.mockImplementation(
                () =>
                    new Promise<{ concurrency: number; batchSize: number }>((resolve) => {
                        releaseConfig = () => resolve({ concurrency: 20, batchSize: 100 });
                    }),
            );
            mockScanWorkflowHandle.result.mockResolvedValue({
                status: JobRunStatus.Stopped,
                fileCount: 0,
                dirCount: 0,
                excludedPaths: [],
                skippedPaths: [],
            });

            mockSetHandler.mockImplementation((signal, handler) => {
                capturedHandler = handler;
            });

            const workflowPromise = executeMigrationChildWorkflows({ jobRunId });
            await new Promise((resolve) => setImmediate(resolve));

            if (capturedHandler!) {
                await capturedHandler(JobRunStatus.Stopped);
            }
            releaseConfig();
            const result = await workflowPromise;

            expect(mockStartChild).toHaveBeenCalledTimes(1);
            expect(mockStartChild).toHaveBeenCalledWith(
                'ChildScanWorkflow',
                expect.objectContaining({ workflowId: `ScanWorkflow-${jobRunId}` }),
            );
            expect(mockStartChild).not.toHaveBeenCalledWith(
                'ChildSyncWorkflow',
                expect.anything(),
            );
            expect(result.scanJobStatus).toBe(JobRunStatus.Stopped);
            expect(result.syncJobStatus).toBe(JobRunStatus.Stopped);
            expect(result.status).toBe(JobRunStatus.Stopped);
            expect(mockSyncWorkflowHandle.result).not.toHaveBeenCalled();
            expect(mockUpdateLastEntry).toHaveBeenCalledWith(jobRunId);
        });

        it('should hard-cancel scan but gracefully signal sync when stop arrives after children start', async () => {
            let capturedHandler: (action: string) => Promise<void>;
            mockSyncWorkflowHandle.result.mockResolvedValue({ status: JobRunStatus.Stopped });

            mockSetHandler.mockImplementation((signal, handler) => {
                capturedHandler = handler;
            });

            const workflowPromise = executeMigrationChildWorkflows({ jobRunId });
            await new Promise((resolve) => setImmediate(resolve));

            if (capturedHandler!) {
                await capturedHandler(JobRunStatus.Stopped);
            }

            const result = await workflowPromise;

            expect(mockStartChild).toHaveBeenCalled();
            expect(mockCancelWorkflowIfRunning).toHaveBeenCalledWith(`ScanWorkflow-${jobRunId}`);
            expect(mockSignalIfRunning).toHaveBeenCalledWith(
                expect.objectContaining({ workflowId: `SyncWorkflow-${jobRunId}` }),
                'syncActionSignal',
                JobRunStatus.Stopped,
            );
            expect(mockCancelWorkflowIfRunning).not.toHaveBeenCalledWith(`SyncWorkflow-${jobRunId}`);
            expect(mockSyncWorkflowHandle.result).toHaveBeenCalled();
            expect(result.syncJobStatus).toBe(JobRunStatus.Stopped);
            expect(result.status).toBe(JobRunStatus.Stopped);
            expect(mockUpdateLastEntry).toHaveBeenCalledWith(jobRunId);
        });
    });

    describe('error handling', () => {
        it('should cancel scan when sync fails with non-cancellation error', async () => {
            const syncError = new Error('ENOSPC: FatalError - read-only filesystem');
            mockSyncWorkflowHandle.result.mockRejectedValue(syncError);
            mockScanWorkflowHandle.result.mockRejectedValue({ isCancellation: true });
            mockGetUnifiedJobStatus.mockReturnValue(JobRunStatus.Failed);

            const result = await executeMigrationChildWorkflows({ jobRunId });

            expect(result.syncJobStatus).toBe(JobRunStatus.Failed);
            expect(result.scanJobStatus).toBe(JobRunStatus.Stopped);
            expect(mockCancelWorkflowIfRunning).toHaveBeenCalledWith(`ScanWorkflow-${jobRunId}`);
            expect(mockUpdateWorkerResponse).toHaveBeenCalledWith(jobRunId, 'all', expect.objectContaining({
                status: JobRunStatus.Failed,
                code: 'TASK_FETCH_FAILURE',
                origin: 'ChildSyncWorkflow',
            }));
            expect(result.status).toBe(JobRunStatus.Failed);
            expect(mockUpdateLastEntry).toHaveBeenCalledWith(jobRunId);
        });

        it('should cancel sync when scan fails with non-cancellation error', async () => {
            const scanError = new Error('Scan failed critically');
            mockScanWorkflowHandle.result.mockRejectedValue(scanError);
            mockSyncWorkflowHandle.result.mockRejectedValue({ isCancellation: true });
            mockGetUnifiedJobStatus.mockReturnValue(JobRunStatus.Failed);

            const result = await executeMigrationChildWorkflows({ jobRunId });

            expect(result.scanJobStatus).toBe(JobRunStatus.Failed);
            expect(result.syncJobStatus).toBe(JobRunStatus.Stopped);
            expect(mockCancelWorkflowIfRunning).toHaveBeenCalledWith(`SyncWorkflow-${jobRunId}`);
            expect(mockUpdateWorkerResponse).toHaveBeenCalledWith(jobRunId, 'all', expect.objectContaining({
                status: JobRunStatus.Failed,
                code: 'TASK_FETCH_FAILURE',
                origin: 'ChildScanWorkflow',
            }));
            expect(result.status).toBe(JobRunStatus.Failed);
            expect(mockUpdateLastEntry).toHaveBeenCalledWith(jobRunId);
        });

        it('should detect scan cancellation without hard-cancelling sync', async () => {
            const cancellationError = { cause: { isCancellation: true } };
            mockScanWorkflowHandle.result.mockRejectedValue(cancellationError);
            mockSyncWorkflowHandle.result.mockResolvedValue({ status: JobRunStatus.Stopped });
            mockGetUnifiedJobStatus.mockReturnValue(JobRunStatus.Stopped);

            const result = await executeMigrationChildWorkflows({ jobRunId });

            expect(result.scanJobStatus).toBe(JobRunStatus.Stopped);
            expect(mockCancelWorkflowIfRunning).not.toHaveBeenCalledWith(`SyncWorkflow-${jobRunId}`);
            expect(mockSyncWorkflowHandle.result).toHaveBeenCalled();
        });

        it('should not report error to DB when failure is a cancellation', async () => {
            const cancellationError = { isCancellation: true };
            mockScanWorkflowHandle.result.mockRejectedValue(cancellationError);
            mockSyncWorkflowHandle.result.mockResolvedValue({ status: JobRunStatus.Stopped });
            mockGetUnifiedJobStatus.mockReturnValue(JobRunStatus.Stopped);

            await executeMigrationChildWorkflows({ jobRunId });

            expect(mockUpdateWorkerResponse).not.toHaveBeenCalled();
        });
    });
});
