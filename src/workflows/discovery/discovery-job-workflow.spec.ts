import { proxyActivities, continueAsNew, ContinueAsNew } from '@temporalio/workflow';
import { DiscoveryJobWorkflow } from './discovery-job-workflow';
import { JobRunStatus } from 'src/activities/discovery/enums';

interface WorkflowArgs {
  traceId: string;
  options: any;
  workerId: string;
}

// Mock the proxyActivities
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest.fn(() => ({
    scanActivity: jest.fn(),
    publishTaskActivity: jest.fn(),
    discoveryStatusUpdate: jest.fn(),
    updateLastEntry: jest.fn(),
    getJobStateActivity: jest.fn(),
    updateStatusActivity: jest.fn(),
    setJobStateActivity: jest.fn(),
  })),
  continueAsNew: jest.fn(),
  ContinueAsNew: class MockContinueAsNew extends Error {
    constructor(args: any) {
      super('ContinueAsNew');
      this.name = 'ContinueAsNew';
    }
  },
}));

// Mock the console.log for tracing
const mockLog = jest.fn();
console.log = mockLog;

describe('DiscoveryJobWorkflow', () => {
  const traceId = 'test-trace-id';
  const workerId = 'test-worker-id';
  const baseArgs = { traceId, options: {}, workerId };

   // Define a complete mock job state
   const baseJobState = {
    status: JobRunStatus.Running,
    tasks_total: 0,
    tasks_completed: 0,
    workers_agreed: [],
    workers: [workerId],
    failedWorkers: [] // Ensure failedWorkers is always defined
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should start workflow and update status to Running', async () => {
    const mockGetJobState = jest.fn().mockResolvedValue({ ...baseJobState });
    const mockUpdateStatus = jest.fn().mockResolvedValue({});
    const mockScanActivity = jest.fn().mockResolvedValue({ isFatalErrored: false, noTaskFound: true });
    const mockPublishTask = jest.fn().mockResolvedValue({});
    const mockSetJobState = jest.fn().mockResolvedValue({});

    (proxyActivities as jest.Mock).mockReturnValueOnce({
      getJobStateActivity: mockGetJobState,
      updateStatusActivity: mockUpdateStatus,
      scanActivity: mockScanActivity,
      publishTaskActivity: mockPublishTask,
      setJobStateActivity: mockSetJobState,
      updateLastEntry: jest.fn(),
    });

    await DiscoveryJobWorkflow(baseArgs);

    expect(mockUpdateStatus).toHaveBeenCalledWith({
      jobRunId: traceId,
      status: JobRunStatus.Running
    });
  });

  it('should exit if job status is not Running', async () => {
    const mockGetJobState = jest.fn().mockResolvedValue({ 
      ...baseJobState, 
      status: JobRunStatus.Completed 
    });
    const mockUpdateStatus = jest.fn().mockResolvedValue({});

    (proxyActivities as jest.Mock).mockReturnValueOnce({
      getJobStateActivity: mockGetJobState,
      updateStatusActivity: mockUpdateStatus,
    });

    const result = await DiscoveryJobWorkflow(baseArgs);

    expect(result).toEqual({ message: 'Job status changed to COMPLETED' });
  });

  it('should handle no tasks found scenario and complete when all workers agree', async () => {
    const initialJobState = {
      ...baseJobState,
      tasks_total: 10,
      tasks_completed: 10,
      workers: [workerId, 'another-worker']
    };

    const updatedJobState = {
      ...initialJobState,
      workers_agreed: [workerId]
    };

    const completedJobState = {
      ...updatedJobState,
      workers_agreed: [workerId, 'another-worker'],
      status: JobRunStatus.Completed
    };

    const mockGetJobState = jest.fn()
      .mockResolvedValueOnce(initialJobState)
      .mockResolvedValueOnce(initialJobState)
      .mockResolvedValueOnce(updatedJobState)
      .mockResolvedValueOnce(completedJobState);

    const mockScanActivity = jest.fn().mockResolvedValue({ isFatalErrored: false, noTaskFound: true });
    const mockPublishTask = jest.fn().mockResolvedValue({});
    const mockSetJobState = jest.fn().mockResolvedValue({});
    const mockUpdateLastEntry = jest.fn().mockResolvedValue({});

    (proxyActivities as jest.Mock).mockReturnValueOnce({
      getJobStateActivity: mockGetJobState,
      scanActivity: mockScanActivity,
      publishTaskActivity: mockPublishTask,
      setJobStateActivity: mockSetJobState,
      updateLastEntry: mockUpdateLastEntry,
      updateStatusActivity: jest.fn(),
    });

    const result = await DiscoveryJobWorkflow(baseArgs);

    expect(result).toEqual({ message: 'Discovery completed' });
  });

  it('should continue processing when not all workers have agreed', async () => {
    const initialJobState = {
      status: JobRunStatus.Running,
      tasks_total: 10,
      tasks_completed: 10,
      workers_agreed: [],
      workers: [workerId, 'another-worker'],
      failedWorkers: []
    };

    const updatedJobState = {
      ...initialJobState,
      workers_agreed: [workerId]
    };

    const mockGetJobState = jest.fn()
      .mockResolvedValueOnce(initialJobState)
      .mockResolvedValueOnce(initialJobState)
      .mockResolvedValueOnce(updatedJobState);

    const mockScanActivity = jest.fn()
      .mockResolvedValueOnce({ isFatalErrored: false, noTaskFound: true })
      .mockResolvedValueOnce({ isFatalErrored: false, noTaskFound: false });

    const mockPublishTask = jest.fn().mockResolvedValue({});
    const mockSetJobState = jest.fn().mockResolvedValue({});

    (proxyActivities as jest.Mock).mockReturnValueOnce({
      getJobStateActivity: mockGetJobState,
      scanActivity: mockScanActivity,
      publishTaskActivity: mockPublishTask,
      setJobStateActivity: mockSetJobState,
      updateStatusActivity: jest.fn(),
    });

    await DiscoveryJobWorkflow(baseArgs);

    expect(mockSetJobState).toHaveBeenCalledWith(traceId, updatedJobState);
    expect(mockPublishTask).toHaveBeenCalledTimes(2);
  });

  it('should handle fatal error scenario', async () => {
    const initialJobState = {
      ...baseJobState,
      tasks_total: 10,
      tasks_completed: 5
    };

    const mockGetJobState = jest.fn().mockResolvedValue(initialJobState);
    const mockScanActivity = jest.fn().mockResolvedValue({ isFatalErrored: true, noTaskFound: false });
    const mockPublishTask = jest.fn().mockResolvedValue({});
    const mockSetJobState = jest.fn().mockResolvedValue({});

    (proxyActivities as jest.Mock).mockReturnValueOnce({
      getJobStateActivity: mockGetJobState,
      scanActivity: mockScanActivity,
      publishTaskActivity: mockPublishTask,
      setJobStateActivity: mockSetJobState,
      updateStatusActivity: jest.fn(),
    });

    await DiscoveryJobWorkflow(baseArgs);

    expect(mockLog).toHaveBeenCalledWith(traceId, `Fatal Error Occurred On worker ${workerId}`);
  });

  it('should continue as new when iteration limit is reached', async () => {
    const mockGetJobState = jest.fn().mockResolvedValue({ status: JobRunStatus.Running });
    const mockScanActivity = jest.fn().mockResolvedValue({ isFatalErrored: false, noTaskFound: false });
    const mockPublishTask = jest.fn().mockResolvedValue({});
    const mockContinueAsNew = jest.fn();

    (proxyActivities as jest.Mock).mockReturnValueOnce({
      getJobStateActivity: mockGetJobState,
      scanActivity: mockScanActivity,
      publishTaskActivity: mockPublishTask,
      updateStatusActivity: jest.fn(),
    });

    (continueAsNew as jest.Mock).mockImplementation(mockContinueAsNew);

    // Create a workflow that will run 80 iterations
    const workflow = async () => {
      let iteration = 0;
      while (iteration < 80) {
        iteration++;
        await DiscoveryJobWorkflow({ ...baseArgs, iteration });
      }
    };

    await workflow();

    expect(mockContinueAsNew).toHaveBeenCalledWith({ traceId, options: {} });
    expect(mockLog).toHaveBeenCalledWith(traceId, 'Iteration limit reached. Continuing as new...');
  });

  // it('should handle ContinueAsNew error', async () => {
  //   const mockGetJobState = jest.fn().mockResolvedValue({ status: JobRunStatus.Running });
  //   const mockScanActivity = jest.fn().mockResolvedValue({ isFatalErrored: false, noTaskFound: false });
  //   const mockPublishTask = jest.fn().mockResolvedValue({});
  //   const mockUpdateDiscoveryStatus = jest.fn().mockResolvedValue({});
  //   const mockUpdateLastEntry = jest.fn().mockResolvedValue({});

  //   (proxyActivities as jest.Mock).mockReturnValueOnce({
  //     getJobStateActivity: mockGetJobState,
  //     scanActivity: mockScanActivity,
  //     publishTaskActivity: mockPublishTask,
  //     discoveryStatusUpdate: mockUpdateDiscoveryStatus,
  //     updateLastEntry: mockUpdateLastEntry,
  //     updateStatusActivity: jest.fn(),
  //   });

  //   (continueAsNew as jest.Mock).mockImplementation(() => {
  //     throw new ContinueAsNew(baseArgs); // Now using the properly typed args
  //   });

  //   const result = await DiscoveryJobWorkflow(baseArgs);

  //   expect(mockLog).toHaveBeenCalledWith(traceId, 'Workflow continued as new: ContinueAsNew');
  //   expect(result).toBeUndefined();
  // });

  it('should handle unexpected errors and mark job as failed', async () => {
    const mockGetJobState = jest.fn().mockRejectedValue(new Error('Test error'));
    const mockUpdateDiscoveryStatus = jest.fn().mockResolvedValue({});
    const mockUpdateLastEntry = jest.fn().mockResolvedValue({});

    (proxyActivities as jest.Mock).mockReturnValueOnce({
      getJobStateActivity: mockGetJobState,
      discoveryStatusUpdate: mockUpdateDiscoveryStatus,
      updateLastEntry: mockUpdateLastEntry,
      updateStatusActivity: jest.fn(),
    });

    const result = await DiscoveryJobWorkflow(baseArgs);

    expect(mockUpdateDiscoveryStatus).toHaveBeenCalledWith(traceId, 'FAILED');
    expect(mockLog).toHaveBeenCalledWith(traceId, 'Discovery status updated to Failed');
    expect(mockUpdateLastEntry).toHaveBeenCalled();
    expect(result).toEqual({ message: 'Discovery failed' });
  });

  it('should handle error in updateDiscoveryStatus', async () => {
    const mockGetJobState = jest.fn().mockRejectedValue(new Error('Test error'));
    const mockUpdateDiscoveryStatus = jest.fn().mockRejectedValue(new Error('Status update failed'));
    const mockUpdateLastEntry = jest.fn().mockResolvedValue({});

    (proxyActivities as jest.Mock).mockReturnValueOnce({
      getJobStateActivity: mockGetJobState,
      discoveryStatusUpdate: mockUpdateDiscoveryStatus,
      updateLastEntry: mockUpdateLastEntry,
      updateStatusActivity: jest.fn(),
    });

    const result = await DiscoveryJobWorkflow(baseArgs);

    expect(mockUpdateDiscoveryStatus).toHaveBeenCalledWith(traceId, 'FAILED');
    expect(mockLog).toHaveBeenCalledWith(traceId, 'Failed to update discovery status: Error: Status update failed');
    expect(mockUpdateLastEntry).toHaveBeenCalled();
    expect(result).toEqual({ message: 'Discovery failed' });
  });

  it('should handle error in updateLastEntry during failure', async () => {
    const mockGetJobState = jest.fn().mockRejectedValue(new Error('Test error'));
    const mockUpdateDiscoveryStatus = jest.fn().mockResolvedValue({});
    const mockUpdateLastEntry = jest.fn().mockRejectedValue(new Error('Last entry failed'));

    (proxyActivities as jest.Mock).mockReturnValueOnce({
      getJobStateActivity: mockGetJobState,
      discoveryStatusUpdate: mockUpdateDiscoveryStatus,
      updateLastEntry: mockUpdateLastEntry,
      updateStatusActivity: jest.fn(),
    });

    const result = await DiscoveryJobWorkflow(baseArgs);

    expect(mockUpdateDiscoveryStatus).toHaveBeenCalledWith(traceId, 'FAILED');
    expect(mockLog).toHaveBeenCalledWith(traceId, 'Discovery status updated to Failed');
    expect(mockUpdateLastEntry).toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledWith(traceId, 'Failed to update discovery status: Error: Last entry failed');
    expect(result).toEqual({ message: 'Discovery failed' });
  });
});
