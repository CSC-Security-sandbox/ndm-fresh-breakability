import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

describe('RabbitMQ Config', () => {
  let configService: ConfigService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ConfigService],
    }).compile();

    configService = moduleRef.get<ConfigService>(ConfigService);
  });

  it('should return the default RabbitMQ URLs', () => {
    const expectedUrls = 'amqp://localhost:5672';
    const urls = configService.get('rabbitmq.urls');
    expect(urls).toEqual(expectedUrls);
  });

  it('should return the default RabbitMQ queue', () => {
    const expectedQueue = 'main_queue';
    const queue = configService.get('rabbitmq.queue');
    expect(queue).toEqual(expectedQueue);
  });

  it('should return the default RabbitMQ queue options', () => {
    const expectedQueueOptions = { durable: false };
    const queueOptions = configService.get('rabbitmq.queueOptions');
    expect(queueOptions).toEqual(expectedQueueOptions);
  });
});
