import { Test, TestingModule } from '@nestjs/testing';
import { RedisConsumerController } from './redis-consumer.controller';
import { RedisConsumerService } from './redis-consumer.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { ConsumerDto } from './redis-consumer.dto';

describe('RedisConsumerController', () => {
  let controller: RedisConsumerController;
  let service: RedisConsumerService;

  const mockRedisConsumerService = {
    saveJobConsumersToRedis: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RedisConsumerController],
      providers: [
        {
          provide: RedisConsumerService,
          useValue: mockRedisConsumerService,
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue({
              info: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
              debug: jest.fn(),
              log: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<RedisConsumerController>(RedisConsumerController);
    service = module.get<RedisConsumerService>(RedisConsumerService);

    // Reset mocks before each test
    jest.clearAllMocks();
    // Ensure default behavior returns a resolved promise
    mockRedisConsumerService.saveJobConsumersToRedis.mockResolvedValue(true);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('start()', () => {
    it('should call service method and return success response', async () => {
      const dto: ConsumerDto = {
        jobRunId: 'job-1234',
      };

      const result = await controller.start(dto);

      // Verifies the service was called with correct jobRunId and undefined projectId
      expect(service.saveJobConsumersToRedis).toHaveBeenCalledWith('job-1234', undefined);

      // Verifies the controller returned the success message
      expect(result).toEqual({
        success: true,
        message: 'Consumer started successfully.',
      });
    });

    it('should call service method with projectId when provided', async () => {
      const dto: ConsumerDto = {
        jobRunId: 'job-1234',
      };
      const projectId = 'project-123';

      const result = await controller.start(dto, projectId);

      // Verifies the service was called with correct jobRunId and projectId
      expect(service.saveJobConsumersToRedis).toHaveBeenCalledWith('job-1234', 'project-123');

      // Verifies the controller returned the success message
      expect(result).toEqual({
        success: true,
        message: 'Consumer started successfully.',
      });
    });

    it('should not throw even if service method throws (fire-and-forget)', async () => {
      const dto: ConsumerDto = {
        jobRunId: 'job-5678',
      };

      // Simulate internal service error (async to match fire-and-forget)
      mockRedisConsumerService.saveJobConsumersToRedis.mockImplementationOnce(() => {
        return Promise.reject(new Error('Simulated Redis error'));
      });

      // Controller should still return success, since fire-and-forget
      const result = await controller.start(dto);

      expect(service.saveJobConsumersToRedis).toHaveBeenCalledWith('job-5678', undefined);
      expect(result).toEqual({
        success: true,
        message: 'Consumer started successfully.',
      });

      // Reset mock to avoid affecting other tests
      mockRedisConsumerService.saveJobConsumersToRedis.mockReset();
    });
  });
});
