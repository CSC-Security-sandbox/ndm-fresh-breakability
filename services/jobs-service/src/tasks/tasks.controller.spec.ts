import { Test, TestingModule } from '@nestjs/testing';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskQueryParamsDto } from './dto/taskpage.dto';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';

describe('TasksController', () => {
  let tasksController: TasksController;
  let tasksService: TasksService;

  const mockTasksService = {
    getTaskList: jest.fn(),
  };

  const mockJwtService = {
    verifyToken: jest.fn().mockResolvedValue({
      user: {
        roles: [
          {
            permissions: ['permission1', 'permission2'],
            projects: ['project1'],
          },
        ],
      },
    }),
    configService: {},
    client: jest.fn(),
    logger: jest.fn(),
    getKey: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        {
          provide: TasksService,
          useValue: mockTasksService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    tasksController = module.get<TasksController>(TasksController);
    tasksService = module.get<TasksService>(TasksService);
  });

  it('should be defined', () => {
    expect(tasksController).toBeDefined();
  });

  describe('getTaskList', () => {
    const validQueryParams = {
      page: 1,
      limit: 10,
    };

    it('should call taskService.getTaskList with correct parameters', async () => {
      mockTasksService.getTaskList.mockResolvedValue(['Task1', 'Task2']);
      const result = await tasksController.getTaskList(validQueryParams as any);
      expect(tasksService.getTaskList).toHaveBeenCalledWith(validQueryParams);
      expect(result).toEqual(['Task1', 'Task2']);
    });

    it('should throw a BadRequestException for invalid query parameters', async () => {
      const invalidQueryParams: any = { page: -1, limit: 0 };

      const validationPipe = new ValidationPipe({
        transform: false,
        whitelist: true,
      });

      await expect(
        validationPipe.transform(invalidQueryParams, {
          metatype: TaskQueryParamsDto,
          type: 'query',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle service errors gracefully', async () => {
      mockTasksService.getTaskList.mockRejectedValue(
        new Error('Service Error'),
      );
      await expect(
        tasksController.getTaskList(validQueryParams as any),
      ).rejects.toThrow('Service Error');
    });
  });
});
