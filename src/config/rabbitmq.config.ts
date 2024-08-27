import { registerAs } from '@nestjs/config';

export default registerAs('rabbitmq', () => ({
  urls: process.env.RABBITMQ_URLS || 'amqp://localhost:5672',
  queue: process.env.RABBITMQ_QUEUE || 'main_queue',
  queueOptions: {
    durable: process.env.RABBITMQ_QUEUE_DURABLE === 'true',
  },
}));
