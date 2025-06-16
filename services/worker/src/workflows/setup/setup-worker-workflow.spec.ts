import { SetupWorkerWorkflow } from './setup-worker-workflow';
import { JobServiceJobType } from 'src/activities/discovery/enums';
const mockSetup = require('@temporalio/workflow').proxyActivities().setup;
const mockSpeedTestSetup = require('@temporalio/workflow').proxyActivities().speedTestSetup;

// Mock proxyActivities and its returned activities
jest.mock('@temporalio/workflow', () => ({
    proxyActivities: jest.fn().mockReturnValue({
        setup: jest.fn(),
        speedTestSetup: jest.fn(),
    }),
}));


describe('SetupWorkerWorkflow', () => {
    const baseArgs = {
        traceId: 'trace-123',
        jobRunId: 'job-456',
        hostname: 'host1',
        protocols: ['nfs'],
        pathId: 'path-789',
        path: '/mnt/data',
        username: 'user',
        password: 'pass',
        protocolType: 'nfs',
        fileServer: {
            fileServer: 'fs-001',
            jobConfig: { jobType: JobServiceJobType.SPEED_TEST }
        },
        volumeId: 'vol-002',
        tests: ['test1', 'test2'],
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should call speedTestSetup when jobType is SPEED_TEST', async () => {
        const expectedOutput = { result: 'speedTest' };
        mockSpeedTestSetup.mockResolvedValue(expectedOutput);

        const result = await SetupWorkerWorkflow(baseArgs);

        expect(mockSpeedTestSetup).toHaveBeenCalledWith({
            jobRunId: baseArgs.jobRunId,
            hostname: baseArgs.hostname,
            protocols: baseArgs.protocols,
            pathId: baseArgs.pathId,
            path: baseArgs.path,
            userName: baseArgs.username,
            password: baseArgs.password,
            protocolType: baseArgs.protocolType,
            fileServerId: baseArgs.fileServer.fileServer,
            volumeId: baseArgs.volumeId,
            tests: baseArgs.tests,
        });
        expect(result).toBe(expectedOutput);
        expect(mockSetup).not.toHaveBeenCalled();
    });

    it('should call setup when jobType is not SPEED_TEST', async () => {
        const args = {
            ...baseArgs,
            fileServer: {
                ...baseArgs.fileServer,
                jobConfig: { jobType: 'OTHER_JOB_TYPE' }
            }
        };
        const expectedOutput = { result: 'setup' };
        mockSetup.mockResolvedValue(expectedOutput);

        const result = await SetupWorkerWorkflow(args);

        expect(mockSetup).toHaveBeenCalledWith(args.jobRunId);
        expect(result).toBe(expectedOutput);
        expect(mockSpeedTestSetup).not.toHaveBeenCalled();
    });

    it('should call setup when fileServer is undefined', async () => {
        const args = { ...baseArgs, fileServer: undefined };
        const expectedOutput = { result: 'setup' };
        mockSetup.mockResolvedValue(expectedOutput);

        const result = await SetupWorkerWorkflow(args);

        expect(mockSetup).toHaveBeenCalledWith(args.jobRunId);
        expect(result).toBe(expectedOutput);
        expect(mockSpeedTestSetup).not.toHaveBeenCalled();
    });

    it('should log the start of the workflow', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        mockSpeedTestSetup.mockResolvedValue({});

        await SetupWorkerWorkflow(baseArgs);

        expect(consoleSpy).toHaveBeenCalledWith(
            `[${baseArgs.traceId}] Starting SetupWorkerWorkflow with args: ${JSON.stringify(baseArgs)}`
        );
        consoleSpy.mockRestore();
    });
});