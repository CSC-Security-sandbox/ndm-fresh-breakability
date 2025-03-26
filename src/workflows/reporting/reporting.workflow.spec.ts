import { Worker, DefaultLogger } from '@temporalio/worker';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { ReportingWorkflow, isReportedQuery } from './reporting.workflow';
import { JobReportType } from './reporting.types';
import { JobRunStatus } from 'src/activities/discovery/enums';

describe('ReportingWorkflow', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await testEnv.teardown();
  });

  it('should complete the workflow for CUT_OVER report type', async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'test',
      workflowsPath: require.resolve('./reporting.workflow'),
      activities: {
        getJobState: async () => ({
          failedWorkers: [],
          workers: [{}],
        }),
        updateStatus: jest.fn(),
        generateCOCReport: jest.fn(),
        generateJobsReport: jest.fn(),
      },
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(ReportingWorkflow, {
        args: ['trace-id', { type: 'signal', name: 'reportSignal' }],
        taskQueue: worker.options.taskQueue,
      });

      await handle.signal('reportSignal', JobReportType.CUT_OVER_REPORTED);

      const result = await handle.result();
      expect(result).toBe('REPORTING COMPLETED');
    });
  });

  it('should complete the workflow for DISCOVER report type', async () => {
    const { client, worker } = await testEnv.createWorker({
      workflowsPath: require.resolve('./reporting.workflow'),
      activities: {
        getJobState: async () => ({
          failedWorkers: [],
          workers: [{}],
        }),
        updateStatus: jest.fn(),
        generateDiscoveryReport: jest.fn(),
      },
    });

    await worker.runUntil(async () => {
      const handle = await client.workflow.start(ReportingWorkflow, {
        args: ['trace-id', { type: 'signal', name: 'reportSignal' }],
        taskQueue: worker.options.taskQueue,
      });

      await handle.signal('reportSignal', JobReportType.DISCOVER_REPORTED);

      const result = await handle.result();
      expect(result).toBe('REPORTING COMPLETED');
    });
  });

  it('should complete the workflow for MIGRATE report type', async () => {
    const { client, worker } = await testEnv.createWorker({
      workflowsPath: require.resolve('./reporting.workflow'),
      activities: {
        getJobState: async () => ({
          failedWorkers: [],
          workers: [{}],
        }),
        updateStatus: jest.fn(),
        generateCOCReport: jest.fn(),
      },
    });

    await worker.runUntil(async () => {
      const handle = await client.workflow.start(ReportingWorkflow, {
        args: ['trace-id', { type: 'signal', name: 'reportSignal' }],
        taskQueue: worker.options.taskQueue,
      });

      await handle.signal('reportSignal', JobReportType.MIGRATE);

      const result = await handle.result();
      expect(result).toBe('REPORTING COMPLETED');
    });
  });

  it('should throw an error for unknown report type', async () => {
    const { client, worker } = await testEnv.createWorker({
      workflowsPath: require.resolve('./reporting.workflow'),
      activities: {
        getJobState: async () => ({
          failedWorkers: [],
          workers: [{}],
        }),
        updateStatus: jest.fn(),
      },
    });

    await worker.runUntil(async () => {
      const handle = await client.workflow.start(ReportingWorkflow, {
        args: ['trace-id', { type: 'signal', name: 'reportSignal' }],
        taskQueue: worker.options.taskQueue,
      });

      await expect(handle.signal('reportSignal', 'UNKNOWN_TYPE')).rejects.toThrow(
        'Unknown REPORT TYPE'
      );
    });
  });

  it('should handle workflow cancellation', async () => {
    const { client, worker } = await testEnv.createWorker({
      workflowsPath: require.resolve('./reporting.workflow'),
      activities: {
        getJobState: async () => ({
          failedWorkers: [],
          workers: [{}],
        }),
        updateStatus: jest.fn(),
      },
    });

    await worker.runUntil(async () => {
      const handle = await client.workflow.start(ReportingWorkflow, {
        args: ['trace-id', { type: 'signal', name: 'reportSignal' }],
        taskQueue: worker.options.taskQueue,
      });

      await handle.cancel();

      await expect(handle.result()).rejects.toThrow('Workflow cancelled');
    });
  });
});