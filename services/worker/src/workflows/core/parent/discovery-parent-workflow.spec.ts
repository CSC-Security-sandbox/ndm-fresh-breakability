import { DiscoveryWorkflow } from './discovery-parent-workflow';
import { JobRunStatus } from 'src/activities/common/enums';
import * as setupWorkflow from '../common/execute-setup-workflow';
import * as memoryUtils from 'src/workflows/utils/memory-utils';
import * as childWorkflows from '../common/execute-discover-child-workflows';
import * as reporting from '../common/handle-reporting';
import * as cleanupWorkflow from '../common/execute-cleanup-workflow';

jest.mock('../common/execute-setup-workflow');
jest.mock('src/workflows/utils/memory-utils');
jest.mock('../common/execute-discover-child-workflows');
jest.mock('../common/handle-reporting');
jest.mock('../common/execute-cleanup-workflow');

describe('DiscoveryWorkflow', () => {
    const traceId = 'test-trace-id';
    const workers = ['worker1', 'worker2'];
    const options = { foo: 'bar' };

    beforeEach(() => {
        jest.clearAllMocks();

        (setupWorkflow.executeWorkerSetup as jest.Mock).mockResolvedValue({
            setupCompletedWorkers: ['worker1'],
            failedWorkers: ['worker2'],
        });

        (memoryUtils.waitUntilRedisMemoryOk as jest.Mock).mockResolvedValue(undefined);

        (childWorkflows.executeDiscoveryChildWorkflows as jest.Mock).mockResolvedValue({
            fileCount: 10,
            dirCount: 2,
            status: JobRunStatus.Completed,
        });

        (reporting.handleReporting as jest.Mock).mockResolvedValue(undefined);

        (cleanupWorkflow.executeCleanup as jest.Mock).mockResolvedValue(undefined);
    });

    it('should execute the workflow and return correct output', async () => {
        const input = { traceId, payload: { workers }, options };
        const result = await DiscoveryWorkflow(input);

        expect(setupWorkflow.executeWorkerSetup).toHaveBeenCalledWith({
            jobRunId: traceId,
            workerIds: workers,
            options,
        });

        expect(memoryUtils.waitUntilRedisMemoryOk).toHaveBeenCalledWith(traceId);

        expect(childWorkflows.executeDiscoveryChildWorkflows).toHaveBeenCalledWith({
            jobRunId: traceId,
        });

        expect(reporting.handleReporting).toHaveBeenCalledWith(traceId, JobRunStatus.Completed);

        expect(cleanupWorkflow.executeCleanup).toHaveBeenCalledWith({
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
        (setupWorkflow.executeWorkerSetup as jest.Mock).mockResolvedValue({
            setupCompletedWorkers: [],
            failedWorkers: [],
        });
        const input = { traceId, payload: { workers: [] } };
        const result = await DiscoveryWorkflow(input);

        expect(setupWorkflow.executeWorkerSetup).toHaveBeenCalledWith({
            jobRunId: traceId,
            workerIds: [],
            options: {},
        });

        expect(result.setupCompletedWorkers).toEqual([]);
        expect(result.failedWorkers).toEqual([]);
    });

    it('should propagate errors from setup', async () => {
        (setupWorkflow.executeWorkerSetup as jest.Mock).mockRejectedValue(new Error('setup failed'));
        await expect(
            DiscoveryWorkflow({ traceId, payload: { workers }, options })
        ).rejects.toThrow('setup failed');
    });

    it('should propagate errors from redis memory check', async () => {
        (memoryUtils.waitUntilRedisMemoryOk as jest.Mock).mockRejectedValue(new Error('redis error'));
        await expect(
            DiscoveryWorkflow({ traceId, payload: { workers }, options })
        ).rejects.toThrow('redis error');
    });

    it('should propagate errors from child workflow', async () => {
        (childWorkflows.executeDiscoveryChildWorkflows as jest.Mock).mockRejectedValue(new Error('child error'));
        await expect(
            DiscoveryWorkflow({ traceId, payload: { workers }, options })
        ).rejects.toThrow('child error');
    });

    it('should propagate errors from reporting', async () => {
        (reporting.handleReporting as jest.Mock).mockRejectedValue(new Error('report error'));
        await expect(
            DiscoveryWorkflow({ traceId, payload: { workers }, options })
        ).rejects.toThrow('report error');
    });

    it('should propagate errors from cleanup', async () => {
        (cleanupWorkflow.executeCleanup as jest.Mock).mockRejectedValue(new Error('cleanup error'));
        await expect(
            DiscoveryWorkflow({ traceId, payload: { workers }, options })
        ).rejects.toThrow('cleanup error');
    });
});