import { RetryMigrationWorkflow } from './retry-migration-parent-workflow';
import { JobRunStatus } from 'src/activities/common/enums';
import { waitUntilRedisMemoryOk } from 'src/workflows/utils/memory-utils';
import { executeCleanup } from '../common/execute-cleanup-workflow';
import { executeRetryMigrationChildWorkflows } from '../common/execute-retry-migration-child-workflows';
import { handleReporting } from '../common/handle-reporting';
import { executeWorkerSetup } from '../common/execute-setup-workflow';
import * as wf from '@temporalio/workflow';

// Mock Temporal workflow activities
jest.mock('@temporalio/workflow', () => ({
    proxyActivities: jest.fn(() => ({
        updateStatus: jest.fn().mockResolvedValue(undefined),
    })),
}));

jest.mock('src/workflows/utils/memory-utils', () => ({
    waitUntilRedisMemoryOk: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../common/execute-cleanup-workflow', () => ({
    executeCleanup: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../common/execute-retry-migration-child-workflows', () => ({
    executeRetryMigrationChildWorkflows: jest.fn(),
}));

jest.mock('../common/handle-reporting', () => ({
    handleReporting: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../common/execute-setup-workflow', () => ({
    executeWorkerSetup: jest.fn(),
}));


describe('RetryMigrationWorkflow', () => {
    const traceId = 'retry-job-run-123';
    const originalJobRunId = 'original-job-run-456';
    const workers = ['worker1', 'worker2'];
    const options = { retryMode: true };

    beforeEach(() => {
        jest.clearAllMocks();
        (executeWorkerSetup as jest.Mock).mockResolvedValue({
            setupCompletedWorkers: ['worker1'],
            failedWorkers: ['worker2'],
        });
        (executeRetryMigrationChildWorkflows as jest.Mock).mockResolvedValue({
            status: JobRunStatus.Completed,
            retryScanJobStatus: JobRunStatus.Completed,
            syncJobStatus: JobRunStatus.Completed,
        });
    });

    describe('successful execution', () => {
        it('should execute the workflow and return expected output', async () => {
            const result = await RetryMigrationWorkflow({
                traceId,
                payload: { workers, jobRunId: originalJobRunId },
                options,
            });

            expect(executeWorkerSetup).toHaveBeenCalledWith({
                jobRunId: traceId,
                workerIds: workers,
                options,
            });
            expect(waitUntilRedisMemoryOk).toHaveBeenCalledWith(traceId);
            expect(executeRetryMigrationChildWorkflows).toHaveBeenCalledWith({
                jobRunId: traceId,
                originalJobRunId: originalJobRunId,
            });
            expect(handleReporting).toHaveBeenCalledWith(traceId, JobRunStatus.Completed);
            expect(executeCleanup).toHaveBeenCalledWith({
                jobRunId: traceId,
                workerIds: ['worker1'],
                options,
            });

            expect(result).toEqual({
                traceId,
                setupCompletedWorkers: ['worker1'],
                failedWorkers: ['worker2'],
                status: JobRunStatus.Completed,
                jobRunId: originalJobRunId,
            });
        });

        it('should handle empty workers and default options', async () => {
            (executeWorkerSetup as jest.Mock).mockResolvedValue({
                setupCompletedWorkers: [],
                failedWorkers: [],
            });

            const result = await RetryMigrationWorkflow({
                traceId,
                payload: { workers: [], jobRunId: originalJobRunId },
            });

            expect(result.setupCompletedWorkers).toEqual([]);
            expect(result.failedWorkers).toEqual([]);
            expect(result.jobRunId).toEqual(originalJobRunId);
        });

        it('should pass originalJobRunId to child workflows for fetching failed operations', async () => {
            await RetryMigrationWorkflow({
                traceId,
                payload: { workers, jobRunId: originalJobRunId },
            });

            expect(executeRetryMigrationChildWorkflows).toHaveBeenCalledWith({
                jobRunId: traceId,
                originalJobRunId: originalJobRunId,
            });
        });
    });

    describe('validation', () => {
        it('should return Failed status when jobRunId is not provided', async () => {
            const result = await RetryMigrationWorkflow({
                traceId,
                payload: { workers, jobRunId: '' },
            });

            expect(result.status).toBe(JobRunStatus.Failed);
            expect(executeRetryMigrationChildWorkflows).not.toHaveBeenCalled();
            expect(executeWorkerSetup).not.toHaveBeenCalled();
        });

        it('should return Failed status when jobRunId is undefined', async () => {
            const result = await RetryMigrationWorkflow({
                traceId,
                payload: { workers, jobRunId: undefined as any },
            });

            expect(result.status).toBe(JobRunStatus.Failed);
        });
    });

    describe('status propagation', () => {
        it('should propagate Stopped status from child workflows', async () => {
            (executeRetryMigrationChildWorkflows as jest.Mock).mockResolvedValue({
                status: JobRunStatus.Stopped,
                retryScanJobStatus: JobRunStatus.Stopped,
                syncJobStatus: JobRunStatus.Stopped,
            });

            const result = await RetryMigrationWorkflow({
                traceId,
                payload: { workers, jobRunId: originalJobRunId },
            });

            expect(result.status).toBe(JobRunStatus.Stopped);
            expect(handleReporting).toHaveBeenCalledWith(traceId, JobRunStatus.Stopped);
        });

        it('should propagate Failed status from child workflows', async () => {
            (executeRetryMigrationChildWorkflows as jest.Mock).mockResolvedValue({
                status: JobRunStatus.Failed,
                retryScanJobStatus: JobRunStatus.Failed,
                syncJobStatus: JobRunStatus.Running,
            });

            const result = await RetryMigrationWorkflow({
                traceId,
                payload: { workers, jobRunId: originalJobRunId },
            });

            expect(result.status).toBe(JobRunStatus.Failed);
        });
    });

    describe('error handling', () => {
        it('should propagate errors from executeWorkerSetup', async () => {
            (executeWorkerSetup as jest.Mock).mockRejectedValue(new Error('Worker setup failed'));

            await expect(
                RetryMigrationWorkflow({ traceId, payload: { workers, jobRunId: originalJobRunId } })
            ).rejects.toThrow('Worker setup failed');
        });

        it('should propagate errors from executeRetryMigrationChildWorkflows', async () => {
            (executeRetryMigrationChildWorkflows as jest.Mock).mockRejectedValue(
                new Error('Retry child workflow failed')
            );

            await expect(
                RetryMigrationWorkflow({ traceId, payload: { workers, jobRunId: originalJobRunId } })
            ).rejects.toThrow('Retry child workflow failed');
        });

        it('should propagate errors from handleReporting', async () => {
            (handleReporting as jest.Mock).mockRejectedValue(new Error('Reporting failed'));

            await expect(
                RetryMigrationWorkflow({ traceId, payload: { workers, jobRunId: originalJobRunId } })
            ).rejects.toThrow('Reporting failed');
        });

        it('should propagate errors from executeCleanup', async () => {
            // Reset handleReporting to success before testing cleanup failure
            (handleReporting as jest.Mock).mockResolvedValue(undefined);
            (executeCleanup as jest.Mock).mockRejectedValue(new Error('Cleanup failed'));

            await expect(
                RetryMigrationWorkflow({ traceId, payload: { workers, jobRunId: originalJobRunId } })
            ).rejects.toThrow('Cleanup failed');
        });
    });

    describe('workflow execution order', () => {
        it('should execute steps in correct order', async () => {
            const callOrder: string[] = [];

            (executeWorkerSetup as jest.Mock).mockImplementation(async () => {
                callOrder.push('workerSetup');
                return { setupCompletedWorkers: ['worker1'], failedWorkers: [] };
            });
            (waitUntilRedisMemoryOk as jest.Mock).mockImplementation(async () => {
                callOrder.push('redisMemoryCheck');
            });
            (executeRetryMigrationChildWorkflows as jest.Mock).mockImplementation(async () => {
                callOrder.push('retryChildWorkflows');
                return { status: JobRunStatus.Completed };
            });
            (handleReporting as jest.Mock).mockImplementation(async () => {
                callOrder.push('reporting');
            });
            (executeCleanup as jest.Mock).mockImplementation(async () => {
                callOrder.push('cleanup');
            });

            await RetryMigrationWorkflow({
                traceId,
                payload: { workers, jobRunId: originalJobRunId },
            });

            expect(callOrder).toEqual([
                'workerSetup',
                'redisMemoryCheck',
                'retryChildWorkflows',
                'reporting',
                'cleanup',
            ]);
        });
    });
});
