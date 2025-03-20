import { Test, TestingModule } from '@nestjs/testing';
import { RedisConsumerController } from './redis-consumer.controller';

describe('RedisConsumerController', () => {
  let controller: RedisConsumerController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RedisConsumerController],
    }).compile();

    controller = module.get<RedisConsumerController>(RedisConsumerController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
