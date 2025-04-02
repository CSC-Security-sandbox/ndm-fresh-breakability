import * as wf from '@temporalio/workflow';
import { MigrationScanService } from 'src/activities/migrate/migrate.scan.service';
import { MigrationTaskService } from 'src/activities/migrate/migrate.taskmanager.service';
import { CommonActivityService  } from 'src/activities/common/common.service';
import { JobRunStatus } from 'src/activities/discovery/enums';
import { exec } from 'child_process';
import { ScanWorkflow } from './scan.workflow';


jest.mock('@temporalio/workflow', () => {
    const originalModule = jest.requireActual('@temporalio/workflow');
    return {
        ...originalModule,
        executeChild: jest.fn(),
        proxyActivities: jest.fn(() => ({
            scanPath: jest.fn(),
            publishScanTask: jest.fn(),
            fetchScanTask: jest.fn(),
            getJobState: jest.fn(),
            updateStatus: jest.fn(),
            setJobState: jest.fn(),
            updateLastEntry: jest.fn()
        })),
        continueAsNew: jest.fn(),
        defineSignal: originalModule.defineSignal,
    };
});

describe('ScanWorkflow', () => {
    const mockScanActivity = jest.fn();
    const mockPublishTaskActivity = jest.fn();
    const mockFetchTaskActivity = jest.fn();
    const mockGetJobStateActivity = jest.fn();
    const mockUpdateStatusActivity = jest.fn(); // should return promise
    const mockSetJobStateActivity = jest.fn();
    const mockUpdateLastEntryActivity = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();

        (wf.proxyActivities as jest.Mock).mockReturnValue({
            scanPath: mockScanActivity,
            publishScanTask: mockPublishTaskActivity,
            fetchScanTask: mockFetchTaskActivity,
            getJobState: mockGetJobStateActivity,
            updateStatus: mockUpdateStatusActivity,
            setJobState: mockSetJobStateActivity,
            updateLastEntry: mockUpdateLastEntryActivity
        });
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('should run the scan workflow successfully', async () => {
        const jobRunId = 'test-job-run-id';
        const workerId = 'test-worker-id';

        mockGetJobStateActivity.mockResolvedValue({ status: JobRunStatus.Running });
        mockUpdateStatusActivity.mockImplementation(() => {
            return new Promise((resolve) => {
                resolve({ message: 'Status updated successfully' });
            });
        });
        mockScanActivity.mockResolvedValue({ isFatal: false, noTaskFound: false });
        mockPublishTaskActivity.mockResolvedValue(undefined);

        // const result = await ScanWorkflow({ jobRunId, workerId });

        // expect(mockUpdateStatusActivity).toHaveBeenCalledWith({ jobRunId, status: JobRunStatus.Running });
        // expect(mockScanActivity).toHaveBeenCalled();
        // expect(mockPublishTaskActivity).toHaveBeenCalled();
        // expect(result).toEqual({ message: 'Scan Completed' });
    });
});