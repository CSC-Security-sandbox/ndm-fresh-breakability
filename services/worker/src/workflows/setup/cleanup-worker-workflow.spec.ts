import { CleanupWorkerWorkflow } from './cleanup-worker-workflow';
import { JobServiceJobType } from 'src/activities/discovery/enums';
const mockCleanup = require('@temporalio/workflow').proxyActivities().cleanup;
const mockSpeedTestCleanup = require('@temporalio/workflow').proxyActivities().speedTestCleanup;

// Mock proxyActivities and its returned activities
jest.mock('@temporalio/workflow', () => ({
    proxyActivities: jest.fn().mockReturnValue({
        cleanup: jest.fn(),
        speedTestCleanup: jest.fn(),
    }),
}));


describe('CleanupWorkerWorkflow', () => {
    const traceId = 'trace-123';
    const jobRunId = 'job-456';
    const fsDetails = { some: 'details' };
    const protocolType = 'NFS';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should call cleanupWorkerActivity for non-SPEED_TEST jobType', async () => {
        const args = {
            traceId,
            jobType: 'SOME_OTHER_JOB',
            jobRunId,
        };
        mockCleanup.mockResolvedValue('cleanup-result');

        const result = await CleanupWorkerWorkflow(args);

        expect(mockCleanup).toHaveBeenCalledWith(jobRunId);
        expect(mockSpeedTestCleanup).not.toHaveBeenCalled();
        expect(result).toBe('cleanup-result');
    });

    it('should call cleanupSpeedTestWorkerActivity for SPEED_TEST jobType', async () => {
        const args = {
            traceId,
            jobType: JobServiceJobType.SPEED_TEST,
            jobRunId,
            fsDetails,
            protocolType,
        };
        mockSpeedTestCleanup.mockResolvedValue('speedtest-cleanup-result');

        const result = await CleanupWorkerWorkflow(args);

        expect(mockSpeedTestCleanup).toHaveBeenCalledWith(jobRunId, fsDetails, protocolType);
        expect(mockCleanup).not.toHaveBeenCalled();
        expect(result).toBe('speedtest-cleanup-result');
    });

    it('should log the start of the workflow', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        const args = {
            traceId,
            jobType: 'SOME_OTHER_JOB',
            jobRunId,
        };
        mockCleanup.mockResolvedValue('cleanup-result');

        await CleanupWorkerWorkflow(args);

        expect(consoleSpy).toHaveBeenCalledWith(
            `[${traceId}] Starting CleanupWorkerWorkflow with args: ${JSON.stringify(args)}`
        );
        consoleSpy.mockRestore();
    });
});