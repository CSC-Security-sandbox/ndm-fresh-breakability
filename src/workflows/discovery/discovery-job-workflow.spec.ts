import { DiscoveryJobWorkflow } from './discovery-job-workflow';
import { proxyActivities, continueAsNew } from '@temporalio/workflow';
import { JobRunStatus } from 'src/activities/discovery/enums';
import { ContinueAsNew } from '@temporalio/workflow';

// Mock the console.log to prevent actual logging during tests
console.log = jest.fn();

// Mock proxyActivities
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest.fn(),
  continueAsNew: jest.fn(),
  ContinueAsNew: jest.fn().mockImplementation((message) => ({
    name: 'ContinueAsNew',
    message,
    stack: ''
  }))
}));

describe('DiscoveryJobWorkflow', () => {
  const mockTraceId = 'test-trace-id';
  const mockWorkerId = 'worker-1';
  const mockOptions = {};

  const mockActivities = {
    scanActivity: jest.fn(),
    publishTaskActivity: jest.fn(),
    updateDiscoveryStatus: jest.fn(),
    updateLastEntry: jest.fn(),
    getJobStateActivity: jest.fn(),
    updateStatusActivity: jest.fn(),
    setJobStateActivity: jest.fn(),
  };

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Setup mock implementations
    (proxyActivities as jest.Mock).mockImplementation(() => mockActivities);
  });

  describe('Workflow Scenarios', () => {
    it('should complete workflow when no tasks are found and all workers agree', async () => {
      // Setup mock job state
      mockActivities.getJobStateActivity.mockResolvedValueOnce({
        status: JobRunStatus.Running,
        tasks_total: 0,
        tasks_completed: 0,
        workers: ['worker-1', 'worker-2'],
        workers_agreed: [],
      }).mockResolvedValueOnce({
        status: JobRunStatus.Running,
        tasks_total: 0,
        tasks_completed: 0,
        workers: ['worker-1', 'worker-2'],
        workers_agreed: ['worker-1'],
      });

      // Mock scan activity to return no tasks
      mockActivities.scanActivity.mockResolvedValue({ 
        noTaskFound: true,
        isFatalErrored: false 
      });

      const result = await DiscoveryJobWorkflow({ 
        traceId: mockTraceId, 
        options: mockOptions, 
        workerId: mockWorkerId 
      });

      expect(result).toEqual({ message: 'Discovery completed' });
      expect(mockActivities.updateLastEntry).toHaveBeenCalledWith(mockTraceId);
      expect(mockActivities.setJobStateActivity).toHaveBeenCalledWith(
        mockTraceId, 
        expect.objectContaining({ 
          status: JobRunStatus.Completed,
          workers_agreed: ['worker-1']
        })
      );
    });

    it('should continue workflow when job status is not completed', async () => {
      // Setup mock job states to simulate continued running
      mockActivities.getJobStateActivity
        .mockResolvedValueOnce({
          status: JobRunStatus.Running,
          tasks_total: 10,
          tasks_completed: 5,
          workers: ['worker-1'],
          workers_agreed: [],
        })
        .mockResolvedValueOnce({
          status: JobRunStatus.Running,
          tasks_total: 10,
          tasks_completed: 5,
          workers: ['worker-1'],
          workers_agreed: [],
        });

      // Mock scan activity to return tasks exist
      mockActivities.scanActivity.mockResolvedValue({ 
        noTaskFound: false,
        isFatalErrored: false 
      });

      // The workflow should continue without completing
      const result = await DiscoveryJobWorkflow({ 
        traceId: mockTraceId, 
        options: mockOptions, 
        workerId: mockWorkerId 
      });

      expect(mockActivities.publishTaskActivity).toHaveBeenCalledWith(mockTraceId);
    });

    it('should handle fatal error in scan activity', async () => {
      // Setup mock job state
      mockActivities.getJobStateActivity.mockResolvedValueOnce({
        status: JobRunStatus.Running,
        failedWorkers: [],
        workers: ['worker-1'],
      });

      // Mock scan activity to return fatal error
      mockActivities.scanActivity.mockResolvedValue({ 
        noTaskFound: false,
        isFatalErrored: true 
      });

      const result = await DiscoveryJobWorkflow({ 
        traceId: mockTraceId, 
        options: mockOptions, 
        workerId: mockWorkerId 
      });

      expect(mockActivities.setJobStateActivity).toHaveBeenCalledWith(
        mockTraceId, 
        expect.objectContaining({ 
          failedWorkers: [mockWorkerId] 
        })
      );
    });

    it('should continue as new when iteration limit is reached', async () => {
      // Setup mock job state
      mockActivities.getJobStateActivity.mockResolvedValue({
        status: JobRunStatus.Running,
        tasks_total: 10,
        tasks_completed: 5,
        workers: ['worker-1'],
        workers_agreed: [],
      });

      // Mock scan activity to simulate ongoing tasks
      mockActivities.scanActivity.mockResolvedValue({ 
        noTaskFound: false,
        isFatalErrored: false 
      });

      // Mock continueAsNew to simulate 80+ iterations
      const mockContinueAsNew = continueAsNew as jest.Mock;
      mockContinueAsNew.mockResolvedValue(undefined);

      const result = await DiscoveryJobWorkflow({ 
        traceId: mockTraceId, 
        options: mockOptions, 
        workerId: mockWorkerId,
        iteration: 80  // Simulate 80 iterations
      });

      expect(continueAsNew).toHaveBeenCalledWith({ 
        traceId: mockTraceId, 
        options: mockOptions 
      });
    });

    it('should handle non-running job status', async () => {
      // Setup mock job state with non-running status
      mockActivities.getJobStateActivity.mockResolvedValue({
        status: JobRunStatus.Completed,
      });

      const result = await DiscoveryJobWorkflow({ 
        traceId: mockTraceId, 
        options: mockOptions, 
        workerId: mockWorkerId 
      });

      expect(result).toEqual({ message: `Job status changed to ${JobRunStatus.Completed}` });
    });

    it('should handle workflow error and update discovery status', async () => {
      // Simulate an error scenario
      mockActivities.getJobStateActivity.mockRejectedValue(new Error('Test error'));
      mockActivities.updateDiscoveryStatus.mockResolvedValue(undefined);
      mockActivities.updateLastEntry.mockResolvedValue(undefined);

      const result = await DiscoveryJobWorkflow({ 
        traceId: mockTraceId, 
        options: mockOptions, 
        workerId: mockWorkerId 
      });

      expect(result).toEqual({ message: 'Discovery failed' });
      expect(mockActivities.updateDiscoveryStatus).toHaveBeenCalledWith(mockTraceId, 'FAILED');
      expect(mockActivities.updateLastEntry).toHaveBeenCalledWith(mockTraceId);
    });

    it('should rethrow ContinueAsNew error', async () => {
      // Use the mocked ContinueAsNew constructor
      const continueAsNewError = new (ContinueAsNew as unknown as jest.Mock)('Continue as new');
      
      mockActivities.getJobStateActivity.mockRejectedValue(continueAsNewError);

      await expect(DiscoveryJobWorkflow({ 
        traceId: mockTraceId, 
        options: mockOptions, 
        workerId: mockWorkerId 
      })).rejects.toThrow('Continue as new');
    });
  });
});