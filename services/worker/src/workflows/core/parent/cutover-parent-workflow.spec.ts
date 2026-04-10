import { CutOverWorkFlow } from './cutover-parent-workflow';
import { JobRunStatus } from 'src/activities/common/enums';
import { executeWorkerSetup } from '../common/execute-setup-workflow';
import { waitUntilRedisMemoryOk } from 'src/workflows/utils/memory-utils';
import { executeMigrationChildWorkflows } from '../common/execute-migration-child-workflows';
import { handleReporting } from '../common/handle-reporting';
import { waitForApproval } from '../common/waiting-approval';
import { executeCleanup } from '../common/execute-cleanup-workflow';

jest.mock('../common/execute-setup-workflow');
jest.mock('src/workflows/utils/memory-utils');
jest.mock('../common/execute-migration-child-workflows');
jest.mock('../common/handle-reporting');
jest.mock('../common/waiting-approval');
jest.mock('../common/execute-cleanup-workflow');

describe('CutOverWorkFlow', () => {
const traceId = 'test-trace-id';
const workers = ['worker1', 'worker2'];
const options = { foo: 'bar' };

beforeEach(() => {
    jest.clearAllMocks();

    (executeWorkerSetup as jest.Mock).mockResolvedValue({
        setupCompletedWorkers: ['worker1'],
        failedWorkers: ['worker2'],
    });

    (waitUntilRedisMemoryOk as jest.Mock).mockResolvedValue(undefined);

    (executeMigrationChildWorkflows as jest.Mock).mockResolvedValue({
        fileCount: 10,
        dirCount: 2,
        status: JobRunStatus.Completed,
        excludedPaths: [],
        skippedPaths: [],
    });

    (handleReporting as jest.Mock).mockResolvedValue(undefined);
    (waitForApproval as jest.Mock).mockResolvedValue(undefined);
    (executeCleanup as jest.Mock).mockResolvedValue(undefined);
});

it('should execute the workflow and return expected output', async () => {
    const result = await CutOverWorkFlow({
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
    expect(executeMigrationChildWorkflows).toHaveBeenCalledWith({ jobRunId: traceId });
    expect(handleReporting).toHaveBeenCalledWith(traceId, JobRunStatus.Completed, {
        excludedPaths: [],
        skippedPaths: [],
    });
    expect(waitForApproval).toHaveBeenCalledWith(traceId);
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
        excludedPaths: [],
        skippedPaths: [],
    });
});

it('should handle empty workers array', async () => {
    (executeWorkerSetup as jest.Mock).mockResolvedValue({
        setupCompletedWorkers: [],
        failedWorkers: [],
    });
    const result = await CutOverWorkFlow({
        traceId,
        payload: { workers: [] },
    });

    expect(result.setupCompletedWorkers).toEqual([]);
    expect(result.failedWorkers).toEqual([]);
});

it('should propagate errors from executeWorkerSetup', async () => {
    (executeWorkerSetup as jest.Mock).mockRejectedValue(new Error('setup failed'));
    await expect(
        CutOverWorkFlow({ traceId, payload: { workers }, options })
    ).rejects.toThrow('setup failed');
});

it('should propagate errors from executeMigrationChildWorkflows', async () => {
    (executeMigrationChildWorkflows as jest.Mock).mockRejectedValue(new Error('migration failed'));
    await expect(
        CutOverWorkFlow({ traceId, payload: { workers }, options })
    ).rejects.toThrow('migration failed');
});

it('should propagate errors from waitUntilRedisMemoryOk', async () => {
    (waitUntilRedisMemoryOk as jest.Mock).mockRejectedValue(new Error('redis error'));
    await expect(
        CutOverWorkFlow({ traceId, payload: { workers }, options })
    ).rejects.toThrow('redis error');
});
});