import * as wf from '@temporalio/workflow';
import { ReportingWorkflow } from './reporting.workflow';
import { JobReportType } from './reporting.types';
import { MigrationTaskService } from 'src/activities/migrate/migrate.taskmanager.service';
import { JobRunStatus } from 'src/activities/discovery/enums';
import { DiscoveryActivity } from 'src/activities/discovery/discovery.activities';
import { CommonActivityService } from 'src/activities/common/common.service';

jest.mock('src/activities/migrate/migrate.taskmanager.service');
jest.mock('src/activities/discovery/discovery.activities');
jest.mock('src/activities/common/common.service');

const mockGenerateDiscoveryReport = jest.fn();
const mockGenerateCOCReport = jest.fn();
const mockUpdateStatus = jest.fn();
const mockGetJobState = jest.fn();
const mockGenerateJobsReport = jest.fn();

(DiscoveryActivity as jest.Mock).mockImplementation(() => ({
  generateDiscoveryReport: mockGenerateDiscoveryReport,
}));

(MigrationTaskService as jest.Mock).mockImplementation(() => ({
  generateCOCReport: mockGenerateCOCReport,
}));

(CommonActivityService as jest.Mock).mockImplementation(() => ({
  updateStatus: mockUpdateStatus,
  getJobState: mockGetJobState,
  generateJobsReport: mockGenerateJobsReport,
}));

describe('ReportingWorkflow', () => {
  const traceId = 'trace-id';
  const signal = wf.defineSignal<[string], string>('reportSignal');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle CUT_OVER report type', async () => {
    const jobState = { failedWorkers: [], workers: ['worker1'] };
    mockGetJobState.mockResolvedValue(jobState);
    const expectedStatus = JobRunStatus.Completed;

    // Simulate the signal for CUT_OVER
    await signal(JobReportType.CUT_OVER);

    const result = await ReportingWorkflow(traceId, signal);

    expect(mockUpdateStatus).toHaveBeenCalledWith({ jobRunId: traceId, status: expectedStatus });
    expect(mockGenerateCOCReport).toHaveBeenCalledWith(traceId);
    expect(mockGenerateJobsReport).toHaveBeenCalledWith(traceId);
    expect(result).toBe('REPORTING COMPLETED');
  });

  it('should handle DISCOVER report type', async () => {
    const jobState = { failedWorkers: [], workers: ['worker1'] };
    mockGetJobState.mockResolvedValue(jobState);
    const expectedStatus = JobRunStatus.Completed;

    // Simulate the signal for DISCOVER
    await signal(JobReportType.DISCOVER);

    const result = await ReportingWorkflow(traceId, signal);

    expect(mockUpdateStatus).toHaveBeenCalledWith({ jobRunId: traceId, status: expectedStatus });
    expect(mockGenerateDiscoveryReport).toHaveBeenCalledWith(traceId);
    expect(result).toBe('REPORTING COMPLETED');
  });

  it('should handle MIGRATE report type', async () => {
    const jobState = { failedWorkers: [], workers: ['worker1'] };
    mockGetJobState.mockResolvedValue(jobState);
    const expectedStatus = JobRunStatus.Completed;

    // Simulate the signal for MIGRATE
    await signal(JobReportType.MIGRATE);

    const result = await ReportingWorkflow(traceId, signal);

    expect(mockUpdateStatus).toHaveBeenCalledWith({ jobRunId: traceId, status: expectedStatus });
    expect(mockGenerateCOCReport).toHaveBeenCalledWith(traceId);
    expect(result).toBe('REPORTING COMPLETED');
  });

  it('should throw an error for unknown report type', async () => {
    const jobState = { failedWorkers: [], workers: ['worker1'] };
    mockGetJobState.mockResolvedValue(jobState);

    // Simulate the signal for an unknown report type
    await signal('UNKNOWN_TYPE');

    await expect(ReportingWorkflow(traceId, signal)).rejects.toThrow('Unknown REPORT TYPE');
  });

  it('should handle workflow cancellation', async () => {
    const jobState = { failedWorkers: [], workers: ['worker1'] };
    mockGetJobState.mockResolvedValue(jobState);

    // Simulate cancellation
    const cancelSignal = wf.defineSignal('cancel');
    wf.setHandler(cancelSignal, () => {
      throw new wf.CancelledFailure('Workflow was cancelled');
    });

    await expect(ReportingWorkflow(traceId, cancelSignal)).rejects.toThrow(wf.CancelledFailure);
  });
});
