import { Test, TestingModule } from '@nestjs/testing';
import { RedisConsumerController } from './redis-consumer.controller';
import { RedisConsumerService } from './redis-consumer.service';

describe('RedisConsumerController', () => {
  let controller: RedisConsumerController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RedisConsumerController],
      providers: [RedisConsumerService],
    }).compile();

    controller = module.get<RedisConsumerController>(RedisConsumerController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
