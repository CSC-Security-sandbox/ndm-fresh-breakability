import * as wf from '@temporalio/workflow';
import { updateJobStatusIfNotRunning } from './workflow-utils';
import { JobRunStatus } from 'src/activities/common/enums';

jest.mock('@temporalio/workflow', () => {
    const actual = jest.requireActual('@temporalio/workflow');
    return {
        ...actual,
        proxyActivities: jest.fn().mockReturnValue({
            updateStatus: jest.fn(),
        }),
    };
});

describe('updateJobStatusIfNotRunning', () => {
    const mockUpdateStatus = (wf.proxyActivities as jest.Mock).mock.results[0].value.updateStatus;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should call updateJobStatusActivity if state is not Running', async () => {
        await updateJobStatusIfNotRunning(JobRunStatus.Completed, 'job-123');
        expect(mockUpdateStatus).toHaveBeenCalledWith({ jobRunId: 'job-123', status: JobRunStatus.Completed });
    });

    it('should not call updateJobStatusActivity if state is Running', async () => {
        await updateJobStatusIfNotRunning(JobRunStatus.Running, 'job-456');
        expect(mockUpdateStatus).not.toHaveBeenCalled();
    });
});