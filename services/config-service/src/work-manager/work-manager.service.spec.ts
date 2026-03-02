import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkManagerService } from './work-manager.service';
import { WorkerEntity } from 'src/entities/worker.entity';
import { JobRunEntity, JobRunStatus } from 'src/entities/jobrun.entity';
import { ConfigEntity } from 'src/entities/config.entity';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import { WorkflowService } from 'src/workflow/workflow.service';
import { ConfigService } from '@nestjs/config';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { SendMailService } from 'src/util/send-email';
import {
  WorkerStatus,
  WorkFlowType,
  WorkFlows,
  Platform,
  ConfigStatus,
} from 'src/constants/enums';
import { WorkerConfiguration } from 'src/constants/types';
import { readFileSync } from 'fs';
import { request } from 'https';

jest.mock('fs');
jest.mock('https');

describe('WorkManagerService', () => {
  let service: WorkManagerService;
  let workerRepo: Repository<WorkerEntity>;
  let jobRunRepo: Repository<JobRunEntity>;
  let configRepo: Repository<ConfigEntity>;
  let workerJobRunMapRepo: Repository<WorkerJobRunMap>;
  let workflowService: WorkflowService;
  let configService: ConfigService;
  let sendMailService: SendMailService;
  let loggerFactory: LoggerFactory;
  let logger: LoggerService;

  // helper worker configuration that is created by createWorkerConfiguration
  const defaultWorkerConfig: WorkerConfiguration[] = [
    {
      configName: WorkFlowType.PARENT_WORKFLOW,
      dynamicTaskQueue: false,
      taskQueueId: null,
      workerId: 'test-worker',
    },
    {
      configName: WorkFlowType.WORKER_SPECIFIC_WORKFLOW,
      dynamicTaskQueue: true,
      taskQueueId: 'test-worker',
      workerId: 'test-worker',
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkManagerService,
        {
          provide: getRepositoryToken(WorkerEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(JobRunEntity),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ConfigEntity),
          useValue: {
            update: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(WorkerJobRunMap),
          useValue: {
            update: jest.fn(),
          },
        },
        {
          provide: WorkflowService,
          useValue: {
            startWorkflow: jest.fn(),
            getWorkFlowRes: jest.fn(),
            getWorkFlowPayload: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-feature'),
          },
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue({
              debug: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
              log: jest.fn(),
            }),
          },
        },
        {
          provide: SendMailService,
          useValue: {
            sendMail: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WorkManagerService>(WorkManagerService);
    workerRepo = module.get<Repository<WorkerEntity>>(
      getRepositoryToken(WorkerEntity),
    );
    jobRunRepo = module.get<Repository<JobRunEntity>>(
      getRepositoryToken(JobRunEntity),
    );
    configRepo = module.get<Repository<ConfigEntity>>(
      getRepositoryToken(ConfigEntity),
    );
    workerJobRunMapRepo = module.get<Repository<WorkerJobRunMap>>(
      getRepositoryToken(WorkerJobRunMap),
    );
    workflowService = module.get<WorkflowService>(WorkflowService);
    configService = module.get<ConfigService>(ConfigService);
    sendMailService = module.get<SendMailService>(SendMailService);
    loggerFactory = module.get<LoggerFactory>(LoggerFactory);
    // Capture the logger mock for expectations on logging
    logger = service.logger;
    
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  describe('getConfiguration', () => {
    const workerId = 'test-worker';
    const ip = '127.0.0.1';
    const projectId = 'project-123';

    it('should return metaConfig when worker exists and has job run configurations', async () => {
      const workerFromDb = {
        workerId,
        metaConfig: [],
      };
      // Simulate a jobRun configuration with valid workerMap array
      const jobRunConfig = [
        {
          id: 'job1',
          workerMap: [
            { workerId, metaConfig: { key: 'value1' } },
            { workerId, metaConfig: { key: 'value2' } },
          ],
        },
      ];

      (workerRepo.findOne as jest.Mock).mockResolvedValue(workerFromDb);
      (jobRunRepo.find as jest.Mock).mockResolvedValue(jobRunConfig);

      const result = await service.getConfiguration(
        workerId,
        ip,
        projectId,
        Platform.WINDOWS,
        { TEST_VAR: 'test_value' },
        false,
        '',
      );
      expect(result.metaConfig).toEqual([{ key: 'value1' }, { key: 'value2' }]);
      expect(result.envVariables).toEqual({ TEST_VAR: 'test_value' });
      // Verify that debug logging is called for each workerMap entry
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('JobRunId: job1'),
      );
    });

    it('should create a new worker when not found, send email and update worker name', async () => {
      (workerRepo.findOne as jest.Mock).mockResolvedValue(null);

      // Setup mocks for worker creation and saving:
      const newWorker = {
        workerId,
        ipAddress: ip,
        metaConfig: defaultWorkerConfig,
        status: WorkerStatus.Online,
        workerName: workerId,
        createdBy: workerId,
        projectId,
      };

      const savedWorker = {
        ...newWorker,
        workerNumber: 42,
      };

      (workerRepo.create as jest.Mock).mockReturnValue(newWorker);
      (workerRepo.save as jest.Mock).mockResolvedValue(savedWorker);
      (workerRepo.update as jest.Mock).mockResolvedValue({});

      const result = await service.getConfiguration(
        workerId,
        ip,
        projectId,
        Platform.LINUX,
        {},
        true,
        '1.0.0',
      );
      expect(result.metaConfig).toEqual(savedWorker.metaConfig);
      expect(result.envVariables).toEqual({});
      expect(sendMailService.sendMail).toHaveBeenCalledWith({
        projectId: 'project-123',
        successEmailType: 'worker_usage',
        workerUsage: {
          id: 'test-worker',
          ip: '127.0.0.1',
        },
      });
      // Ensure update worker name is called after saving
      expect(workerRepo.update).toHaveBeenCalledWith(
        { workerId: savedWorker.workerId },
        {
          workerName: `nfs-worker-${savedWorker.workerNumber}`,
          envVariables: {},
        },
      );
    });

    it('should throw an error if something fails', async () => {
      (workerRepo.findOne as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );
      await expect(
        service.getConfiguration(
          workerId,
          ip,
          projectId,
          Platform.LINUX,
          {},
          false,
          '',
        ),
      ).rejects.toThrow('Error while fetching worker configuration');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should inject TLS CA certificate when TEMPORAL_TLS_ENABLED is true and certificate is not present', async () => {
      const workerFromDb = {
        workerId,
        metaConfig: [],
      };
      const mockCert = 'base64-encoded-cert';
      const mockToken = 'k8s-token';
      const mockCA = 'ca-cert';

      (readFileSync as jest.Mock)
        .mockReturnValueOnce(mockToken)
        .mockReturnValueOnce(mockCA);
      
      const mockRequest = jest.fn().mockImplementation((options, callback) => {
        const mockResponse = {
          statusCode: 200,
          on: jest.fn((event, handler) => {
            if (event === 'data') {
              handler(JSON.stringify({ data: { 'tls.crt': mockCert } }));
            }
            if (event === 'end') {
              handler();
            }
          }),
        };
        callback(mockResponse);
        return {
          on: jest.fn(),
          end: jest.fn(),
        };
      });
      (request as unknown as jest.Mock).mockImplementation(mockRequest);

      (workerRepo.findOne as jest.Mock).mockResolvedValue(workerFromDb);
      (jobRunRepo.find as jest.Mock).mockResolvedValue([]);

      const envVariables = { TEMPORAL_TLS_ENABLED: 'true' };
      const result = await service.getConfiguration(
        workerId,
        ip,
        projectId,
        Platform.LINUX,
        envVariables,
        false,
        '',
      );

      expect(result.envVariables.TEMPORAL_TLS_CA_CERT).toBe(mockCert);
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('TLS enabled, fetching Gateway CA certificate'),
      );
    });

    it('should not fetch certificate when TEMPORAL_TLS_CA_CERT is already present', async () => {
      const workerFromDb = {
        workerId,
        metaConfig: [],
      };
      const existingCert = 'existing-cert';

      (readFileSync as jest.Mock).mockClear();
      (workerRepo.findOne as jest.Mock).mockResolvedValue(workerFromDb);
      (jobRunRepo.find as jest.Mock).mockResolvedValue([]);

      const envVariables = {
        TEMPORAL_TLS_ENABLED: 'true',
        TEMPORAL_TLS_CA_CERT: existingCert,
      };
      const result = await service.getConfiguration(
        workerId,
        ip,
        projectId,
        Platform.LINUX,
        envVariables,
        false,
        '',
      );

      expect(result.envVariables.TEMPORAL_TLS_CA_CERT).toBe(existingCert);
      // readFileSync should not be called because certificate is already present
      expect(readFileSync).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('CA certificate already present'),
      );
    });

    it('should handle TLS certificate fetch failure gracefully when API returns non-200', async () => {
      const workerFromDb = {
        workerId,
        metaConfig: [],
      };
      const mockToken = 'k8s-token';
      const mockCA = 'ca-cert';

      (readFileSync as jest.Mock)
        .mockReturnValueOnce(mockToken)
        .mockReturnValueOnce(mockCA);
      
      const mockRequest = jest.fn().mockImplementation((options, callback) => {
        const mockResponse = {
          statusCode: 404,
          on: jest.fn((event, handler) => {
            if (event === 'data') {
              handler('Not found');
            }
            if (event === 'end') {
              handler();
            }
          }),
        };
        callback(mockResponse);
        return {
          on: jest.fn(),
          end: jest.fn(),
        };
      });
      (request as unknown as jest.Mock).mockImplementation(mockRequest);

      (workerRepo.findOne as jest.Mock).mockResolvedValue(workerFromDb);
      (jobRunRepo.find as jest.Mock).mockResolvedValue([]);

      const envVariables = { TEMPORAL_TLS_ENABLED: 'true' };
      const result = await service.getConfiguration(
        workerId,
        ip,
        projectId,
        Platform.LINUX,
        envVariables,
        false,
        '',
      );

      expect(result.envVariables.TEMPORAL_TLS_CA_CERT).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch Gateway CA certificate'),
      );
    });

    it('should handle TLS certificate fetch failure when secret does not contain tls.crt', async () => {
      const workerFromDb = {
        workerId,
        metaConfig: [],
      };
      const mockToken = 'k8s-token';
      const mockCA = 'ca-cert';

      (readFileSync as jest.Mock)
        .mockReturnValueOnce(mockToken)
        .mockReturnValueOnce(mockCA);
      
      const mockRequest = jest.fn().mockImplementation((options, callback) => {
        const mockResponse = {
          statusCode: 200,
          on: jest.fn((event, handler) => {
            if (event === 'data') {
              handler(JSON.stringify({ data: {} }));
            }
            if (event === 'end') {
              handler();
            }
          }),
        };
        callback(mockResponse);
        return {
          on: jest.fn(),
          end: jest.fn(),
        };
      });
      (request as unknown as jest.Mock).mockImplementation(mockRequest);

      (workerRepo.findOne as jest.Mock).mockResolvedValue(workerFromDb);
      (jobRunRepo.find as jest.Mock).mockResolvedValue([]);

      const envVariables = { TEMPORAL_TLS_ENABLED: 'true' };
      const result = await service.getConfiguration(
        workerId,
        ip,
        projectId,
        Platform.LINUX,
        envVariables,
        false,
        '',
      );

      expect(result.envVariables.TEMPORAL_TLS_CA_CERT).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch Gateway CA certificate'),
      );
    });

    it('should handle TLS certificate fetch failure when JSON parsing fails', async () => {
      const workerFromDb = {
        workerId,
        metaConfig: [],
      };
      const mockToken = 'k8s-token';
      const mockCA = 'ca-cert';

      (readFileSync as jest.Mock)
        .mockReturnValueOnce(mockToken)
        .mockReturnValueOnce(mockCA);
      
      const mockRequest = jest.fn().mockImplementation((options, callback) => {
        const mockResponse = {
          statusCode: 200,
          on: jest.fn((event, handler) => {
            if (event === 'data') {
              handler('invalid json');
            }
            if (event === 'end') {
              handler();
            }
          }),
        };
        callback(mockResponse);
        return {
          on: jest.fn(),
          end: jest.fn(),
        };
      });
      (request as unknown as jest.Mock).mockImplementation(mockRequest);

      (workerRepo.findOne as jest.Mock).mockResolvedValue(workerFromDb);
      (jobRunRepo.find as jest.Mock).mockResolvedValue([]);

      const envVariables = { TEMPORAL_TLS_ENABLED: 'true' };
      const result = await service.getConfiguration(
        workerId,
        ip,
        projectId,
        Platform.LINUX,
        envVariables,
        false,
        '',
      );

      expect(result.envVariables.TEMPORAL_TLS_CA_CERT).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch Gateway CA certificate'),
      );
    });

    it('should handle TLS certificate fetch failure when request errors', async () => {
      const workerFromDb = {
        workerId,
        metaConfig: [],
      };
      const mockToken = 'k8s-token';
      const mockCA = 'ca-cert';

      (readFileSync as jest.Mock)
        .mockReturnValueOnce(mockToken)
        .mockReturnValueOnce(mockCA);
      
      let errorHandler: (error: Error) => void;
      const mockRequest = jest.fn().mockImplementation((options, callback) => {
        const mockReq = {
          on: jest.fn((event, handler) => {
            if (event === 'error') {
              errorHandler = handler;
            }
          }),
          end: jest.fn(() => {
            // Trigger error after end is called to simulate network error
            if (errorHandler) {
              setImmediate(() => errorHandler(new Error('Network error')));
            }
          }),
        };
        return mockReq;
      });
      (request as unknown as jest.Mock).mockImplementation(mockRequest);

      (workerRepo.findOne as jest.Mock).mockResolvedValue(workerFromDb);
      (jobRunRepo.find as jest.Mock).mockResolvedValue([]);

      const envVariables = { TEMPORAL_TLS_ENABLED: 'true' };
      const result = await service.getConfiguration(
        workerId,
        ip,
        projectId,
        Platform.LINUX,
        envVariables,
        false,
        '',
      );

      // Wait for async error to be handled
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(result.envVariables.TEMPORAL_TLS_CA_CERT).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch Gateway CA certificate'),
      );
    });

    it('should handle TLS certificate fetch failure when file read fails', async () => {
      const workerFromDb = {
        workerId,
        metaConfig: [],
      };

      (readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('File not found');
      });

      (workerRepo.findOne as jest.Mock).mockResolvedValue(workerFromDb);
      (jobRunRepo.find as jest.Mock).mockResolvedValue([]);

      const envVariables = { TEMPORAL_TLS_ENABLED: 'true' };
      const result = await service.getConfiguration(
        workerId,
        ip,
        projectId,
        Platform.LINUX,
        envVariables,
        false,
        '',
      );

      expect(result.envVariables.TEMPORAL_TLS_CA_CERT).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch Gateway CA certificate'),
      );
    });

    it('should skip TLS certificate injection when TEMPORAL_TLS_ENABLED is false', async () => {
      const workerFromDb = {
        workerId,
        metaConfig: [],
      };

      (workerRepo.findOne as jest.Mock).mockResolvedValue(workerFromDb);
      (jobRunRepo.find as jest.Mock).mockResolvedValue([]);

      const envVariables = { TEMPORAL_TLS_ENABLED: 'false' };
      const result = await service.getConfiguration(
        workerId,
        ip,
        projectId,
        Platform.LINUX,
        envVariables,
        false,
        '',
      );

      expect(result.envVariables.TEMPORAL_TLS_CA_CERT).toBeUndefined();
      expect(readFileSync).not.toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('TLS not enabled, skipping certificate injection'),
      );
    });

    it('should update worker when isRebootCall is true', async () => {
      const workerFromDb = {
        workerId,
        metaConfig: [],
      };

      (workerRepo.findOne as jest.Mock).mockResolvedValue(workerFromDb);
      (jobRunRepo.find as jest.Mock).mockResolvedValue([]);
      (workerRepo.update as jest.Mock).mockResolvedValue({});

      const envVariables = { TEST_VAR: 'test_value' };
      await service.getConfiguration(
        workerId,
        ip,
        projectId,
        Platform.WINDOWS,
        envVariables,
        true,
        '2.0.0',
      );

      expect(workerRepo.update).toHaveBeenCalledWith(
        { workerId },
        {
          workerName: expect.any(String),
          platform: Platform.WINDOWS,
          envVariables,
          workerVersion: '2.0.0',
        },
      );
    });

    it('should handle workerMap that is not an array', async () => {
      const workerFromDb = {
        workerId,
        metaConfig: [],
      };
      const jobRunConfig = [
        {
          id: 'job1',
          workerMap: null,
        },
      ];

      (workerRepo.findOne as jest.Mock).mockResolvedValue(workerFromDb);
      (jobRunRepo.find as jest.Mock).mockResolvedValue(jobRunConfig);

      const result = await service.getConfiguration(
        workerId,
        ip,
        projectId,
        Platform.LINUX,
        {},
        false,
        '',
      );

      expect(result.metaConfig).toEqual([]);
    });

    it('should skip workerMap entries without metaConfig', async () => {
      const workerFromDb = {
        workerId,
        metaConfig: [],
      };
      const jobRunConfig = [
        {
          id: 'job1',
          workerMap: [
            { workerId, metaConfig: { key: 'value1' } },
            { workerId, metaConfig: null },
            { workerId },
          ],
        },
      ];

      (workerRepo.findOne as jest.Mock).mockResolvedValue(workerFromDb);
      (jobRunRepo.find as jest.Mock).mockResolvedValue(jobRunConfig);

      const result = await service.getConfiguration(
        workerId,
        ip,
        projectId,
        Platform.LINUX,
        {},
        false,
        '',
      );

      expect(result.metaConfig).toEqual([{ key: 'value1' }]);
      // Verify debug was called for the entry with metaConfig
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('JobRunId: job1'),
      );
    });
  });

  describe('createWorkerConfiguration', () => {
    it('should return default worker configuration array for given workerId', () => {
      const result = service.createWorkerConfiguration('test-worker');
      expect(result).toEqual(defaultWorkerConfig);
    });
  });

  describe('validateConnection', () => {
    const payload = {
      options: { someOption: true },
      someField: 'test',
    };
    const traceId = 'trace-123';

    it('should return workflow id on success', async () => {
      const workflowResponse = { workflowId: 'wf-123' };
      (workflowService.startWorkflow as jest.Mock).mockResolvedValue(
        workflowResponse,
      );

      const result = await service.validateConnection(payload as any, traceId);

      expect(result).toEqual({ workflowId: workflowResponse.workflowId });
      expect(workflowService.startWorkflow).toHaveBeenCalled();

      // validate that startWorkflow was called with the correct workflow type and payload
      const expectedPayload = {
        workflowId: WorkFlows.VALIDATE_CONNECTION + '-' + traceId,
        taskQueue: 'ParentWorkflow-TaskQueue',
        args: [
          {
            traceId: traceId,
            payload: {
              traceId,
              feature: 'test-feature',
              ...payload,
            },
            options: payload.options,
          },
        ],
        ...payload.options,
      };

      expect(workflowService.startWorkflow).toHaveBeenCalledWith(
        WorkFlows.VALIDATE_CONNECTION,
        expectedPayload,
      );
    });

    it('should throw InternalServerErrorException on workflow failure', async () => {
      const errorMessage = 'workflow startup error';
      (workflowService.startWorkflow as jest.Mock).mockRejectedValue(
        new Error(errorMessage),
      );

      await expect(
        service.validateConnection(payload as any, traceId),
      ).rejects.toThrow(InternalServerErrorException);
      expect(logger.error).toHaveBeenCalledWith(
        `Error in validateConnection: ${errorMessage}`,
      );
    });
  });

  describe('validateWorkingDirectory', () => {
    it('should update config status directly for non-Dell NAS (no fileServerId)', async () => {
      const data = {
        configId: 'config-1',
        status: 'ACTIVE',
        errorMessage: null,
      };
      const mockConfig = {
        id: 'config-1',
        serverType: 'OtherNAS',
        status: 'IN_PROGRESS',
        errorMessage: null,
        fileServers: [{ id: 'fs-1', status: 'IN_PROGRESS' }],
      };
      (configRepo.findOne as jest.Mock).mockResolvedValue(mockConfig);
      (configRepo.save as jest.Mock).mockResolvedValue(mockConfig);

      await service.validateWorkingDirectory(data as any);

      expect(configRepo.findOne).toHaveBeenCalledWith({
        where: { id: data.configId },
        relations: ['fileServers'],
      });
      // For Other NAS, status is updated directly on config and all file servers
      expect(mockConfig.status).toBe(data.status);
      expect(mockConfig.errorMessage).toBe(data.errorMessage);
      expect(mockConfig.fileServers[0].status).toBe(data.status);
      expect(configRepo.save).toHaveBeenCalledWith(mockConfig);
    });

    it('should update file server status for Dell per-zone callback (with fileServerId)', async () => {
      const data = {
        configId: 'config-1',
        fileServerId: 'fs-1',
        status: 'ACTIVE',
        errorMessage: null,
      };
      const mockConfig = {
        id: 'config-1',
        status: 'IN_PROGRESS',
        errorMessage: null,
        fileServers: [
          { id: 'fs-1', status: 'IN_PROGRESS' },
          { id: 'fs-2', status: 'ACTIVE' },
        ],
      };
      (configRepo.findOne as jest.Mock).mockResolvedValue(mockConfig);
      (configRepo.save as jest.Mock).mockResolvedValue(mockConfig);

      await service.validateWorkingDirectory(data as any);

      expect(configRepo.findOne).toHaveBeenCalledWith({
        where: { id: data.configId },
        relations: ['fileServers'],
      });
      // File server status should be updated
      expect(mockConfig.fileServers[0].status).toBe('ACTIVE');
      // save should be called twice - once for file server update, once for aggregation
      expect(configRepo.save).toHaveBeenCalled();
    });

    it('should aggregate Dell config status to ACTIVE when all file servers are ACTIVE', async () => {
      const data = {
        configId: 'config-1',
        fileServerId: 'fs-1',
        status: 'ACTIVE',
        errorMessage: null,
      };
      const mockConfig = {
        id: 'config-1',
        status: 'IN_PROGRESS',
        errorMessage: null,
        fileServers: [
          { id: 'fs-1', status: 'IN_PROGRESS' },
          { id: 'fs-2', status: 'ACTIVE' },
        ],
      };
      (configRepo.findOne as jest.Mock).mockResolvedValue(mockConfig);
      (configRepo.save as jest.Mock).mockResolvedValue(mockConfig);

      await service.validateWorkingDirectory(data as any);

      // After updating fs-1 to ACTIVE, all file servers are ACTIVE
      // So aggregated status should be ACTIVE
      expect(mockConfig.status).toBe('ACTIVE');
      expect(mockConfig.errorMessage).toBeNull();
    });

    it('should aggregate Dell config status to ERRORED when any file server is ERRORED', async () => {
      const data = {
        configId: 'config-1',
        fileServerId: 'fs-1',
        status: 'ERRORED',
        errorMessage: 'Zone validation failed',
      };
      const mockConfig = {
        id: 'config-1',
        status: 'IN_PROGRESS',
        errorMessage: null,
        fileServers: [
          { id: 'fs-1', status: 'IN_PROGRESS' },
          { id: 'fs-2', status: 'ACTIVE' },
        ],
      };
      (configRepo.findOne as jest.Mock).mockResolvedValue(mockConfig);
      (configRepo.save as jest.Mock).mockResolvedValue(mockConfig);

      await service.validateWorkingDirectory(data as any);

      // After updating fs-1 to ERRORED, aggregated status should be ERRORED
      expect(mockConfig.status).toBe('ERRORED');
      // Service uses the actual error message from the errored file server
      expect(mockConfig.errorMessage).toBe('Zone validation failed');
    });

    it('should keep Dell config status as IN_PROGRESS when not all file servers are complete', async () => {
      const data = {
        configId: 'config-1',
        fileServerId: 'fs-1',
        status: 'ACTIVE',
        errorMessage: null,
      };
      const mockConfig = {
        id: 'config-1',
        status: 'IN_PROGRESS',
        errorMessage: null,
        fileServers: [
          { id: 'fs-1', status: 'IN_PROGRESS' },
          { id: 'fs-2', status: 'IN_PROGRESS' },
        ],
      };
      (configRepo.findOne as jest.Mock).mockResolvedValue(mockConfig);
      (configRepo.save as jest.Mock).mockResolvedValue(mockConfig);

      await service.validateWorkingDirectory(data as any);

      // fs-1 is now ACTIVE, but fs-2 is still IN_PROGRESS
      // So aggregated status should remain IN_PROGRESS
      expect(mockConfig.status).toBe('IN_PROGRESS');
      expect(mockConfig.errorMessage).toBeNull();
    });

    it('should handle Dell callback when file server is not found in config', async () => {
      const data = {
        configId: 'config-1',
        fileServerId: 'fs-unknown',
        status: 'ACTIVE',
        errorMessage: null,
      };
      const mockConfig = {
        id: 'config-1',
        status: 'IN_PROGRESS',
        errorMessage: null,
        fileServers: [{ id: 'fs-1', status: 'IN_PROGRESS' }],
      };
      (configRepo.findOne as jest.Mock).mockResolvedValue(mockConfig);
      (configRepo.save as jest.Mock).mockResolvedValue(mockConfig);

      await service.validateWorkingDirectory(data as any);

      // File server not found, so its status should not change
      expect(mockConfig.fileServers[0].status).toBe('IN_PROGRESS');
    });

    it('should log an error when config repo operation fails', async () => {
      const data = {
        configId: 'config-1',
        status: 'FAIL',
        errorMessage: 'error',
      };
      const error = new Error('database failure');
      (configRepo.findOne as jest.Mock).mockRejectedValue(error);

      await service.validateWorkingDirectory(data as any);
      expect(logger.error).toHaveBeenCalledWith(
        `Error while updating the status of a file server after validating export path and working directory- ${error.message}`,
      );
    });

    it('should aggregate Dell config status to DRAFT when any file server is DRAFT', async () => {
      const data = {
        configId: 'config-1',
        fileServerId: 'fs-1',
        status: 'DRAFT',
        errorMessage: null,
      };
      const mockConfig = {
        id: 'config-1',
        status: 'IN_PROGRESS',
        errorMessage: null,
        fileServers: [
          { id: 'fs-1', status: 'IN_PROGRESS' },
          { id: 'fs-2', status: 'DRAFT' },
        ],
      };
      (configRepo.findOne as jest.Mock).mockResolvedValue(mockConfig);
      (configRepo.save as jest.Mock).mockResolvedValue(mockConfig);

      await service.validateWorkingDirectory(data as any);

      expect(mockConfig.status).toBe(ConfigStatus.DRAFT);
      expect(mockConfig.errorMessage).toBe('One or more zones have no workers assigned');
    });

    it('should handle Dell callback when config is not found', async () => {
      const data = {
        configId: 'config-1',
        fileServerId: 'fs-1',
        status: 'ACTIVE',
        errorMessage: null,
      };
      (configRepo.findOne as jest.Mock).mockResolvedValue(null);

      await service.validateWorkingDirectory(data as any);

      expect(configRepo.save).not.toHaveBeenCalled();
    });

    it('should handle non-Dell callback when config is not found', async () => {
      const data = {
        configId: 'config-1',
        status: 'ACTIVE',
        errorMessage: null,
      };
      (configRepo.findOne as jest.Mock).mockResolvedValue(null);

      await service.validateWorkingDirectory(data as any);

      expect(configRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getChildWorkFlowRes', () => {
    it('should throw BadRequestException if id is not provided', async () => {
      await expect(service.getChildWorkFlowRes('')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if workflow response is null', async () => {
      (workflowService.getWorkFlowRes as jest.Mock).mockResolvedValue(null);
      await expect(service.getChildWorkFlowRes('child-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return the workflow response on success', async () => {
      const dummyResponse = { some: 'data' };
      (workflowService.getWorkFlowRes as jest.Mock).mockResolvedValue(
        dummyResponse,
      );
      const response = await service.getChildWorkFlowRes('child-id');
      expect(response).toEqual(dummyResponse);
    });

    it('should throw InternalServerErrorException on unexpected errors', async () => {
      const error = new Error('unexpected');
      (workflowService.getWorkFlowRes as jest.Mock).mockRejectedValue(error);
      await expect(service.getChildWorkFlowRes('child-id')).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(logger.error).toHaveBeenCalledWith(
        `Error in getChildWorkFlowRes: ${error.message}`,
      );
    });

    // terminated, failed, or timed out workflows
    it('should handle terminated, failed, or timed out workflows', async () => {
      const response = {
        status: 'TERMINATED',
        id: 'child-id',
        pending: [],
        completed: [],
      };
      const payload = [
        {
          payload: {
            preChecks: [
              {
                pathId: 'source-path',
                destinations: [{ pathId: 'dest1' }, { pathId: 'dest2' }],
              },
            ],
          },
        },
      ];
      (workflowService.getWorkFlowRes as jest.Mock).mockResolvedValue(response);
      jest.spyOn(workflowService, 'getWorkFlowPayload').mockResolvedValue(payload);

      const result = await service.getChildWorkFlowRes('child-id');
      expect(result).toEqual({
        ...response,
        workflow: {
          errors: [`Pre-check with ID child-id is terminated. Please check the workflow logs for more details.`],
          sourcePathId: 'source-path',
          destinationPathIds: ['dest1', 'dest2'],
        },
      });
    });

    it('should handle FAILED workflow status', async () => {
      const response = {
        status: 'FAILED',
        id: 'child-id',
        pending: [],
        completed: [],
      };
      const payload = [
        {
          payload: {
            preChecks: [
              {
                pathId: 'source-path',
                destinations: [{ pathId: 'dest1' }],
              },
            ],
          },
        },
      ];
      (workflowService.getWorkFlowRes as jest.Mock).mockResolvedValue(response);
      jest.spyOn(workflowService, 'getWorkFlowPayload').mockResolvedValue(payload);

      const result = await service.getChildWorkFlowRes('child-id');
      expect(result).toEqual({
        ...response,
        workflow: {
          errors: [`Pre-check with ID child-id is failed. Please check the workflow logs for more details.`],
          sourcePathId: 'source-path',
          destinationPathIds: ['dest1'],
        },
      });
    });

    it('should handle TIMED_OUT workflow status', async () => {
      const response = {
        status: 'TIMED_OUT',
        id: 'child-id',
        pending: [],
        completed: [],
      };
      const payload = [
        {
          payload: {
            preChecks: [
              {
                pathId: 'source-path',
                destinations: [],
              },
            ],
          },
        },
      ];
      (workflowService.getWorkFlowRes as jest.Mock).mockResolvedValue(response);
      jest.spyOn(workflowService, 'getWorkFlowPayload').mockResolvedValue(payload);

      const result = await service.getChildWorkFlowRes('child-id');
      expect(result).toEqual({
        ...response,
        workflow: {
          errors: [`Pre-check with ID child-id is timed_out. Please check the workflow logs for more details.`],
          sourcePathId: 'source-path',
          destinationPathIds: [],
        },
      });
    });

    it('should handle workflow payload with missing preChecks', async () => {
      const response = {
        status: 'TERMINATED',
        id: 'child-id',
        pending: [],
        completed: [],
      };
      const payload = [
        {
          payload: {},
        },
      ];
      (workflowService.getWorkFlowRes as jest.Mock).mockResolvedValue(response);
      jest.spyOn(workflowService, 'getWorkFlowPayload').mockResolvedValue(payload);

      const result = await service.getChildWorkFlowRes('child-id');
      expect(result).toEqual({
        ...response,
        workflow: {
          errors: [`Pre-check with ID child-id is terminated. Please check the workflow logs for more details.`],
          sourcePathId: null,
          destinationPathIds: null,
        },
      });
    });
  });

  describe('updateWorkerConfigurations', () => {
    const jobRunId = 'job-run-1';
    const workerId = 'worker-1';

    it('should update worker configurations when jobRunId is provided', async () => {
      (workerJobRunMapRepo.update as jest.Mock).mockResolvedValue({});
      await service.updateWorkerConfigurations(jobRunId, workerId);
      const expectedWorkerConfig = {
        configName: WorkFlowType.JOB_SPECIFIC_WORKFLOW,
        dynamicTaskQueue: true,
        taskQueueId: `${jobRunId}`,
        workerId: workerId,
      };
      expect(workerJobRunMapRepo.update).toHaveBeenCalledWith(
        { jobRunId: jobRunId, workerId: workerId },
        { metaConfig: expectedWorkerConfig },
      );
    });

    it('should throw an error when jobRunId is missing', async () => {
      await expect(
        service.updateWorkerConfigurations('', workerId),
      ).rejects.toThrow('JobRunId is required to update worker configurations');
      expect(logger.error).toHaveBeenCalledWith(
        'JobRunId is required to update worker configurations',
      );
    });

    it('should throw an error when update operation fails', async () => {
      (workerJobRunMapRepo.update as jest.Mock).mockRejectedValue(
        new Error('update error'),
      );
      await expect(
        service.updateWorkerConfigurations(jobRunId, workerId),
      ).rejects.toThrow('Error while updating worker configurations');
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
