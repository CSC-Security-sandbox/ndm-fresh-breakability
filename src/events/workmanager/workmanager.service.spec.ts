import { Test, TestingModule } from '@nestjs/testing';

import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobRunStatus, OperationStatus, OperationType, TaskStatus } from 'src/constants/enums';
import { EmitterEvents } from 'src/constants/events';
import { OperationsEntity } from 'src/entities/operation.entity';
import { TaskEntity } from 'src/entities/task.entity';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import { Repository } from 'typeorm';
import { WorkManager } from './workmanager.service';

class MockRepository<T> extends Repository<T> {
    async save(e: any):Promise<any> {
        return e
    }
    async findOne(e: any):Promise<any> {
        return e
    }
    async update(e: any):Promise<any> {
        return e
    }
    async findOneBy(e: any):Promise<any> {
        return e
    }
  }


describe('WorkManager', () => {
  let workManager: WorkManager;
  let operationsRepo: Repository<OperationsEntity>;
  let taskRepo: MockRepository<TaskEntity>;
  let workerJobRunMapRepo: MockRepository<WorkerJobRunMap>;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkManager,
        {
          provide: getRepositoryToken(OperationsEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(TaskEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(WorkerJobRunMap),
          useClass: Repository,
        },
        EventEmitter2,
      ],
    }).compile();

    workManager = module.get<WorkManager>(WorkManager);
    operationsRepo = module.get<Repository<OperationsEntity>>(getRepositoryToken(OperationsEntity));
    taskRepo = module.get<MockRepository<TaskEntity>>(getRepositoryToken(TaskEntity));
    workerJobRunMapRepo = module.get<MockRepository<WorkerJobRunMap>>(getRepositoryToken(WorkerJobRunMap));
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  it('should be defined', () => {
    expect(workManager).toBeDefined();
  });

  describe('rmqTask', () => {
    it('should create and save an operation and notify workers', async () => {
      const mockData = {
        jobRunId: '1234',
        folder: '/path/to/folder',
      };
      const mockWorkers = [{ workerId: 'worker1' }, { workerId: 'worker2' }];

      jest.spyOn(operationsRepo, 'create').mockReturnValue({} as any);
      jest.spyOn(operationsRepo, 'save').mockResolvedValue({} as any);
      jest.spyOn(workerJobRunMapRepo, 'find').mockResolvedValue(mockWorkers as any);
      jest.spyOn(eventEmitter, 'emit');

      await workManager.rmqTask(mockData as any);

      expect(operationsRepo.create).toHaveBeenCalledWith({
        jobRunId: '1234',
        status: OperationStatus.READY,
        fPath: '/path/to/folder',
        retryCount: 0,
        operationType: OperationType.SCAN,
        request: expect.anything(),
      });
      expect(operationsRepo.save).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
      expect(eventEmitter.emit).toHaveBeenCalledWith(EmitterEvents.NotifyWorker, {
        workerId: 'worker1',
        socketEvents: expect.anything(),
        payload: { jobRunId: '1234' },
      });
    });
  });

  describe('createOperation', () => {
    it('should create and save an operation and notify workers', async () => {
      const mockPayload = {
        jobRunId: '1234',
        sPath: '/source/path',
        taskType: 'SCAN',
        workers: ['worker1', 'worker2'],
      };

      jest.spyOn(operationsRepo, 'create').mockReturnValue({} as any);
      jest.spyOn(operationsRepo, 'save').mockResolvedValue({} as any);
      jest.spyOn(eventEmitter, 'emit');

      await workManager.createOperation(mockPayload as any);

      expect(operationsRepo.create).toHaveBeenCalledWith({
        jobRunId: '1234',
        status: OperationStatus.READY,
        fPath: '/source/path',
        retryCount: 0,
        operationType: expect.anything(),
        request: expect.anything(),
      });
      expect(operationsRepo.save).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
      expect(eventEmitter.emit).toHaveBeenCalledWith(EmitterEvents.NotifyWorker, {
        workerId: 'worker1',
        socketEvents: expect.anything(),
        payload: { jobRunId: '1234' },
      });
    });
  });

  describe('createUnScannedTask', () => {
    it('should create and save unscanned operations and notify workers', async () => {
      const mockData = {
        jobRunId: '1234',
        paths: ['/path1', '/path2'],
      };
      const mockWorkers = [{ workerId: 'worker1' }, { workerId: 'worker2' }];

      jest.spyOn(operationsRepo, 'create').mockReturnValue({} as any);
      jest.spyOn(operationsRepo, 'save').mockResolvedValue({} as any);
      jest.spyOn(workerJobRunMapRepo, 'find').mockResolvedValue(mockWorkers as any);
      jest.spyOn(eventEmitter, 'emit');

      await workManager.createUnScannedTask(mockData as any);

      expect(operationsRepo.create).toHaveBeenCalledTimes(2);
      expect(operationsRepo.save).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
    });
  });

  it('should build task payload correctly', () => {
    const task = { id: 'task1', jobRunId: 'jobRun1', taskType: 'SCAN', status: 'PENDING', workerId: 'worker1' };
    const operations = [
      { fPath: '/path1', request: 'request1' },
      { fPath: '/path2', request: 'request2' },
    ];
    const jobRun = { sPathId: '/source/path', tPathId: '/target/path' };
  
    const payload = workManager.buildTaskPayload(task as any, operations as any, jobRun as any);
  
    expect(payload).toEqual({
      id: 'task1',
      jobRunId: 'jobRun1',
      sPath: '/source/path',
      tPath: '/target/path',
      taskType: 'SCAN',
      status: 'PENDING',
      workerId: 'worker1',
      commands: ['request1', 'request2'],
    });
  });

  it('should log completion when all operations are completed', async () => {
    const mockPayload = {
      id: 'task1',
      jobRunId: 'jobRun1',
      commands: [{ fPath: '/path1', ops: { '0': { status: 'COMPLETED' } } }],
    };
  
    jest.spyOn(workManager, 'updateScanTask').mockResolvedValue({} as any)
    jest.spyOn(operationsRepo, 'count').mockResolvedValue(0);
    jest.spyOn(taskRepo, 'count').mockResolvedValue(0);
  
    await workManager.updateTask(mockPayload as any);   
    expect(workManager.updateScanTask).toBeCalled()
  });

  describe('assignWork', () => {
    it('should return a task if an eligible task is found', async () => {
      const mockJobRunMapEntities = [
        {
          jobRunId: 'jobRun1',
          jobRun: { jobConfig: { sourcePathId: '/source1', targetPathId: '/target1' } },
        },
      ];

      jest.spyOn(workerJobRunMapRepo, 'createQueryBuilder').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockJobRunMapEntities),
      } as any);

      jest.spyOn(workManager, 'createTask').mockResolvedValue({ id: 'task1' } as any);

      const result = await workManager.assignWork('worker1');

      expect(workerJobRunMapRepo.createQueryBuilder).toHaveBeenCalled();
      expect(workManager.createTask).toHaveBeenCalledWith(
        { jobRunId: 'jobRun1', sPathId: '/source1', tPathId: '/target1' },
        'worker1'
      );
      expect(result).toEqual({ id: 'task1' });
    });

    it('should return undefined if no eligible tasks are found', async () => {
      jest.spyOn(workerJobRunMapRepo, 'createQueryBuilder').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      } as any);

      const result = await workManager.assignWork('worker1');

      expect(workerJobRunMapRepo.createQueryBuilder).toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('should iterate through job runs and return the first successful task', async () => {
      const mockJobRunMapEntities = [
        {
          jobRunId: 'jobRun1',
          jobRun: { jobConfig: { sourcePathId: '/source1', targetPathId: '/target1' } },
        },
        {
          jobRunId: 'jobRun2',
          jobRun: { jobConfig: { sourcePathId: '/source2', targetPathId: '/target2' } },
        },
      ];

      jest.spyOn(workerJobRunMapRepo, 'createQueryBuilder').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockJobRunMapEntities),
      } as any);

      jest.spyOn(workManager, 'createTask')
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ id: 'task2' } as any);

      const result = await workManager.assignWork('worker1');

      expect(workManager.createTask).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ id: 'task2' });
    });
  });


  describe('createTask', () => {
    it('should create and save a task and update operations', async () => {
      const mockJobRun = {
        jobRunId: 'jobRun1',
        sPathId: '/source1',
        tPathId: '/target1',
        status: JobRunStatus.Ready
      };
  
      const mockOperations = [
        { id: 'op1', operationType: OperationType.SCAN, status: OperationStatus.READY },
        { id: 'op2', operationType: OperationType.SCAN, status: OperationStatus.READY },
      ];
  
      const mockTask = {
        id: 'task1',
        jobRunId: 'jobRun1',
        taskType: 'SCAN',
        status: TaskStatus.Pending,
        workerId: 'worker1',
      };
  
      (taskRepo as any).manager = {
        transaction: jest.fn(async (callback: any) => {
          return callback({
            createQueryBuilder: jest.fn().mockReturnValue({
              setLock: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue(mockOperations),
            }),
            save: jest.fn().mockResolvedValue(mockTask),
            update: jest.fn().mockResolvedValue(undefined),
          });
        }),
      } as any

      taskRepo.create =  jest.fn()
  
      const result = await workManager.createTask(mockJobRun, 'worker1');
  
      expect(result).toEqual({
        id: 'task1',
        jobRunId: 'jobRun1',
        sPath: '/source1',
        tPath: '/target1',
        taskType: 'SCAN',
        status: TaskStatus.Pending,
        workerId: 'worker1',
        commands: [undefined, undefined],
      });
    });
  
    it('should return undefined if no operations are ready', async () => {
      const mockJobRun = {
        jobRunId: 'jobRun1',
        sPathId: '/source1',
        tPathId: '/target1',
        status: JobRunStatus.Ready
      };

      (taskRepo as any).manager = {
        transaction: jest.fn(async (callback: any) => {
          return callback({
            createQueryBuilder: jest.fn().mockReturnValue({
              setLock: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([]),
            }),
            save: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockResolvedValue(undefined),
          });
        }),
      } as any

      taskRepo.create =  jest.fn()
  
      const result = await workManager.createTask(mockJobRun, 'worker1');
  
      expect(result).toBeUndefined();
    });
  });

  describe('updateScanTask', () => {
    it('should update operations to COMPLETED and task to COMPLETED when all commands succeed', async () => {
      const mockTask = {
        id: 'task1',
        jobRunId: 'jobRun1',
        commands: [
          { 
            fPath: '/path1', 
            ops: { 
                0 : { 
                    status: OperationStatus.COMPLETED 
                }
            }
         },
         { 
            fPath: '/path2', 
            ops: { 
                0 : { 
                    status: OperationStatus.COMPLETED 
                }
            }
         },
        ],
      };

      jest.spyOn(operationsRepo, 'update').mockResolvedValue(undefined);
      jest.spyOn(taskRepo, 'update').mockResolvedValue(undefined);
      jest.spyOn(operationsRepo, 'count').mockResolvedValue(0);
      jest.spyOn(taskRepo, 'count').mockResolvedValue(0);

      jest.spyOn(operationsRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(taskRepo, 'findOne').mockResolvedValue(null);


      await workManager.updateScanTask(mockTask as  any);

      expect(operationsRepo.update).toHaveBeenCalled(
      );

      expect(taskRepo.update).toHaveBeenCalledWith(
        { id: 'task1' },
        { status: TaskStatus.Completed }
      );
    });

    it('should update operations to ERROR when some commands fail', async () => {
      const mockTask = {
        id: 'task1',
        jobRunId: 'jobRun1',
        commands: [
          { fPath: '/path1', ops: [{ status: OperationStatus.COMPLETED }] },
          { fPath: '/path2', ops: [{ status: OperationStatus.ERROR, error: 'Some error' }] },
        ],
      };

      jest.spyOn(operationsRepo, 'update').mockResolvedValue(undefined);
      jest.spyOn(taskRepo, 'update').mockResolvedValue(undefined);

      await workManager.updateScanTask(mockTask as any);

      expect(operationsRepo.update).toHaveBeenCalled();
      expect(operationsRepo.update).toHaveBeenCalled();
      expect(taskRepo.update).toHaveBeenCalledWith(
        { id: 'task1' },
        { status: TaskStatus.Completed }
      );
    });

    it('should not mark jobRun as completed if there are pending operations or tasks', async () => {
      const mockTask = {
        id: 'task1',
        jobRunId: 'jobRun1',
        commands: [
          { fPath: '/path1', ops: [{ status: OperationStatus.COMPLETED }] },
        ],
      };

      jest.spyOn(operationsRepo, 'update').mockResolvedValue(undefined);
      jest.spyOn(taskRepo, 'update').mockResolvedValue(undefined);
      jest.spyOn(operationsRepo, 'count').mockResolvedValue(1);
      jest.spyOn(taskRepo, 'count').mockResolvedValue(1);
      jest.spyOn(operationsRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(taskRepo, 'findOne').mockResolvedValue(null);

      await workManager.updateScanTask(mockTask as any);
    });
  });
  
  
  
});
