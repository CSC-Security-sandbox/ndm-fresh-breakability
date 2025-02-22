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
import { Not, IsNull } from 'typeorm';

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
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
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

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getConfiguration', () => {
    const workerId = 'worker-1';
    const ip = '127.0.0.1';
    const projectId = 'project-1';

    it('should return existing worker configuration if found', async () => {
      const existingWorker = {
        workerId,
        metaConfig: [
          {
            configName: WorkFlowType.PARENT_WORKFLOW,
            dynamicTaskQueue: false,
            taskQueueId: null,
            workerId,
          },
        ],
      };

      const jobRunConfigs = [{
        metaConfig: [{
          configName: WorkFlowType.JOB_SPECIFIC_WORKFLOW,
          dynamicTaskQueue: true,
          taskQueueId: 'job-1',
          workerId,
        }],
      }];

      (workerEntityMock.findOne as jest.Mock).mockResolvedValue(existingWorker);
      (jobRunEntityMock.find as jest.Mock).mockResolvedValue(jobRunConfigs);

      const result = await service.getConfiguration(workerId, ip, projectId);

      expect(result).toEqual([
        ...existingWorker.metaConfig,
        ...jobRunConfigs[0].metaConfig,
      ]);
      expect(workerEntityMock.findOne).toHaveBeenCalledWith({
        where: { workerId },
      });
      expect(jobRunEntityMock.find).toHaveBeenCalledWith({
        where: {
          status: Not(JobRunStatus.Completed),
          workerMap: {
            workerId,
          },
          metaConfig: Not(IsNull()),
        },
        relations: {
          workerMap: true,
        },
        select: {
          workerMap: false,
          metaConfig: true,
        },
      });
    });

    it('should create and return new worker configuration if not found', async () => {
      (workerEntityMock.findOne as jest.Mock).mockResolvedValue(null);
      
      const newWorker = {
        workerId,
        ipAddress: ip,
        metaConfig: [
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
        ],
        status: WorkerStatus.Online,
        workerName: workerId,
        createdBy: workerId,
        projectId,
        workerNumber: 1,
      };

      (workerEntityMock.create as jest.Mock).mockReturnValue(newWorker);
      (workerEntityMock.save as jest.Mock).mockResolvedValue(newWorker);

      const result = await service.getConfiguration(workerId, ip, projectId);

      expect(result).toEqual(newWorker.metaConfig);
      expect(workerEntityMock.create).toHaveBeenCalledWith({
        workerId,
        ipAddress: ip,
        metaConfig: expect.any(Array),
        status: WorkerStatus.Online,
        workerName: workerId,
        createdBy: workerId,
        projectId,
      });
      expect(workerEntityMock.save).toHaveBeenCalled();
      expect(workerEntityMock.update).toHaveBeenCalledWith(
        { workerId },
        { workerName: `Worker-${newWorker.workerNumber}` },
      );
    });

    it('should handle errors gracefully', async () => {
      (workerEntityMock.findOne as jest.Mock).mockRejectedValue(new Error('Database error'));

      await expect(service.getConfiguration(workerId, ip, projectId))
        .rejects
        .toThrow('Error while fetching worker configuration');
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
