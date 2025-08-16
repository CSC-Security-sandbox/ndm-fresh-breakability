import { SpeedTestWorkflow } from './speed-test-workflow';
import { TaskStatus } from 'src/activities/common/enums';
const { executeChild } = require('@temporalio/workflow');
const { proxyActivities } = require('@temporalio/workflow');

// Mocks
jest.mock('@temporalio/workflow', () => {
    return {
        proxyActivities: jest.fn().mockReturnValue({
            getJobState: jest.fn(),
            setJobState: jest.fn(),
        }),
        executeChild: jest.fn(),
        ChildWorkflowCancellationType: { WAIT_CANCELLATION_COMPLETED: 'WAIT_CANCELLATION_COMPLETED' },
        ParentClosePolicy: { TERMINATE: 'TERMINATE' },
        defineSignal: jest.fn(() => jest.fn()),
    };
});
jest.mock('../setup/setup-worker-workflow', () => ({
    SetupWorkerWorkflow: jest.fn(),
}));
jest.mock('../setup/cleanup-worker-workflow', () => ({
    CleanupWorkerWorkflow: jest.fn(),
}));
jest.mock('./speed-test-job-workflow', () => ({
    SpeedTestJobWorkflow: jest.fn(),
}));


describe('SpeedTestWorkflow', () => {
    const traceId = 'test-trace-id';
    const options = { someOption: true };
    const payload = [
        {
            fileServer: 'fs1',
            protocol: 'NFS',
            readTest: true,
            writeTest: false,
            packetLossTest: true,
            fileServerDetails: {
                host: 'host1',
                userName: 'user1',
                password: 'pass1',
                volumes: {
                    id: 'vol1',
                    volumePath: '/mnt/vol1',
                },
            },
            workerEntities: [
                { workersId: 'worker1' },
                { workersId: 'worker2' },
            ],
        },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        // Setup proxyActivities mocks
        proxyActivities.mockReturnValue({
            getJobState: jest.fn().mockResolvedValue({ workers: [], status: TaskStatus.Pending }),
            setJobState: jest.fn().mockResolvedValue(undefined),
        });
    });

    it('should run setup, speed test, and cleanup workflows for active workers', async () => {
        executeChild
            .mockResolvedValueOnce([{ status: 'success', workerId: 'worker1', fsDetails: 'fsDetails1', fileServerId: 'fs1', volumeId: 'vol1', protocolType: 'NFS', tests: { readTest: true, writeTest: false, networkPerformance: true } }])
            .mockResolvedValueOnce([{ status: 'success', workerId: 'worker2', fsDetails: 'fsDetails2', fileServerId: 'fs1', volumeId: 'vol1', protocolType: 'NFS', tests: { readTest: true, writeTest: false, networkPerformance: true } }])
            .mockResolvedValueOnce({ job: 'speedTestResult1' })
            .mockResolvedValueOnce({ job: 'speedTestResult2' })
            .mockResolvedValueOnce({ cleanup: 'done1' })
            .mockResolvedValueOnce({ cleanup: 'done2' });

        proxyActivities.mockReturnValue({
            getJobState: jest.fn()
                .mockResolvedValueOnce({ workers: [], status: TaskStatus.Pending })
                .mockResolvedValueOnce({ workers: ['worker1'], status: TaskStatus.Pending }),
            setJobState: jest.fn().mockResolvedValue(undefined),
        });
        const result = await SpeedTestWorkflow({ traceId, payload, options });
        expect(result.status).toBe('error');
    });

    it('should return error if SpeedTestJobWorkflow throws', async () => {
        executeChild
            .mockResolvedValueOnce([{ status: 'success', workerId: 'worker1', fsDetails: 'fsDetails1', fileServerId: 'fs1', volumeId: 'vol1', protocolType: 'NFS', tests: { readTest: true, writeTest: false, networkPerformance: true } }])
            .mockImplementationOnce(() => { throw new Error('SpeedTestJobWorkflow failed'); });

        proxyActivities.mockReturnValue({
            getJobState: jest.fn().mockResolvedValue({ workers: [], status: TaskStatus.Pending }),
            setJobState: jest.fn().mockResolvedValue(undefined),
        });

        const result = await SpeedTestWorkflow({ traceId, payload, options });
        expect(result.status).toBe('error');
    });

    it('should handle ContinueAsNew error in SpeedTestJobWorkflow', async () => {
        executeChild
            .mockResolvedValueOnce([{ status: 'success', workerId: 'worker1', fsDetails: 'fsDetails1', fileServerId: 'fs1', volumeId: 'vol1', protocolType: 'NFS', tests: { readTest: true, writeTest: false, networkPerformance: true } }])
            .mockImplementationOnce(() => {
                const err = new Error('ContinueAsNew');
                err.name = 'ContinueAsNew';
                throw err;
            })
            .mockResolvedValueOnce({ job: 'speedTestResult1' })
            .mockResolvedValueOnce({ cleanup: 'done1' });

        proxyActivities.mockReturnValue({
            getJobState: jest.fn().mockResolvedValue({ workers: [], status: TaskStatus.Pending }),
            setJobState: jest.fn().mockResolvedValue(undefined),
        });

        const result = await SpeedTestWorkflow({ traceId, payload, options });
        expect(result.status).toBe('error');
    });
});