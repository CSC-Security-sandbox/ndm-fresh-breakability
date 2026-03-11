import appConfig from './app.config';

describe('App Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv }; // Clone the original environment variables
  });

  afterEach(() => {
    process.env = originalEnv; // Restore the original environment variables
  });

  it('should return default values when no environment variables are set', () => {
    delete process.env.APP_HOST;
    delete process.env.APP_PORT;
    delete process.env.RABBITMQ_URL;
    delete process.env.RABBITMQ_QUEUE;
    delete process.env.RABBITMQ_QUEUE_IS_DURABLE;

    const config = appConfig();
    expect(config).toEqual({
      http: {
        host: '0.0.0.0',
        port: 3000,
      },
      rabbitmq: {
        urls: [],
        queue: '',
        durable: false,
      },
    });
  });

  it('should use environment variables if they are set', () => {
    process.env.APP_HOST = '127.0.0.1';
    process.env.APP_PORT = '8080';
    process.env.RABBITMQ_URL = 'amqp://localhost,amqp://remote';
    process.env.RABBITMQ_QUEUE = 'test-queue';
    process.env.RABBITMQ_QUEUE_IS_DURABLE = 'true';

    const config = appConfig();
    expect(config).toEqual({
      http: {
        host: '127.0.0.1',
        port: 8080,
      },
      rabbitmq: {
        urls: ['amqp://localhost', 'amqp://remote'],
        queue: 'test-queue',
        durable: 'true', // Note: process.env variables are strings; ensure type conversion if needed
      },
    });
  });

  it('should handle missing and partially set environment variables', () => {
    process.env.RABBITMQ_URL = 'amqp://localhost';

    const config = appConfig();
    expect(config).toEqual({
      http: {
        host: '0.0.0.0',
        port: 3000,
      },
      rabbitmq: {
        urls: ['amqp://localhost'],
        queue: '',
        durable: false,
      },
    });
  });
});
