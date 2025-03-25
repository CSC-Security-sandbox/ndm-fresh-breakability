import { WorkflowHandle } from '@temporalio/client';
import * as workflow from './reporting.workflow';
import { JobReportType, JobRunStatus } from '../../activities/discovery/enums';
import { mock, when, instance, verify, reset, anything, capture } from 'ts-mockito';

describe('ReportingWorkflow', () => {
  let testEnv: TestWorkflowEnvironment;
  let handle: WorkflowHandle;
  const traceId = 'test-trace-id';
  const signal = workflow.isReportedQuery;

  // Mock activities
  const mockDiscoveryActivity = mock<workflow.DiscoveryActivity>();
  const mockMigrationTaskService = mock<workflow.MigrationTaskService>();
  const mockCommonActivityService = mock<workflow.CommonActivityService>();

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createLocal();
  });

  afterAll(async () => {
    await testEnv.teardown();
  });

  beforeEach(async () => {
    // Reset all mocks before each test
    reset(mockDiscoveryActivity);
    reset(mockMigrationTaskService);
    reset(mockCommonActivityService);

    // Setup workflow dependencies
    jest.doMock('@temporalio/workflow', () => ({
      ...jest.requireActual('@temporalio/workflow'),
      proxyActivities: () => ({
        generateDiscoveryReport: instance(mockDiscoveryActivity).generateDiscoveryReport,
        generateCOCReport: instance(mockMigrationTaskService).generateCOCReport,
        updateStatus: instance(mockCommonActivityService).updateStatus,
        getJobState: instance(mockCommonActivityService).getJobState,
        generateJobsReport: instance(mockCommonActivityService).generateJobsReport,
      }),
    }));

    // Create workflow handle
    handle = await testEnv.workflow.start(workflow.ReportingWorkflow, {
      args: [traceId, signal],
      workflowId: 'test-workflow-id',
      taskQueue: 'test-task-queue',
    });
  });

  it('should wait for signal and complete for DISCOVER report type with success', async () => {
    // Mock activities
    when(mockCommonActivityService.getJobState(traceId))
      .thenResolve({ workers: ['worker1'], failedWorkers: [] });
    
    when(mockCommonActivityService.updateStatus(anything()))
      .thenResolve();
    
    when(mockDiscoveryActivity.generateDiscoveryReport(traceId))
      .thenResolve();

    // Send signal
    await handle.signal(signal, JobReportType.DISCOVER);

    // Check result
    const result = await handle.result();
    expect(result).toBe('REPORTING COMPLETED');

    // Verify activities were called correctly
    verify(mockCommonActivityService.getJobState(traceId)).once();
    verify(mockCommonActivityService.updateStatus({
      jobRunId: traceId,
      status: JobRunStatus.Completed
    })).once();
    verify(mockDiscoveryActivity.generateDiscoveryReport(traceId)).once();
  });

  it('should wait for signal and complete for DISCOVER report type with error', async () => {
    // Mock activities
    when(mockCommonActivityService.getJobState(traceId))
      .thenResolve({ workers: ['worker1', 'worker2'], failedWorkers: ['worker1', 'worker2'] });
    
    when(mockCommonActivityService.updateStatus(anything()))
      .thenResolve();
    
    when(mockDiscoveryActivity.generateDiscoveryReport(traceId))
      .thenResolve();

    // Send signal
    await handle.signal(signal, JobReportType.DISCOVER);

    // Check result
    const result = await handle.result();
    expect(result).toBe('REPORTING COMPLETED');

    // Verify activities were called correctly
    verify(mockCommonActivityService.updateStatus({
      jobRunId: traceId,
      status: JobRunStatus.Errored
    })).once();
  });

  it('should wait for signal and complete for MIGRATE report type with success', async () => {
    // Mock activities
    when(mockCommonActivityService.getJobState(traceId))
      .thenResolve({ workers: ['worker1'], failedWorkers: [] });
    
    when(mockCommonActivityService.updateStatus(anything()))
      .thenResolve();
    
    when(mockMigrationTaskService.generateCOCReport(traceId))
      .thenResolve();

    // Send signal
    await handle.signal(signal, JobReportType.MIGRATE);

    // Check result
    const result = await handle.result();
    expect(result).toBe('REPORTING COMPLETED');

    // Verify activities were called correctly
    verify(mockCommonActivityService.updateStatus({
      jobRunId: traceId,
      status: JobRunStatus.Completed
    })).once();
    verify(mockMigrationTaskService.generateCOCReport(traceId)).once();
  });

  it('should wait for signal and complete for MIGRATE report type with error', async () => {
    // Mock activities
    when(mockCommonActivityService.getJobState(traceId))
      .thenResolve({ workers: ['worker1', 'worker2'], failedWorkers: ['worker1', 'worker2'] });
    
    when(mockCommonActivityService.updateStatus(anything()))
      .thenResolve();
    
    when(mockMigrationTaskService.generateCOCReport(traceId))
      .thenResolve();

    // Send signal
    await handle.signal(signal, JobReportType.MIGRATE);

    // Check result
    const result = await handle.result();
    expect(result).toBe('REPORTING COMPLETED');

    // Verify activities were called correctly
    verify(mockCommonActivityService.updateStatus({
      jobRunId: traceId,
      status: JobRunStatus.Errored
    })).once();
  });

  it('should wait for signal and complete for CUT_OVER report type with success', async () => {
    // Mock activities
    when(mockCommonActivityService.getJobState(traceId))
      .thenResolve({ workers: ['worker1'], failedWorkers: [] });
    
    when(mockCommonActivityService.updateStatus(anything()))
      .thenResolve();
    
    when(mockMigrationTaskService.generateCOCReport(traceId))
      .thenResolve();
    
    when(mockCommonActivityService.generateJobsReport(traceId))
      .thenResolve();

    // Send signal
    await handle.signal(signal, JobReportType.CUT_OVER);

    // Check result
    const result = await handle.result();
    expect(result).toBe('REPORTING COMPLETED');

    // Verify activities were called correctly
    verify(mockCommonActivityService.updateStatus({
      jobRunId: traceId,
      status: JobRunStatus.BLOCKED
    })).once();
    verify(mockMigrationTaskService.generateCOCReport(traceId)).once();
    verify(mockCommonActivityService.generateJobsReport(traceId)).once();
  });

  it('should wait for signal and complete for CUT_OVER report type with error', async () => {
    // Mock activities
    when(mockCommonActivityService.getJobState(traceId))
      .thenResolve({ workers: ['worker1', 'worker2'], failedWorkers: ['worker1', 'worker2'] });
    
    when(mockCommonActivityService.updateStatus(anything()))
      .thenResolve();
    
    when(mockMigrationTaskService.generateCOCReport(traceId))
      .thenResolve();
    
    when(mockCommonActivityService.generateJobsReport(traceId))
      .thenResolve();

    // Send signal
    await handle.signal(signal, JobReportType.CUT_OVER);

    // Check result
    const result = await handle.result();
    expect(result).toBe('REPORTING COMPLETED');

    // Verify activities were called correctly
    verify(mockCommonActivityService.updateStatus({
      jobRunId: traceId,
      status: JobRunStatus.Errored
    })).once();
  });

  it('should throw error for unknown report type', async () => {
    // Mock activities
    when(mockCommonActivityService.getJobState(traceId))
      .thenResolve({ workers: ['worker1'], failedWorkers: [] });

    // Send invalid signal
    await expect(handle.signal(signal, 'UNKNOWN_TYPE')).rejects.toThrow();

    // Verify workflow failed
    await expect(handle.result()).rejects.toThrow('Unknown REPORT TYPE');
  });

  it('should handle workflow cancellation', async () => {
    // Mock activities
    when(mockCommonActivityService.getJobState(traceId))
      .thenResolve({ workers: ['worker1'], failedWorkers: [] });

    // Cancel workflow before sending signal
    await handle.cancel();

    // Verify workflow was cancelled
    await expect(handle.result()).rejects.toThrow('Workflow cancelled');
  });

  it('isReportedQuery should return correct state', async () => {
    // Initially should be false (blocked)
    let isReported = await handle.query(workflow.isReportedQuery);
    expect(isReported).toBe(false);

    // After signal should be true
    when(mockCommonActivityService.getJobState(traceId))
      .thenResolve({ workers: ['worker1'], failedWorkers: [] });
    when(mockCommonActivityService.updateStatus(anything()))
      .thenResolve();
    when(mockDiscoveryActivity.generateDiscoveryReport(traceId))
      .thenResolve();

    await handle.signal(signal, JobReportType.DISCOVER);
    
    isReported = await handle.query(workflow.isReportedQuery);
    expect(isReported).toBe(true);
  });
});