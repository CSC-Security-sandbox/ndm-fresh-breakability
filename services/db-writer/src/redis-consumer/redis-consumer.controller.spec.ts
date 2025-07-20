import { Test, TestingModule } from '@nestjs/testing';
import { RedisConsumerController } from './redis-consumer.controller';
import { RedisConsumerService } from './redis-consumer.service';
import { ConsumerDto } from './redis-consumer.dto';

describe('RedisConsumerController', () => {
  let controller: RedisConsumerController;
  let service: RedisConsumerService;

  const mockRedisConsumerService = {
    saveJobConsumersToRedis: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RedisConsumerController],
      providers: [
        {
          provide: RedisConsumerService,
          useValue: mockRedisConsumerService,
        },
      ],
    }).compile();

    controller = module.get<RedisConsumerController>(RedisConsumerController);
    service = module.get<RedisConsumerService>(RedisConsumerService);
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

      // Verifies the service was called with correct jobRunId
      expect(service.saveJobConsumersToRedis).toHaveBeenCalledWith('job-1234');

      // Verifies the controller returned the success message
      expect(result).toEqual({
        success: true,
        message: 'Consumer started successfully.',
      });
    });

    // it('should not throw even if service method throws (fire-and-forget)', async () => {
    //   const dto: ConsumerDto = {
    //     jobRunId: 'job-5678',
    //   };

    //   // Simulate internal service error
    //   mockRedisConsumerService.saveJobConsumersToRedis.mockImplementationOnce(() => {
    //     throw new Error('Simulated Redis error');
    //   });

    //   // Controller should still return success, since fire-and-forget
    //   const result = await controller.start(dto);

    //   expect(service.saveJobConsumersToRedis).toHaveBeenCalledWith('job-5678');
    //   expect(result).toEqual({
    //     success: true,
    //     message: 'Consumer started successfully.',
    //   });
    // });
  });
});
