import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { WorkManagerService } from './work-manager.service';
import { WorkerEntity } from 'src/entities/worker.entity';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkflowService } from 'src/workflow/workflow.service';
import { WorkerStatus, WorkFlows, WorkFlowType } from 'src/constants/enums';
import { CreateRequestDto } from './dto/validate-connection.dto';
import { ConfigService } from '@nestjs/config';
import { JobRunEntity, JobRunStatus } from 'src/entities/jobrun.entity';
import { getRepositoryToken } from '@nestjs/typeorm';

describe('WorkManagerService', () => {
  let service: WorkManagerService;
  let workerEntityMock: Partial<Repository<WorkerEntity>>;
  let jobRunEntityMock: Partial<Repository<JobRunEntity>>;
  let loggerFactoryMock: Partial<LoggerFactory>;
  let workflowServiceMock: Partial<WorkflowService>;
  let configServiceMock: Partial<ConfigService>;
  let loggerInstance: LoggerService;

  beforeEach(async () => {
    workerEntityMock = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    jobRunEntityMock = {
      update: jest.fn(),
    };

    loggerFactoryMock = {
      create: jest.fn().mockReturnValue({
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      }),
    };

    workflowServiceMock = {
      startWorkflow: jest.fn().mockResolvedValue({ workflowId: '123' }),
      getWorkFlowRes: jest.fn().mockResolvedValue({ result: 'success' }),
    };

    configServiceMock = {
      get: jest.fn().mockReturnValue({ feature: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkManagerService,
        { provide: getRepositoryToken(WorkerEntity), useValue: workerEntityMock },
        { provide: getRepositoryToken(JobRunEntity), useValue: jobRunEntityMock },
        { provide: LoggerFactory, useValue: loggerFactoryMock },
        { provide: WorkflowService, useValue: workflowServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get<WorkManagerService>(WorkManagerService);
    loggerInstance = loggerFactoryMock.create!(WorkManagerService.name);
  });

  describe('getConfiguration', () => {
    it('should return existing worker configuration if found', async () => {
      const mockWorkerMetaConfig = {
        metaConfig: [{ key: 'worker_config' }],
      };

      const mockJobRunConfig = [
        { jobrunmetaconfig: { key: 'job_run_config' } },
      ];

      (workerEntityMock.findOne as jest.Mock).mockResolvedValue(
        mockWorkerMetaConfig,
      );

      const mockQueryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockJobRunConfig),
      };

      jobRunEntityMock.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      (jobRunEntityMock.createQueryBuilder as jest.Mock).mockReturnValue(
        mockQueryBuilder,
      );

      const workerId = '123';
      const projectId = 'projectId';
      const result = await service.getConfiguration(workerId, '', projectId);

      expect(result).toEqual([
        { key: 'worker_config' },
        { key: 'job_run_config' },
      ]);
      expect(workerEntityMock.findOne).toHaveBeenCalledWith({
        where: { workerId: workerId },
      });
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'mapping.workerId = :id',
        { id: workerId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'jobrun.status <> :status',
        { status: JobRunStatus.Completed },
      );
    });

    it('should return existing worker configuration if found', async () => {
      const mockWorkerMetaConfig = {
        metaConfig: [{ key: 'worker_config' }],
      };

      const mockJobRunConfig = [];

      (workerEntityMock.findOne as jest.Mock).mockResolvedValue(
        mockWorkerMetaConfig,
      );

      const mockQueryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockJobRunConfig),
      };

      jobRunEntityMock.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      const workerId = '123';
      const projectId = 'projectId';
      const result = await service.getConfiguration(workerId, '', projectId);

      expect(result).toBeDefined();
      expect(result).toEqual([{ key: 'worker_config' }]);
      expect(workerEntityMock.findOne).toHaveBeenCalledWith({
        where: { workerId: workerId },
      });
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'mapping.workerId = :id',
        { id: workerId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'jobrun.status <> :status',
        { status: JobRunStatus.Completed },
      );
    });

    it('should create a new worker if not found and return its configuration', async () => {

      const queryBuilderStub = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue(null),
      };
      (workerEntityMock.createQueryBuilder as jest.Mock).mockReturnValue(queryBuilderStub);

      const workerId = '123';
      const ip = '127.0.0.1';
      const projectId = 'projectId';

      const newWorker = {
        workerId,
        ipAddress: ip,
        metaConfig: service.createWorkerConfiguration(workerId),
        status: WorkerStatus.Online,
        workerName: workerId,
        createdBy: workerId,
        projectId,
        workerNumber: 10
      };

      (workerEntityMock.create as jest.Mock).mockReturnValue(newWorker);
      (workerEntityMock.save as jest.Mock).mockResolvedValue(newWorker);
      (workerEntityMock.update as jest.Mock).mockResolvedValue({ affected: 1 });

      const result = await service.getConfiguration(workerId, ip, projectId);
      expect(result).toEqual(newWorker.metaConfig);
      expect(workerEntityMock.create).toHaveBeenCalledWith({
        workerId,
        ipAddress: ip,
        metaConfig: service.createWorkerConfiguration(workerId),
        status: WorkerStatus.Online,
        workerName: workerId,
        createdBy: workerId,
        projectId,
      });
      expect(workerEntityMock.save).toHaveBeenCalledWith(newWorker);
      expect(workerEntityMock.update).toHaveBeenCalledWith(
        { workerId: newWorker.workerId },
        { workerName: `Worker-${newWorker.workerNumber}` },
      );
    });

    it('should log an error and throw when an error occurs', async () => {
      (workerEntityMock.createQueryBuilder as jest.Mock).mockImplementation(() => {
        throw new Error('DB error');
      });

      const workerId = '123';
      const ip = '127.0.0.1';
      const projectId = 'projectId';

      await expect(service.getConfiguration(workerId, ip, projectId))
        .rejects.toThrow('Error while fetching worker configuration');
    });
  });

  describe('createWorkerConfiguration', () => {
    it('should return a default worker configuration', () => {
      const workerId = '123';
      const expectedConfig = [
        {
          configName: WorkFlowType.PARENT_WORKFLOW,
          dynamicTaskQueue: false,
          taskQueueId: null,
          workerId,
        },
        {
          configName: WorkFlowType.WORKER_SPECIFIC_WORKFLOW,
          dynamicTaskQueue: true,
          taskQueueId: workerId,
          workerId,
        },
      ];
      const result = service.createWorkerConfiguration(workerId);
      expect(result).toEqual(expectedConfig);
    });
  });

  describe('validateConnection', () => {
    it('should start the workflow with the correct payload and return workflowId', async () => {
      const payload: CreateRequestDto = {
        options: {
          startDelay: '10',
          workflowExecutionTimeout: '12',
          workflowRunTimeout: '12',
          workflowTaskTimeout: '12',
        },
        fileServer: { hostname: 'test', protocols: [] },
        workerIds: ['123'],
      };
      const traceId = 'trace123';

      const expectedWorkflowPayload = {
        workflowId: `${WorkFlows.VALIDATE_CONNECTION}-${traceId}`,
        taskQueue: 'ParentWorkflow-TaskQueue',
        args: [
          {
            traceId,
            payload: { traceId, feature: configServiceMock.get!('app.feature'), ...payload },
            options: payload.options,
          },
        ],
        ...payload.options,
      };

      const result = await service.validateConnection(payload, traceId);
      expect(workflowServiceMock.startWorkflow).toHaveBeenCalledWith(
        WorkFlows.VALIDATE_CONNECTION,
        expectedWorkflowPayload,
      );
      expect(result).toEqual({ workflowId: '123' });
    });
  });

  describe('getChildWorkFlowRes', () => {
    it('should return the workflow result from workflowService.getWorkFlowRes', async () => {
      const workflowResult = { result: 'success' };
      (workflowServiceMock.getWorkFlowRes as jest.Mock).mockResolvedValue(workflowResult);

      const id = 'childWorkflowId';
      const result = await service.getChildWorkFlowRes(id);
      expect(workflowServiceMock.getWorkFlowRes).toHaveBeenCalledWith(id);
      expect(result).toEqual(workflowResult);
    });
  });

  describe('updateWorkerConfigurations', () => {
    const jobRunId = 'job123';
    const workerIds = ['worker1', 'worker2'];
    const expectedWorkerConfiguration = workerIds.map((worker) => ({
      configName: WorkFlowType.JOB_SPECIFIC_WORKFLOW,
      dynamicTaskQueue: true,
      taskQueueId: `${jobRunId}`,
      workerId: worker,
    }));

    it('should update worker configurations when jobRunId is provided', async () => {
      (jobRunEntityMock.update as jest.Mock).mockResolvedValue({ affected: 2 });
      await service.updateWorkerConfigurations(jobRunId, workerIds);
      expect(jobRunEntityMock.update).toHaveBeenCalledWith(
        { id: jobRunId },
        { metaConfig: expectedWorkerConfiguration },
      );
    });

    it('should throw an error if jobRunId is missing', async () => {
      const missingJobRunId = '';
      await expect(service.updateWorkerConfigurations(missingJobRunId, workerIds))
        .rejects.toThrow('JobRunId is required to update worker configurations');
      expect(loggerInstance.error).toHaveBeenCalledWith(
        'JobRunId is required to update worker configurations'
      );
    });

    it('should log an error and throw when update fails', async () => {
      const errorObj = new Error('Update failed');
      errorObj.stack = 'error-stack';
      (jobRunEntityMock.update as jest.Mock).mockRejectedValue(errorObj);
      await expect(service.updateWorkerConfigurations(jobRunId, workerIds))
        .rejects.toThrow('Error while updating worker configurations');
      expect(loggerInstance.error).toHaveBeenCalledWith(
        `Error while updating worker configurations for jobRunId: ${jobRunId}`,
        'error-stack'
      );
    });
  });
});
