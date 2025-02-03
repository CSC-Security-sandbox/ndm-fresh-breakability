import { Test, TestingModule } from '@nestjs/testing';
import { RedisConsumerService } from './redis-consumer.service';

describe('RedisConsumerService', () => {
  let service: RedisConsumerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RedisConsumerService],
    }).compile();

    service = module.get<RedisConsumerService>(RedisConsumerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
