import {ConfigService} from '@nestjs/config';
import {Test, TestingModule} from '@nestjs/testing';
import {LoggerFactory, LoggerService} from '@netapp-cloud-datamigrate/logger-lib';
import {Client, Connection} from '@temporalio/client';
import {WorkflowService} from './workflow.service';

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
      debug: jest.fn(,
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
        getHandle: jest.fn()
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
        address: 'localhost:7233'
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
          `Failed to connect to Temporal: ${error}`
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
        result: jest.fn()
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

  it('should close client connection if client exists', () => {
    function setPrivateClient(value: any) {
      Object.defineProperty(service, 'client', {
        value,
        writable: true
      });
    }
    const mockClient = {
      connection: {
        close: jest.fn()
      },
    };
    setPrivateClient(mockClient);
    service.onModuleDestroy();
    expect(mockClient.connection.close).toHaveBeenCalled();
  });

  describe('startWorkflow', () => {
    it('should start a workflow and return the handle', async () => {
      const workflowName = 'TEST_WORKFLOW';
      const payload = {
        workflowId: 'test-workflow-id',
        taskQueue: 'test-queue',
        args: ['arg1', 'arg2']
      };
      const mockHandle = {
        workflowId: 'test-workflow-id',
        firstExecutionRunId: 'test-run-id'
      };

      mockClient.workflow.start = jest.fn().mockResolvedValue(mockHandle);

      const result = await service.startWorkflow(workflowName as any, payload);

      expect(mockClient.workflow.start).toHaveBeenCalledWith(
          workflowName,
          payload
      );
      expect(result).toBe(mockHandle);
      expect(loggerService.log).toHaveBeenCalled();
    });

    it('should log and throw an error if starting the workflow fails', async () => {
      const workflowName = 'TEST_WORKFLOW';
      const payload = {
        workflowId: 'test-workflow-id',
        taskQueue: 'test-queue',
        args: ['arg1', 'arg2']
      };
      const error = new Error('Failed to start workflow');

      mockClient.workflow.start = jest.fn().mockRejectedValue(error);

      await expect(
          service.startWorkflow(workflowName as any, payload)
      ).rejects.toThrow(error);
      expect(mockClient.workflow.start).toHaveBeenCalledWith(
          workflowName,
          payload
      );
      expect(loggerService.error).toHaveBeenCalledWith(
          `Failed to start workflow: ${error}`
      );
    });

    it('should throw a specific error message for project ID related errors', async () => {
      const workflowName = 'TEST_WORKFLOW';
      const payload = {
        workflowId: 'tet-workflow-id',
        taskQueue: 'test-queue',
        args: ['arg1', 'arg2']
      };
      const error = new Error('The specified project id was not found');

      mockClient.workflow.start = jest.fn().mockRejectedValue(error);

      await expect(
          service.startWorkflow(workflowName as any, payload)
      ).rejects.toThrow('Please provide a valid Project ID');
      expect(mockClient.workflow.start).toHaveBeenCalledWith(
          workflowName,
          payload
      );
      expect(loggerService.error).toHaveBeenCalledWith(
          `Failed to start workflow: ${error}`
      );
    });
  });

  describe('getWorkFlowPayload', () => {
    let mockWorkflowService: any;
    beforeEach(() => {
      mockWorkflowService = {
        getWorkflowExecutionHistory: jest.fn(),
      };

      (service as any).client = {
        workflowService: mockWorkflowService,
      };
      jest.spyOn<any, any>(service, 'getClient').mockResolvedValue((service as any).client);
    });

    it('should return parsed payloads when workflow has input payloads', async () => {
      const workflowId = 'wf-123';
      const payloadData = JSON.stringify({ foo: 'bar' });
      const payloadUint8 = new Uint8Array(Buffer.from(payloadData, 'utf8'));

      mockWorkflowService.getWorkflowExecutionHistory.mockResolvedValue({
        history: {
          events: [
            {
              workflowExecutionStartedEventAttributes: {
                input: { payloads: [{ data: payloadUint8 }] },
              },
            },
          ],
        },
      });

      const result = await service.getWorkFlowPayload(workflowId);

      expect(mockWorkflowService.getWorkflowExecutionHistory).toHaveBeenCalledWith({
        namespace: 'default',
        execution: { workflowId },
      });
      expect(result).toEqual([{ foo: 'bar' }]);
    });

    it('should return empty array and log warning if no payloads found', async () => {
      const workflowId = 'wf-no-payloads';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });

      mockWorkflowService.getWorkflowExecutionHistory.mockResolvedValue({
        history: {
          events: [
            {
              workflowExecutionStartedEventAttributes: {
                input: { payloads: [] },
              },
            },
          ],
        },
      });

      const result = await service.getWorkFlowPayload(workflowId);

      expect(warnSpy).toHaveBeenCalledWith(
        `No payloads found for workflow ${workflowId}`
      );
      expect(result).toEqual([]);

      warnSpy.mockRestore();
    });

    it('should return empty array and log warning if startedEvent has no input', async () => {
      const workflowId = 'wf-no-input';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });

      mockWorkflowService.getWorkflowExecutionHistory.mockResolvedValue({
        history: {
          events: [
            {
              workflowExecutionStartedEventAttributes: {},
            },
          ],
        },
      });

      const result = await service.getWorkFlowPayload(workflowId);

      expect(warnSpy).toHaveBeenCalledWith(
        `No payloads found for workflow ${workflowId}`
      );
      expect(result).toEqual([]);

      warnSpy.mockRestore();
    });

    it('should return empty array if no startedEvent found', async () => {
      const workflowId = 'wf-no-started-event';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });

      mockWorkflowService.getWorkflowExecutionHistory.mockResolvedValue({
        history: {
          events: [
            { someOtherEvent: {} },
          ],
        },
      });

      const result = await service.getWorkFlowPayload(workflowId);

      expect(warnSpy).toHaveBeenCalledWith(
        `No payloads found for workflow ${workflowId}`
      );
      expect(result).toEqual([]);

      warnSpy.mockRestore();
    });

    it('should throw error if getWorkflowExecutionHistory fails', async () => {
      const workflowId = 'wf-error';
      const error = new Error('Temporal service down');
      mockWorkflowService.getWorkflowExecutionHistory.mockRejectedValue(error);

      await expect(service.getWorkFlowPayload(workflowId)).rejects.toThrow(error);
    });
  });
});