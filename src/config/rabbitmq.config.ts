import { registerAs } from '@nestjs/config';

export default registerAs('rabbitmq', () => (console.log(`RabbitMQ Config: ${process.env.RABBITMQ_URLS}`), {
  urls: process.env.RABBITMQ_URLS || 'amqp://localhost:5672',
  queue: process.env.RABBITMQ_QUEUE || 'main_queue',
  queueOptions: {
    durable: process.env.RABBITMQ_QUEUE_DURABLE === 'true',
  },
}));
