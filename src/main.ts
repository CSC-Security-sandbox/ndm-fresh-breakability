import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { RabbitMQConfigService } from './config/rabbitmq.config';


async function bootstrap() {
  const appContext = await NestFactory.createApplicationContext(AppModule);
  const rabbitMQConfig = appContext.get(RabbitMQConfigService);

  // Logger.log(configService.get<string>('rabbitmq.urls'));
  // Logger.log(configService.get<string>('rabbitmq.queue'));
  Logger.log(`RabbitMQ URIs: ${rabbitMQConfig.uris}`);
  Logger.log(`Task Queue: ${rabbitMQConfig.taskQueueName}`);
  Logger.log(`Inventory Queue: ${rabbitMQConfig.inventoryQueueName}`);

 // Microservice setup for Task Queue
 const taskQueueApp = await NestFactory.createMicroservice<MicroserviceOptions>(
  AppModule,
  {
    transport: Transport.RMQ,
    options: {
      urls: rabbitMQConfig.uris,
      queue: rabbitMQConfig.taskQueueName,
      noAck: false,
      queueOptions: {
        durable: true,
        arguments: {
          'x-queue-type': 'quorum', // Define the queue as a quorum queue
        },
      },
    },
  },
);

// Microservice setup for Inventory Queue
const inventoryQueueApp = await NestFactory.createMicroservice<MicroserviceOptions>(
  AppModule,
  {
    transport: Transport.RMQ,
    options: {
      urls: rabbitMQConfig.uris,
      queue: rabbitMQConfig.inventoryQueueName,
      noAck: false,
      queueOptions: {
        durable: true,
        arguments: {
          'x-queue-type': 'quorum', // Define the queue as a quorum queue
        },
      },
    },
  },
);

await taskQueueApp.listen();
Logger.log('Task Queue Microservice is listening...');

await inventoryQueueApp.listen();
Logger.log('Inventory Queue Microservice is listening...');
}
bootstrap();






















