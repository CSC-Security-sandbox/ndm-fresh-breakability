import { registerAs } from '@nestjs/config';

export default registerAs(
  'app',
  (): Record<string, any> => ({
    http: {
      host: process.env.APP_HOST || '0.0.0.0',
      port: parseInt(process.env.APP_PORT) || 3040,
    },
    rabbitmq: {
        urls: process.env.RABBITMQ_URL?.split(',') || [],
        queue: process.env.RABBITMQ_QUEUE || '',
        durable: process.env.RABBITMQ_QUEUE_IS_DURABLE || false
    }
  }),
);
