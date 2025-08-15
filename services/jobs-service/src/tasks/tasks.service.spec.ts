import { Test, TestingModule } from '@nestjs/testing';
import { TasksService } from './tasks.service';
import { In, Repository } from 'typeorm';
import { TaskEntity } from 'src/entities/task.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TaskQueryParamsDto } from './dto/taskpage.dto';
import { TaskStatus } from 'src/constants/enums';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

describe('TasksService', () => {
  let tasksService: TasksService;
  let taskRepo: Repository<TaskEntity>;

  const mockTaskRepo = {
    find: jest.fn(),
    count: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: getRepositoryToken(TaskEntity),
          useValue: mockTaskRepo,
        },
       {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue({
              log: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
              debug: jest.fn(),
              verbose: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    tasksService = module.get<TasksService>(TasksService);
    taskRepo = module.get<Repository<TaskEntity>>(getRepositoryToken(TaskEntity));
  });

  it('should be defined', () => {
    expect(tasksService).toBeDefined();
  });

  describe('getTaskList', () => {
    const taskQueryParams: TaskQueryParamsDto = {
      page: '1',
      limit: '10',
      sort: 'createdAt',
      order: 'asc',
      jobRunId: 'testJobRunId',
    };

    it('should return paginated task list', async () => {

      const mockData = [{ id: 1, name: 'Task 1' }, { id: 2, name: 'Task 2' }];
      mockTaskRepo.find.mockResolvedValue(mockData);
      mockTaskRepo.count.mockResolvedValue(2);

      const result = await tasksService.getTaskList(taskQueryParams);

      expect(taskRepo.find).toHaveBeenCalledWith({
        where: { jobRunId: 'testJobRunId' },
        order: { createdAt: 'asc' },
        skip: 0,
        take: 10,
      });
      expect(taskRepo.count).toHaveBeenCalledWith({
        where: { jobRunId: 'testJobRunId' },
      });
      expect(result).toEqual({ data: mockData, total: 2 });
    });

    it('should return task list without pagination if page and limit are not provided', async () => {
      const taskQueryParamsWithoutPagination: TaskQueryParamsDto = {
        sort: 'createdAt',
        order: 'asc',
        jobRunId: 'testJobRunId',
      };

      const mockData = [{ id: 1, name: 'Task 1' }];
      mockTaskRepo.find.mockResolvedValue(mockData);
      mockTaskRepo.count.mockResolvedValue(1);

      const result = await tasksService.getTaskList(taskQueryParamsWithoutPagination);

      expect(taskRepo.find).toHaveBeenCalledWith({
        where: { jobRunId: 'testJobRunId' },
        order: { createdAt: 'asc' },
      });
      expect(taskRepo.count).toHaveBeenCalledWith({
        where: { jobRunId: 'testJobRunId' },
      });
      expect(result).toEqual({ data: mockData, total: 1 });
    });

    it('should correctly handle filters with In() clause', async () => {
      const taskQueryWithFilters: TaskQueryParamsDto = {
        page: '1',
        limit: '5',
        sort: 'createdAt',
        order: 'desc',
        jobRunId: 'testJobRunId',
        workerId:['234567-45678-56789'],
        status: [TaskStatus.Completed, TaskStatus.Errored],
      };

      mockTaskRepo.find.mockResolvedValue([]);
      mockTaskRepo.count.mockResolvedValue(0);

      await tasksService.getTaskList(taskQueryWithFilters);

      expect(taskRepo.find).toHaveBeenCalledWith({
        where: {
          jobRunId: 'testJobRunId',
          workerId: In(['234567-45678-56789']),
          status: In( [TaskStatus.Completed, TaskStatus.Errored]),
        },
        order: { createdAt: 'desc' },
        skip: 0,
        take: 5,
      });
    });

  });

  it('should return an empty result when no workers are found', async () => {
    const taskQueryWithFilters: TaskQueryParamsDto = { page: '1', limit: '10' };
    mockTaskRepo.find.mockResolvedValue([]);
    mockTaskRepo.count.mockResolvedValue(0);

    const result = await tasksService.getTaskList(taskQueryWithFilters);

    expect(result).toEqual({ data: [], total: 0 });
  });
});
