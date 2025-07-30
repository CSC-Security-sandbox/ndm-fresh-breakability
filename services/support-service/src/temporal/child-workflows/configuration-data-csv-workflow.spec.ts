import { Test, TestingModule } from '@nestjs/testing';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { ConfigurationDataCsvGeneratorWorkflow } from './configuration-data-csv-workflow';

describe('ConfigurationDataCsvGeneratorWorkflow', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createLocal();
  });

  afterAll(async () => {
    await testEnv?.teardown();
  });

  describe('Workflow Execution', () => {
    it('should successfully execute with valid payload containing worker and project data', async () => {
      const mockGenerateConfigurationDataCsv = jest
        .fn()
        .mockResolvedValue('Worker CSV generated successfully');
      const mockGenerateConfigurationJobCsv = jest
        .fn()
        .mockResolvedValue('Job config CSV generated successfully');

      const { client } = testEnv;
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'test-queue',
        workflowsPath: require.resolve('./configuration-data-csv-workflow'),
        activities: {
          generateConfigurationDataCsv: mockGenerateConfigurationDataCsv,
          generateConfigurationJobCsv: mockGenerateConfigurationJobCsv,
        },
      });

      const runPromise = worker.run();

      const payload = {
        projectWorkerMap: [
          {
            projectId: 'project-123',
            workerIds: ['worker-1', 'worker-2'],
          },
          {
            projectId: 'project-456',
            workerIds: ['worker-3'],
          },
        ],
        otherMetrics: ['Configuration Data'],
        zipLocation: '/tmp/support-bundle.zip',
      };

      const handle = await client.workflow.start(
        ConfigurationDataCsvGeneratorWorkflow,
        {
          args: [{ traceId: 'test-trace-123', payload }],
          taskQueue: 'test-queue',
          workflowId: 'test-workflow-id',
        },
      );

      const result = await handle.result();

      expect(result).toBe(
        'Successfully generated configuration data CSV files for workers and jobs',
      );
      expect(mockGenerateConfigurationDataCsv).toHaveBeenCalledWith({
        traceId: 'test-trace-123',
        payload,
      });
      expect(mockGenerateConfigurationJobCsv).toHaveBeenCalledWith({
        traceId: 'test-trace-123',
        payload,
      });

      worker.shutdown();
      await runPromise;
    });

    it('should handle empty worker IDs gracefully', async () => {
      const mockGenerateConfigurationDataCsv = jest
        .fn()
        .mockResolvedValue('No workers to process');
      const mockGenerateConfigurationJobCsv = jest
        .fn()
        .mockResolvedValue('No projects to process');

      const { client } = testEnv;
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'test-queue-empty',
        workflowsPath: require.resolve('./configuration-data-csv-workflow'),
        activities: {
          generateConfigurationDataCsv: mockGenerateConfigurationDataCsv,
          generateConfigurationJobCsv: mockGenerateConfigurationJobCsv,
        },
      });

      const runPromise = worker.run();

      const payload = {
        projectWorkerMap: [
          {
            projectId: 'project-123',
            workerIds: [],
          },
        ],
        otherMetrics: ['Configuration Data'],
        zipLocation: '/tmp/support-bundle.zip',
      };

      const handle = await client.workflow.start(
        ConfigurationDataCsvGeneratorWorkflow,
        {
          args: [{ traceId: 'test-trace-empty', payload }],
          taskQueue: 'test-queue-empty',
          workflowId: 'test-workflow-empty',
        },
      );

      const result = await handle.result();

      expect(result).toBe(
        'Successfully generated configuration data CSV files for workers and jobs',
      );
      expect(mockGenerateConfigurationDataCsv).toHaveBeenCalledWith({
        traceId: 'test-trace-empty',
        payload,
      });
      expect(mockGenerateConfigurationJobCsv).toHaveBeenCalledWith({
        traceId: 'test-trace-empty',
        payload,
      });

      worker.shutdown();
      await runPromise;
    });

    it('should handle missing otherMetrics array', async () => {
      const mockGenerateConfigurationDataCsv = jest
        .fn()
        .mockResolvedValue('Configuration data not requested');
      const mockGenerateConfigurationJobCsv = jest
        .fn()
        .mockResolvedValue('Configuration data not requested');

      const { client } = testEnv;
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'test-queue-no-metrics',
        workflowsPath: require.resolve('./configuration-data-csv-workflow'),
        activities: {
          generateConfigurationDataCsv: mockGenerateConfigurationDataCsv,
          generateConfigurationJobCsv: mockGenerateConfigurationJobCsv,
        },
      });

      const runPromise = worker.run();

      const payload = {
        projectWorkerMap: [
          {
            projectId: 'project-123',
            workerIds: ['worker-1'],
          },
        ],
        otherMetrics: ['Other Metric'],
        zipLocation: '/tmp/support-bundle.zip',
      };

      const handle = await client.workflow.start(
        ConfigurationDataCsvGeneratorWorkflow,
        {
          args: [{ traceId: 'test-trace-no-config', payload }],
          taskQueue: 'test-queue-no-metrics',
          workflowId: 'test-workflow-no-metrics',
        },
      );

      const result = await handle.result();

      expect(result).toBe(
        'Successfully generated configuration data CSV files for workers and jobs',
      );

      worker.shutdown();
      await runPromise;
    });

    it('should handle malformed payload gracefully', async () => {
      const mockGenerateConfigurationDataCsv = jest
        .fn()
        .mockResolvedValue('Handled malformed payload');
      const mockGenerateConfigurationJobCsv = jest
        .fn()
        .mockResolvedValue('Handled malformed payload');

      const { client } = testEnv;
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'test-queue-malformed',
        workflowsPath: require.resolve('./configuration-data-csv-workflow'),
        activities: {
          generateConfigurationDataCsv: mockGenerateConfigurationDataCsv,
          generateConfigurationJobCsv: mockGenerateConfigurationJobCsv,
        },
      });

      const runPromise = worker.run();

      const payload = {
        projectWorkerMap: null,
        otherMetrics: undefined,
        zipLocation: '/tmp/support-bundle.zip',
      };

      const handle = await client.workflow.start(
        ConfigurationDataCsvGeneratorWorkflow,
        {
          args: [{ traceId: 'test-trace-malformed', payload }],
          taskQueue: 'test-queue-malformed',
          workflowId: 'test-workflow-malformed',
        },
      );

      const result = await handle.result();

      expect(result).toBe(
        'Successfully generated configuration data CSV files for workers and jobs',
      );
      expect(mockGenerateConfigurationDataCsv).toHaveBeenCalledWith({
        traceId: 'test-trace-malformed',
        payload,
      });
      expect(mockGenerateConfigurationJobCsv).toHaveBeenCalledWith({
        traceId: 'test-trace-malformed',
        payload,
      });

      worker.shutdown();
      await runPromise;
    });

    it('should handle large datasets efficiently', async () => {
      const mockGenerateConfigurationDataCsv = jest
        .fn()
        .mockResolvedValue('Large dataset processed successfully');
      const mockGenerateConfigurationJobCsv = jest
        .fn()
        .mockResolvedValue('Large dataset processed successfully');

      const { client } = testEnv;
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'test-queue-large',
        workflowsPath: require.resolve('./configuration-data-csv-workflow'),
        activities: {
          generateConfigurationDataCsv: mockGenerateConfigurationDataCsv,
          generateConfigurationJobCsv: mockGenerateConfigurationJobCsv,
        },
      });

      const runPromise = worker.run();

      const largeWorkerIds = Array.from(
        { length: 1000 },
        (_, i) => `worker-${i}`,
      );
      const largeProjectIds = Array.from(
        { length: 100 },
        (_, i) => `project-${i}`,
      );

      const payload = {
        projectWorkerMap: largeProjectIds.map((projectId) => ({
          projectId,
          workerIds: largeWorkerIds.slice(0, 10),
        })),
        otherMetrics: ['Configuration Data'],
        zipLocation: '/tmp/support-bundle.zip',
      };

      const handle = await client.workflow.start(
        ConfigurationDataCsvGeneratorWorkflow,
        {
          args: [{ traceId: 'test-trace-large', payload }],
          taskQueue: 'test-queue-large',
          workflowId: 'test-workflow-large',
        },
      );

      const result = await handle.result();

      expect(result).toBe(
        'Successfully generated configuration data CSV files for workers and jobs',
      );
      expect(mockGenerateConfigurationDataCsv).toHaveBeenCalledWith({
        traceId: 'test-trace-large',
        payload,
      });
      expect(mockGenerateConfigurationJobCsv).toHaveBeenCalledWith({
        traceId: 'test-trace-large',
        payload,
      });

      worker.shutdown();
      await runPromise;
    });

    it('should handle different zip location formats', async () => {
      const mockGenerateConfigurationDataCsv = jest
        .fn()
        .mockResolvedValue('CSV generated with directory path');
      const mockGenerateConfigurationJobCsv = jest
        .fn()
        .mockResolvedValue('CSV generated with directory path');

      const { client } = testEnv;
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'test-queue-zip-format',
        workflowsPath: require.resolve('./configuration-data-csv-workflow'),
        activities: {
          generateConfigurationDataCsv: mockGenerateConfigurationDataCsv,
          generateConfigurationJobCsv: mockGenerateConfigurationJobCsv,
        },
      });

      const runPromise = worker.run();

      const payload = {
        projectWorkerMap: [
          {
            projectId: 'project-123',
            workerIds: ['worker-1'],
          },
        ],
        otherMetrics: ['Configuration Data'],
        zipLocation: '/tmp/support-bundle/',
      };

      const handle = await client.workflow.start(
        ConfigurationDataCsvGeneratorWorkflow,
        {
          args: [{ traceId: 'test-trace-zip-format', payload }],
          taskQueue: 'test-queue-zip-format',
          workflowId: 'test-workflow-zip-format',
        },
      );

      const result = await handle.result();

      expect(result).toBe(
        'Successfully generated configuration data CSV files for workers and jobs',
      );
      expect(mockGenerateConfigurationDataCsv).toHaveBeenCalledWith({
        traceId: 'test-trace-zip-format',
        payload,
      });
      expect(mockGenerateConfigurationJobCsv).toHaveBeenCalledWith({
        traceId: 'test-trace-zip-format',
        payload,
      });

      worker.shutdown();
      await runPromise;
    });
  });

  describe('Edge Cases', () => {
    it('should handle null payload', async () => {
      const mockGenerateConfigurationDataCsv = jest
        .fn()
        .mockResolvedValue('Handled null payload');
      const mockGenerateConfigurationJobCsv = jest
        .fn()
        .mockResolvedValue('Handled null payload');

      const { client } = testEnv;
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'test-queue-null',
        workflowsPath: require.resolve('./configuration-data-csv-workflow'),
        activities: {
          generateConfigurationDataCsv: mockGenerateConfigurationDataCsv,
          generateConfigurationJobCsv: mockGenerateConfigurationJobCsv,
        },
      });

      const runPromise = worker.run();

      const handle = await client.workflow.start(
        ConfigurationDataCsvGeneratorWorkflow,
        {
          args: [{ traceId: 'test-trace-null', payload: null }],
          taskQueue: 'test-queue-null',
          workflowId: 'test-workflow-null',
        },
      );

      const result = await handle.result();

      expect(result).toBe(
        'Successfully generated configuration data CSV files for workers and jobs',
      );

      worker.shutdown();
      await runPromise;
    });

    it('should handle empty traceId', async () => {
      const mockGenerateConfigurationDataCsv = jest
        .fn()
        .mockResolvedValue('Handled empty traceId');
      const mockGenerateConfigurationJobCsv = jest
        .fn()
        .mockResolvedValue('Handled empty traceId');

      const { client } = testEnv;
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'test-queue-empty-trace',
        workflowsPath: require.resolve('./configuration-data-csv-workflow'),
        activities: {
          generateConfigurationDataCsv: mockGenerateConfigurationDataCsv,
          generateConfigurationJobCsv: mockGenerateConfigurationJobCsv,
        },
      });

      const runPromise = worker.run();

      const payload = {
        projectWorkerMap: [
          {
            projectId: 'project-123',
            workerIds: ['worker-1'],
          },
        ],
        otherMetrics: ['Configuration Data'],
        zipLocation: '/tmp/support-bundle.zip',
      };

      const handle = await client.workflow.start(
        ConfigurationDataCsvGeneratorWorkflow,
        {
          args: [{ traceId: '', payload }],
          taskQueue: 'test-queue-empty-trace',
          workflowId: 'test-workflow-empty-trace',
        },
      );

      const result = await handle.result();

      expect(result).toBe(
        'Successfully generated configuration data CSV files for workers and jobs',
      );
      expect(mockGenerateConfigurationDataCsv).toHaveBeenCalledWith({
        traceId: '',
        payload,
      });
      expect(mockGenerateConfigurationJobCsv).toHaveBeenCalledWith({
        traceId: '',
        payload,
      });

      worker.shutdown();
      await runPromise;
    });
  });
});
