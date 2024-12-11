import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const host: string = configService.get<string>('app.http.host');
  const port: number = configService.get<number>('app.http.port');

    app.connectMicroservice({
      transport: Transport.RMQ,
      options: {
        urls: configService.get('app.rabbitmq.urls'),
        queue: configService.get('app.rabbitmq.queue'),
        noAck: false,
        queueOptions: {
          durable: configService.get('app.rabbitmq.durable'),
          arguments: {
            'x-queue-type': 'quorum',
          },
        },
      },
    });

    /* deprecated 
     app.connectMicroservice({
      transport: Transport.RMQ,
      options: {
        urls: configService.get('app.rabbitmq.urls'),
        queue: configService.get('app.rabbitmq.taskqueue'),
        noAck: false,
        queueOptions: {
          durable: true,
          arguments: {
            'x-queue-type': 'quorum',
          },
        },
      },
    });
    */

  await app.startAllMicroservices()

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.setGlobalPrefix('api/v1/')

  app.useGlobalPipes(new ValidationPipe())

  const serverEndpoint = `http://${host}:${port}`;
  const config = new DocumentBuilder()
    .setTitle('Job service')
    .setDescription('Job Management')
    // .addServer(serverEndpoint, `Environment`) 
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'swagger/json',
  });

  app.enableShutdownHooks();
  app.set('trust proxy', true);

  app.enableCors();

  // await serviceQueue.listen();
  Logger.log('Service Queue Microservice is listening...');
  // await taskQueue.listen();
  Logger.log('Task Queue Microservice is listening...');
  await app.listen(port, '0.0.0.0');
}
bootstrap();