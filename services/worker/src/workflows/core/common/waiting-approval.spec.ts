import { waitForApproval, approveSignal } from './waiting-approval';
import { CutOverStatus } from 'src/activities/migrate/migrate.type';
import * as wf from '@temporalio/workflow';

jest.mock('@temporalio/workflow', () => {
    const actual = jest.requireActual('@temporalio/workflow');
    return {
        ...actual,
        proxyActivities: jest.fn().mockReturnValue({
            updateCutOverStatus: jest.fn().mockResolvedValue(undefined),
        }),
        defineSignal: jest.fn().mockImplementation(() => Symbol('signal')),
        defineQuery: jest.fn().mockImplementation(() => Symbol('query')),
        setHandler: jest.fn(),
        condition: jest.fn(),
        log: {
            info: jest.fn(),
        },
        CancelledFailure: class extends Error {},
    };
});

describe('waitForApproval', () => {
    const jobRunId = 'test-job-run-id';
    let updateCutOverStatusActivity: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        // @ts-ignore
        updateCutOverStatusActivity = wf.proxyActivities().updateCutOverStatus;
    });

    it('should throw if workflow is cancelled', async () => {
        (wf.condition as jest.Mock).mockImplementation(() => {
            throw new wf.CancelledFailure('cancelled');
        });

        await expect(waitForApproval(jobRunId)).rejects.toThrow('cancelled');
        expect(wf.log.info).toHaveBeenCalledWith('Workflow cancelled');
    });

    it('should return "No approval received" if approval_status is undefined', async () => {
        // Simulate unblock without setting approval_status
        (wf.setHandler as jest.Mock).mockImplementation(() => {});
        (wf.condition as jest.Mock).mockImplementation(async (fn: () => boolean) => {
            // Unblock immediately
            return;
        });

        // @ts-ignore
        updateCutOverStatusActivity.mockResolvedValue(undefined);

        const result = await waitForApproval(jobRunId);

        expect(result).toBe('No approval received');
    });
});