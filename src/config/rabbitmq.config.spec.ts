import rabbitmqConfig from './rabbitmq.config';

describe('RabbitMQ Configuration', () => {
  beforeEach(() => {
    // Clear environment variables before each test to ensure clean state
    delete process.env.RABBITMQ_URLS;
    delete process.env.RABBITMQ_QUEUE;
    delete process.env.RABBITMQ_QUEUE_DURABLE;
  });

  it('should return default values when environment variables are not set', () => {
    const config = rabbitmqConfig();

    expect(config.urls).toBe('amqp://localhost:5672');
    expect(config.queue).toBe('main_queue');
    expect(config.queueOptions.durable).toBe(false);
  });

  it('should return values from environment variables when set', () => {
    process.env.RABBITMQ_URLS = 'amqp://custom-url:5672';
    process.env.RABBITMQ_QUEUE = 'custom_queue';
    process.env.RABBITMQ_QUEUE_DURABLE = 'true';

    const config = rabbitmqConfig();

    expect(config.urls).toBe('amqp://custom-url:5672');
    expect(config.queue).toBe('custom_queue');
    expect(config.queueOptions.durable).toBe(true);
  });

  it('should handle partial environment variable settings', () => {
    process.env.RABBITMQ_URLS = 'amqp://another-url:5672';

    const config = rabbitmqConfig();

    expect(config.urls).toBe('amqp://another-url:5672');
    expect(config.queue).toBe('main_queue');
    expect(config.queueOptions.durable).toBe(false);
  });
});
