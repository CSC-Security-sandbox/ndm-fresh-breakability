import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { RabbitMQConfigService } from './config/rabbitmq.config';

async function bootstrap() {
  const appContext = await NestFactory.createApplicationContext(AppModule);
  const rabbitMQConfig = appContext.get(RabbitMQConfigService);

  Logger.log(`RabbitMQ URIs: ${rabbitMQConfig.uris}`);
  Logger.log(`Inventory Queue: ${rabbitMQConfig.inventoryQueueName}`);

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
            'x-queue-type': 'quorum',
          },
        },
      },
    },
  );

  await inventoryQueueApp.listen();
  Logger.log('Inventory Queue Microservice is listening...');
}
bootstrap();
