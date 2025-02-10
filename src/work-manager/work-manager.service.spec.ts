import { Test, TestingModule } from '@nestjs/testing';
import { Repository, createQueryBuilder } from 'typeorm';
import { WorkManagerService } from './work-manager.service';
import { WorkerEntity } from 'src/entities/worker.entity';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkflowService } from 'src/workflow/workflow.service';
import { WorkerStatus, WorkFlows, WorkFlowType } from 'src/constants/enums';
import { CreateRequestDto } from './dto/validate-connection.dto';
import { ConfigService } from '@nestjs/config';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { create } from 'domain';

describe('WorkManagerService', () => {
  let service: WorkManagerService;
  let workerEntityMock: Repository<WorkerEntity>;
  let loggerFactoryMock;
  let workflowServiceMock: WorkflowService;
  let jobRunEntityMock: Repository<JobRunEntity>;

  beforeEach(async () => {
    workerEntityMock = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as unknown as Repository<WorkerEntity>;

    loggerFactoryMock = {
      create: jest.fn().mockReturnValue({
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      }),
    } ;

    workflowServiceMock = {
      startWorkflow: jest.fn().mockResolvedValue({workflowId: '123'}),
    } as unknown as WorkflowService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkManagerService,
        { provide: 'WorkerEntityRepository', useValue: workerEntityMock },
        { provide: ConfigService, useValue: {get : jest.fn().mockImplementation(()=> {feature: true})} },
        { provide: LoggerFactory, useValue: loggerFactoryMock },
        { provide: WorkflowService, useValue: workflowServiceMock },
        {provide: 'JobRunEntityRepository', useValue: jobRunEntityMock},
        {
          provide: getRepositoryToken(WorkerEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WorkManagerService>(WorkManagerService);
    workerEntityMock = module.get<Repository<WorkerEntity>>(getRepositoryToken(WorkerEntity));
  });

  describe('getConfiguration', () => {
    // it('should return existing worker configuration', async () => {
    //   const mockQueryBuilder = {
    //     leftJoin: jest.fn().mockReturnThis(),
    //     where: jest.fn().mockReturnThis(),
    //     select: jest.fn().mockReturnThis(),
    //     getRawOne: jest.fn().mockResolvedValue({
    //       workermetaconfig: [{ key: 'worker_config' }],
    //       jobrunmetaconfig: [{ key: 'job_run_config' }],
    //     }),
    //   };
    //   jest.spyOn(workerEntityMock, 'createQueryBuilder').mockReturnValue(mockQueryBuilder as any);
    //   const workerId = '123';
    //   // const mockWorker = { workerId, metaConfig: [{ configName: 'TestConfig' }] };

    //   // jest.spyOn(workerEntityMock, 'findOne').mockResolvedValue(mockWorker as WorkerEntity);

    //   const result = await service.getConfiguration(workerId, '', '', '');
    //   expect(result).toEqual(mockWorker.metaConfig);
    //   expect(workerEntityMock.findOne).toHaveBeenCalledWith({ where: { workerId } });
    // });

    // it('should create a new worker if not found and return its configuration', async () => {
    //   const workerId = '123';
    //   const ip = '127.0.0.1';
    //   const projectId = 'projectId';
    //   const workerName = 'workerName';
    //   const mockNewWorker = {
    //     workerId,
    //     ipAddress: ip,
    //     metaConfig: service.createWorkerConfiguration(workerId),
    //     status: WorkerStatus.Online,
    //     workerName,
    //     createdBy: workerId,
    //     projectId,
    //   };

    //   jest.spyOn(workerEntityMock, 'findOne').mockResolvedValue(null);
    //   jest.spyOn(workerEntityMock, 'create').mockReturnValue(mockNewWorker as WorkerEntity);
    //   jest.spyOn(workerEntityMock, 'save').mockResolvedValue(mockNewWorker as WorkerEntity);

    //   const result = await service.getConfiguration(workerId, ip, projectId, workerName);
    //   expect(result).toEqual(mockNewWorker.metaConfig);
    //   expect(workerEntityMock.create).toHaveBeenCalledWith(mockNewWorker);
    //   expect(workerEntityMock.save).toHaveBeenCalledWith(mockNewWorker);
    // });
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
    it('should start the workflow with the correct payload', async () => {
      const payload: CreateRequestDto = {
        options: { startDelay: '10', workflowExecutionTimeout: '12',workflowRunTimeout :'12' , workflowTaskTimeout: '12' },
        fileServer: { hostname: 'test', protocols: [] },
        workerIds: ['123']
      };
      const traceId = 'trace123';

      const expectedWorkflowPayload = {
        workflowId: `${WorkFlows.VALIDATE_CONNECTION}-${traceId}`,
        taskQueue: 'ParentWorkflow-TaskQueue',
        args: [{ traceId, payload: { traceId, ...payload }, options: payload.options }],
        ...payload.options,

      };

      await service.validateConnection(payload, traceId);

      expect(workflowServiceMock.startWorkflow).toHaveBeenCalledWith(
        WorkFlows.VALIDATE_CONNECTION,
        expectedWorkflowPayload,
      );
    });
  });
});
