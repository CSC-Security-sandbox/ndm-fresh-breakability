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
} from 'src/constants/enums';
import { WorkerConfiguration } from 'src/constants/types';

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
      );
      expect(result).toEqual([{ key: 'value1' }, { key: 'value2' }]);
      // Verify that debug logging is called for each workerMap entry
      expect(logger.debug).toHaveBeenCalledTimes(2);
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
      );
      expect(result).toEqual(savedWorker.metaConfig);
      expect(sendMailService.sendMail).toHaveBeenCalledWith({
        successEmailType: 'worker_usage',
        workerUsage: {
          id: 'test-worker',
          ip: '127.0.0.1',
        },
      });
      // Ensure update worker name is called after saving
      expect(workerRepo.update).toHaveBeenCalledWith(
        { workerId: savedWorker.workerId },
        { workerName: `nfs-worker-${savedWorker.workerNumber}` },
      );
    });

    it('should throw an error if something fails', async () => {
      (workerRepo.findOne as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );
      await expect(
        service.getConfiguration(workerId, ip, projectId, Platform.LINUX),
      ).rejects.toThrow('Error while fetching worker configuration');
      expect(logger.error).toHaveBeenCalled();
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
    it('should update config repo with provided data', async () => {
      const data = {
        configId: 'config-1',
        status: 'SUCCESS',
        errorMessage: null,
      };
      (configRepo.update as jest.Mock).mockResolvedValue({});

      await service.validateWorkingDirectory(data as any);
      expect(configRepo.update).toHaveBeenCalledWith(
        { id: data.configId },
        { status: data.status, errorMessage: data.errorMessage },
      );
    });

    it('should log an error when config repo update fails', async () => {
      const data = {
        configId: 'config-1',
        status: 'FAIL',
        errorMessage: 'error',
      };
      const error = new Error('update failure');
      (configRepo.update as jest.Mock).mockRejectedValue(error);

      await service.validateWorkingDirectory(data as any);
      expect(logger.error).toHaveBeenCalledWith(
        `Error while updating the status of a file server after validating export path and working directory- ${error.message}`,
      );
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
