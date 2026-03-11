import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WorkflowService } from './workflow.service';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import {
  Client,
  Connection,
  QueryDefinition,
  SignalDefinition,
  UpdateDefinition,
  WorkflowClient,
  WorkflowExecutionDescription,
  WorkflowHandleWithFirstExecutionRunId,
  WorkflowUpdateHandle,
  WorkflowUpdateOptions,
} from '@temporalio/client';
import { WorkFlows } from 'src/constants/enums';
import {
  SignalWorkFlowPayload,
  StartWorkFlowPayload,
  WorkflowExecutionStatus,
} from './workflow.types';
import { temporal } from '@temporalio/proto';

jest.mock('@temporalio/client');

describe('WorkflowService', () => {
  let service: WorkflowService;
  let configService: jest.Mocked<ConfigService>;
  let loggerFactory: jest.Mocked<LoggerFactory>;
  let loggerService: jest.Mocked<LoggerService>;
  let mockClient: jest.Mocked<Client>;
  let mockConnection: jest.Mocked<Connection>;

  beforeEach(async () => {
    configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    loggerService = {
      log: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<LoggerService>;

    loggerFactory = {
      create: jest.fn().mockReturnValue(loggerService),
    } as unknown as jest.Mocked<LoggerFactory>;

    mockConnection = {
      close: jest.fn(),
    } as unknown as jest.Mocked<Connection>;

    mockClient = {
      workflow: {
        start: jest.fn(),
        getHandle: jest.fn(),
      },
    } as unknown as jest.Mocked<Client>;

    (Connection.connect as jest.Mock).mockResolvedValue(mockConnection);
    (Client as jest.Mock).mockImplementation(() => mockClient);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowService,
        { provide: ConfigService, useValue: configService },
        { provide: LoggerFactory, useValue: loggerFactory },
      ],
    }).compile();

    service = module.get<WorkflowService>(WorkflowService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getClient', () => {
    it('should create and return a new client if not already created', async () => {
      configService.get.mockReturnValue({ address: 'localhost:7233' });

      const client = await service['getClient']();

      expect(Connection.connect).toHaveBeenCalledWith({
        address: 'localhost:7233',
      });
      expect(client).toBe(mockClient);
    });

    it('should reuse the existing client if already created', async () => {
      configService.get.mockReturnValue({ address: 'localhost:7233' });

      const firstClient = await service['getClient']();
      const secondClient = await service['getClient']();

      expect(Connection.connect).toHaveBeenCalledTimes(1);
      expect(firstClient).toBe(secondClient);
    });

    it('should log an error and throw if connection fails', async () => {
      const error = new Error('Connection failed');
      (Connection.connect as jest.Mock).mockRejectedValue(error);

      await expect(service['getClient']()).rejects.toThrow(error);
      expect(loggerService.error).toHaveBeenCalledWith(
        `Failed to connect to Temporal: ${error}`,
      );
    });
  });

  describe('getWorkFlowRes', () => {
    it('should return completed workflow details if the workflow status is COMPLETED', async () => {
      const workflowId = 'test-workflow-id';
      const mockResult = { key: 'value' };
      const mockHandle = {
        describe: jest.fn().mockResolvedValue({
          status: { name: 'COMPLETED' },
          workflowId,
          raw: {},
        }),
        result: jest.fn().mockResolvedValue(mockResult),
      };

      mockClient.workflow.getHandle = jest.fn().mockReturnValue(mockHandle);

      const result = await service.getWorkFlowRes(workflowId);

      expect(mockClient.workflow.getHandle).toHaveBeenCalledWith(workflowId);
      expect(mockHandle.describe).toHaveBeenCalled();
      expect(mockHandle.result).toHaveBeenCalled();
      expect(result).toEqual({
        status: 'COMPLETED',
        id: workflowId,
        pending: [],
        completed: mockResult,
      });
    });

    it('should return pending workflow details if the workflow status is not COMPLETED', async () => {
      const workflowId = 'test-workflow-id';
      const mockPending = [{ childWorkflowId: 'child1' }];
      const mockHandle = {
        describe: jest.fn().mockResolvedValue({
          status: { name: 'RUNNING' },
          workflowId,
          raw: { pendingChildren: mockPending },
        }),
        result: jest.fn(),
      };

      mockClient.workflow.getHandle = jest.fn().mockReturnValue(mockHandle);

      const result = await service.getWorkFlowRes(workflowId);

      expect(mockClient.workflow.getHandle).toHaveBeenCalledWith(workflowId);
      expect(mockHandle.describe).toHaveBeenCalled();
      expect(mockHandle.result).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'RUNNING',
        id: workflowId,
        pending: mockPending,
        completed: [],
      });
    });

    it('should handle errors gracefully and log them', async () => {
      const workflowId = 'test-workflow-id';
      const error = new Error('Failed to get workflow details');

      const mockHandle = {
        describe: jest.fn().mockRejectedValue(error),
        result: jest.fn(),
      };

      mockClient.workflow.getHandle = jest.fn().mockReturnValue(mockHandle);

      await expect(service.getWorkFlowRes(workflowId)).rejects.toThrow(error);

      expect(mockClient.workflow.getHandle).toHaveBeenCalledWith(workflowId);
      expect(mockHandle.describe).toHaveBeenCalled();
    });
  });

  describe('sendSignal', () => {
    it('should call signalWorkflowExecution with correct parameters', async () => {
      const mockClient = {
        workflowService: {
          signalWorkflowExecution: jest
            .fn()
            .mockResolvedValue('Signal sent successfully'),
        },
      };

      const mockPayload: SignalWorkFlowPayload = {
        workflowId: 'test-workflow-id',
        signalName: 'test-signal',
        payload: { key: 'value' },
      };

      jest
        .spyOn<any, any>(service, 'getClient')
        .mockResolvedValue(mockClient as any);

      const result = await service.sendSignal(mockPayload);

      expect((service as any).getClient).toHaveBeenCalled();
      expect(result).toBe('Signal sent successfully');
    });

    it('should throw an error if signalWorkflowExecution fails', async () => {
      const mockClient = {
        workflowService: {
          signalWorkflowExecution: jest
            .fn()
            .mockRejectedValue(new Error('Signal failed')),
        },
      };

      const mockPayload: SignalWorkFlowPayload = {
        workflowId: 'test-workflow-id',
        signalName: 'test-signal',
        payload: { key: 'value' },
      };

      jest
        .spyOn<any, any>(service, 'getClient')
        .mockResolvedValue(mockClient as any);

      await expect(service.sendSignal(mockPayload)).rejects.toThrow(
        'Signal failed',
      );
      expect(jest.spyOn(service as any, 'getClient')).toHaveBeenCalled();
    });
  });
  describe('terminateWorkflow', () => {
    it('should terminate the workflow if it is still running', async () => {
      const workflowId = 'test-workflow-id';
      const mockHandle = {
        describe: jest.fn().mockResolvedValue({
          status: { name: 'RUNNING' },
        }),
        terminate: jest.fn(),
      };

      mockClient.workflow.getHandle = jest.fn().mockReturnValue(mockHandle);

      const result = await service.terminateWorkflow(workflowId);

      expect(mockClient.workflow.getHandle).toHaveBeenCalledWith(workflowId);
      expect(mockHandle.describe).toHaveBeenCalled();
      expect(mockHandle.terminate).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should not terminate the workflow if it is not running', async () => {
      const workflowId = 'test-workflow-id';
      const mockHandle = {
        describe: jest.fn().mockResolvedValue({
          status: { name: 'COMPLETED' },
        }),
        terminate: jest.fn(),
      };

      mockClient.workflow.getHandle = jest.fn().mockReturnValue(mockHandle);

      const result = await service.terminateWorkflow(workflowId);

      expect(mockClient.workflow.getHandle).toHaveBeenCalledWith(workflowId);
      expect(mockHandle.describe).toHaveBeenCalled();
      expect(mockHandle.terminate).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });

  describe('getWorkflowStatus', () => {
    it('should return the status of the workflow', async () => {
      const workflowId = 'test-workflow-id';
      const mockStatus = WorkflowExecutionStatus.RUNNING;
      const mockHandle = {
        describe: jest.fn().mockResolvedValue({
          status: { name: mockStatus },
        }),
      };

      mockClient.workflow.getHandle = jest.fn().mockReturnValue(mockHandle);

      const result = await service.getWorkflowStatus(workflowId);

      expect(mockClient.workflow.getHandle).toHaveBeenCalledWith(workflowId);
      expect(mockHandle.describe).toHaveBeenCalled();
      expect(result).toBe(mockStatus);
    });

    it('should handle errors gracefully and log them', async () => {
      const workflowId = 'test-workflow-id';
      const error = new Error('Failed to get workflow status');

      const mockHandle = {
        describe: jest.fn().mockRejectedValue(error),
      };

      mockClient.workflow.getHandle = jest.fn().mockReturnValue(mockHandle);

      await expect(service.getWorkflowStatus(workflowId)).rejects.toThrow(
        error,
      );

      expect(mockClient.workflow.getHandle).toHaveBeenCalledWith(workflowId);
      expect(mockHandle.describe).toHaveBeenCalled();
    });
  });
  describe('startWorkflow', () => {
    it('should start the workflow and return the handle', async () => {
      const workflowName = WorkFlows.DISCOVERY;
      const payload: StartWorkFlowPayload = {
        key: 'value',
        workflowId: '',
        taskQueue: '',
        args: [],
      };
      const mockHandle: WorkflowHandleWithFirstExecutionRunId = {
        workflowId: 'test-workflow-id',
        firstExecutionRunId: 'test-run-id',
        executeUpdate: function <
          Ret,
          Args extends [any, ...any[]],
          Name extends string = string,
        >(
          def: string | UpdateDefinition<Ret, Args, Name>,
          options: WorkflowUpdateOptions & { args: Args },
        ): Promise<Ret> {
          throw new Error('Function not implemented.');
        },
        startUpdate: function <
          Ret,
          Args extends [any, ...any[]],
          Name extends string = string,
        >(
          def: string | UpdateDefinition<Ret, Args, Name>,
          options: WorkflowUpdateOptions & {
            args: Args;
            waitForStage: 'ACCEPTED';
          },
        ): Promise<WorkflowUpdateHandle<Ret>> {
          throw new Error('Function not implemented.');
        },
        getUpdateHandle: function <Ret>(
          updateId: string,
        ): WorkflowUpdateHandle<Ret> {
          throw new Error('Function not implemented.');
        },
        query: function <Ret, Args extends any[] = []>(
          def: string | QueryDefinition<Ret, Args, string>,
          ...args: Args
        ): Promise<Ret> {
          throw new Error('Function not implemented.');
        },
        terminate: function (
          reason?: string,
        ): Promise<temporal.api.workflowservice.v1.ITerminateWorkflowExecutionResponse> {
          throw new Error('Function not implemented.');
        },
        cancel:
          function (): Promise<temporal.api.workflowservice.v1.IRequestCancelWorkflowExecutionResponse> {
            throw new Error('Function not implemented.');
          },
        describe: function (): Promise<WorkflowExecutionDescription> {
          throw new Error('Function not implemented.');
        },
        fetchHistory: function (): Promise<temporal.api.history.v1.IHistory> {
          throw new Error('Function not implemented.');
        },
        client: new WorkflowClient(),
        result: function (): Promise<any> {
          throw new Error('Function not implemented.');
        },
        signal: function <
          Args extends any[] = [],
          Name extends string = string,
        >(
          def: string | SignalDefinition<Args, Name>,
          ...args: Args
        ): Promise<void> {
          throw new Error('Function not implemented.');
        },
      };

      const mockClient = {
        workflow: {
          start: jest.fn().mockResolvedValue(mockHandle),
        },
      };

      jest
        .spyOn<any, any>(service, 'getClient')
        .mockResolvedValue(mockClient as any);

      const result = await service.startWorkflow(workflowName, payload);

      expect((service as any).getClient).toHaveBeenCalled();
      expect(mockClient.workflow.start).toHaveBeenCalledWith(
        workflowName,
        payload,
      );
      expect(result).toBe(mockHandle);
    });

    it('should log an error if failed to start the workflow', async () => {
      const workflowName = WorkFlows.DISCOVERY;
      const payload: StartWorkFlowPayload = {
        key: 'value',
        workflowId: '',
        taskQueue: '',
        args: [],
      };
      const error = new Error('Failed to start the workflow');

      const mockClient = {
        workflow: {
          start: jest.fn().mockRejectedValue(error),
        },
      };

      jest
        .spyOn<any, any>(service, 'getClient')
        .mockResolvedValue(mockClient as any);

      await service.startWorkflow(workflowName, payload);

      expect((service as any).getClient).toHaveBeenCalled();
      expect(mockClient.workflow.start).toHaveBeenCalledWith(
        workflowName,
        payload,
      );
      expect(loggerService.error).toHaveBeenCalledWith(
        `Failed to start workflow: ${error}`,
      );
    });
  });
});
