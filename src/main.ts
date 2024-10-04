import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const appContext = await NestFactory.createApplicationContext(AppModule);
  const configService = appContext.get(ConfigService);

  Logger.log(configService.get<string>('rabbitmq.urls'));
  Logger.log(configService.get<string>('rabbitmq.queue'));

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: configService.get<string>('rabbitmq.urls').split(','),
        queue: configService.get<string>('rabbitmq.queue'),
        noAck: false,
        queueOptions: {
          durable: configService.get<boolean>('rabbitmq.queueOptions.durable'),
          arguments: {
            'x-queue-type': 'quorum', // Define the queue as a quorum queue
          },
        },
      },
    },
  );
  await app.listen();
}
bootstrap();
