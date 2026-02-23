import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { Connection, Client } from '@temporalio/client';
import { WorkflowService } from './workflow.service';
import { WorkFlows, WorkflowExecutionStatus } from './workflow.types';
import { mockLoggerFactory, resetLoggerMocks } from '../test-utils/logger-mocks';

jest.mock('@temporalio/client', () => ({
  Connection: { connect: jest.fn() },
  Client: jest.fn(),
}));

describe('WorkflowService', () => {
  let service: WorkflowService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn().mockReturnValue({ address: 'localhost:7233' }),
  };

  const mockWorkflowHandle = {
    workflowId: 'test-workflow-id',
    firstExecutionRunId: 'test-run-id',
    describe: jest.fn(),
    result: jest.fn(),
    terminate: jest.fn(),
  };

  const mockClient = {
    workflow: {
      start: jest.fn().mockResolvedValue(mockWorkflowHandle),
      getHandle: jest.fn().mockReturnValue(mockWorkflowHandle),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    resetLoggerMocks();

    (Connection.connect as jest.Mock).mockResolvedValue({});
    (Client as unknown as jest.Mock).mockImplementation(() => mockClient);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LoggerFactory, useValue: mockLoggerFactory },
      ],
    }).compile();

    service = module.get<WorkflowService>(WorkflowService);
  });

  describe('startWorkflow', () => {
    it('should connect to Temporal and start a workflow', async () => {
      const payload = {
        taskQueue: 'ParentWorkflow-TaskQueue',
        workflowId: 'test-workflow-id',
        args: [{ traceId: '123', workerIds: ['w1'], version: '1.0.0' }],
      };

      const result = await service.startWorkflow(WorkFlows.BINARY_MULTICAST, payload);

      expect(Connection.connect).toHaveBeenCalledWith({ address: 'localhost:7233' });
      expect(mockClient.workflow.start).toHaveBeenCalledWith('BinaryMulticastWorkflow', payload);
      expect(result.workflowId).toBe('test-workflow-id');
    });

    it('should reuse existing client on subsequent calls', async () => {
      const payload = { taskQueue: 'TQ', workflowId: 'wf1', args: [] };

      await service.startWorkflow(WorkFlows.BINARY_MULTICAST, payload);
      await service.startWorkflow(WorkFlows.BINARY_MULTICAST, payload);

      expect(Connection.connect).toHaveBeenCalledTimes(1);
    });

    it('should throw when Temporal connection fails', async () => {
      (Connection.connect as jest.Mock).mockRejectedValue(new Error('Connection refused'));

      // Reset client so it tries to reconnect
      (service as any).client = null;

      await expect(
        service.startWorkflow(WorkFlows.BINARY_MULTICAST, { taskQueue: 'TQ', workflowId: 'wf1', args: [] }),
      ).rejects.toThrow('Connection refused');
    });

    it('should throw when workflow start fails', async () => {
      mockClient.workflow.start.mockRejectedValue(new Error('Workflow not registered'));

      await expect(
        service.startWorkflow(WorkFlows.BINARY_MULTICAST, { taskQueue: 'TQ', workflowId: 'wf1', args: [] }),
      ).rejects.toThrow('Workflow not registered');
    });
  });

  describe('getWorkflowStatus', () => {
    it('should return completed status with result', async () => {
      mockWorkflowHandle.describe.mockResolvedValue({
        status: { name: WorkflowExecutionStatus.COMPLETED },
        workflowId: 'wf1',
      });
      mockWorkflowHandle.result.mockResolvedValue({ status: 'completed', summary: { total: 1, success: 1, failed: 0 } });

      const result = await service.getWorkflowStatus('wf1');

      expect(result.status).toBe('COMPLETED');
      expect(result.completed).toEqual(expect.objectContaining({ status: 'completed' }));
      expect(result.pending).toEqual([]);
    });

    it('should return running status with pending children', async () => {
      mockWorkflowHandle.describe.mockResolvedValue({
        status: { name: WorkflowExecutionStatus.RUNNING },
        workflowId: 'wf1',
        raw: { pendingChildren: [{ workflowId: 'child-1' }] },
      });

      const result = await service.getWorkflowStatus('wf1');

      expect(result.status).toBe('RUNNING');
      expect(result.pending).toHaveLength(1);
      expect(result.completed).toEqual([]);
    });
  });

  describe('terminateWorkflow', () => {
    it('should terminate a running workflow', async () => {
      mockWorkflowHandle.describe.mockResolvedValue({
        status: { name: WorkflowExecutionStatus.RUNNING },
      });
      mockWorkflowHandle.terminate.mockResolvedValue(undefined);

      const result = await service.terminateWorkflow('wf1');

      expect(result).toBe(true);
      expect(mockWorkflowHandle.terminate).toHaveBeenCalled();
    });

    it('should return false for non-running workflow', async () => {
      mockWorkflowHandle.describe.mockResolvedValue({
        status: { name: WorkflowExecutionStatus.COMPLETED },
      });

      const result = await service.terminateWorkflow('wf1');

      expect(result).toBe(false);
      expect(mockWorkflowHandle.terminate).not.toHaveBeenCalled();
    });
  });
});
