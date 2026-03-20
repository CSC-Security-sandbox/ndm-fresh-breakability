import { MigrationWorkflow } from './migration-parent-workflow';
import { JobRunStatus } from 'src/activities/common/enums';
import { waitUntilRedisMemoryOk } from 'src/workflows/utils/memory-utils';
import { executeCleanup } from '../common/execute-cleanup-workflow';
import { executeMigrationChildWorkflows } from '../common/execute-migration-child-workflows';
import { handleReporting } from '../common/handle-reporting';
import { executeWorkerSetup } from '../common/execute-setup-workflow';

jest.mock('src/workflows/utils/memory-utils', () => ({
    waitUntilRedisMemoryOk: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../common/execute-cleanup-workflow', () => ({
    executeCleanup: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../common/execute-migration-child-workflows', () => ({
    executeMigrationChildWorkflows: jest.fn(),
}));
jest.mock('../common/handle-reporting', () => ({
    handleReporting: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../common/execute-setup-workflow', () => ({
    executeWorkerSetup: jest.fn(),
}));


describe('MigrationWorkflow', () => {
    const traceId = 'test-trace-id';
    const workers = ['worker1', 'worker2'];
    const options = { foo: 'bar' };

    beforeEach(() => {
        jest.clearAllMocks();
        (executeWorkerSetup as jest.Mock).mockResolvedValue({
            setupCompletedWorkers: ['worker1'],
            failedWorkers: ['worker2'],
        });
        (executeMigrationChildWorkflows as jest.Mock).mockResolvedValue({
            fileCount: 10,
            dirCount: 2,
            status: JobRunStatus.Completed,
        });
    });

    it('should execute the workflow and return expected output', async () => {
        const result = await MigrationWorkflow({
            traceId,
            payload: { workers },
            options,
        });

        expect(executeWorkerSetup).toHaveBeenCalledWith({
            jobRunId: traceId,
            workerIds: workers,
            options,
        });
        expect(waitUntilRedisMemoryOk).toHaveBeenCalledWith(traceId);
        expect(executeMigrationChildWorkflows).toHaveBeenCalledWith({
            jobRunId: traceId,
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
            fileCount: 10,
            dirCount: 2,
            status: JobRunStatus.Completed,
        });
    });

    it('should handle empty workers and default options', async () => {
        (executeWorkerSetup as jest.Mock).mockResolvedValue({
            setupCompletedWorkers: [],
            failedWorkers: [],
        });
        (executeMigrationChildWorkflows as jest.Mock).mockResolvedValue({
            fileCount: 0,
            dirCount: 0,
            status: JobRunStatus.Ready,
        });

        const result = await MigrationWorkflow({
            traceId,
            payload: { workers: [] },
        });

        expect(result).toEqual({
            traceId,
            setupCompletedWorkers: [],
            failedWorkers: [],
            fileCount: 0,
            dirCount: 0,
            status: JobRunStatus.Ready,
        });
    });

    it('should propagate errors from executeWorkerSetup', async () => {
        (executeWorkerSetup as jest.Mock).mockRejectedValue(new Error('setup error'));
        await expect(
            MigrationWorkflow({ traceId, payload: { workers }, options })
        ).rejects.toThrow('setup error');
    });

    it('should propagate errors from executeMigrationChildWorkflows', async () => {
        (executeMigrationChildWorkflows as jest.Mock).mockRejectedValue(new Error('child error'));
        await expect(
            MigrationWorkflow({ traceId, payload: { workers }, options })
        ).rejects.toThrow('child error');
    });
});