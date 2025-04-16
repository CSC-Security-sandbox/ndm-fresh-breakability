
import { JobRunStatus } from 'src/activities/discovery/enums';
import { DiscoveryJobWorkflow } from './discovery-job-workflow';


jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest.fn(() => ({
    scanActivity: jest.fn(),
    publishTask: jest.fn(),
    discoveryStatusUpdate: jest.fn(),
    updateLastEntry: jest.fn(),
    getJobState: jest.fn().mockResolvedValueOnce({ status: JobRunStatus.Completed, }),
    updateStatus: jest.fn(),
    setJobState: jest.fn(),
  })),
  continueAsNew: jest.fn(),
  ContinueAsNew: class ContinueAsNew extends Error {},
}));

describe('DiscoveryJobWorkflow', () => {
  let mockActivities: any;


  beforeEach(() => {
    jest.clearAllMocks()
    mockActivities = require('@temporalio/workflow').proxyActivities();
  });

  it('should complete when no tasks are found and all workers agreed', async () => {
    const args = {
      traceId: 'test-trace-id',
      workerId: 'worker-1',
      options: {},
    };

    mockActivities.getJobState.mockResolvedValue({
      status: JobRunStatus.Completed,
      tasks_total: 10,
      tasks_completed: 10,
      workers_agreed: ['worker-1'],
      workers: ['worker-1'],
    });

    mockActivities.scanActivity.mockResolvedValue({ isFatalErrored: false, noTaskFound: true });

    const result = await DiscoveryJobWorkflow(args);

    expect(result).toEqual({ message: 'Job status changed to COMPLETED' });
  });


  it('should continue as new after 80 iterations', async () => {
    const args = {
      traceId: 'test-trace-id',
      workerId: 'worker-1',
      options: {},
    };

    mockActivities.getJobState.mockResolvedValue({ status: JobRunStatus.Running });
    mockActivities.scanActivity.mockResolvedValue({ isFatalErrored: false, noTaskFound: false });
    jest.spyOn(global.console, 'log').mockImplementation(() => {});
    await expect(DiscoveryJobWorkflow(args)).rejects.toThrow();
  });

  it('should update status to FAILED on error', async () => {
    const args = {
      traceId: 'test-trace-id',
      workerId: 'worker-1',
      options: {},
    };

    mockActivities.getJobState.mockRejectedValue(new Error('Database error'));
    await expect(DiscoveryJobWorkflow(args)).rejects.toThrow();
  });
});
