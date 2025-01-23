import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WorkflowService } from './workflow.service';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { Client, Connection, WorkflowHandleWithFirstExecutionRunId } from '@temporalio/client';
import { WorkFlows } from 'src/constants/enums';
import { StartWorkFlowPayload } from './workflow.types';

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

      expect(Connection.connect).toHaveBeenCalledWith({ address: 'localhost:7233' });
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
      expect(loggerService.error).toHaveBeenCalledWith(`Failed to connect to Temporal: ${error}`);
    });
  });


});
