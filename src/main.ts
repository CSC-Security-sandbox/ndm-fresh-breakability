import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config'
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);
  const host: string = configService.get<string>('app.http.host');
  const port: number = configService.get<number>('app.http.port');

  Logger.log(`RabbitMQ URLs: ${configService.get<string>('app.rabbitmq.urls')}`);
  Logger.log(`Queue name: ${configService.get<string>('app.rabbitmq.inventoryQueue')}`);

  // app.connectMicroservice<MicroserviceOptions>({
  //   transport: Transport.RMQ,
  //   options: {
  //     urls: configService.get('app.rabbitmq.urls'),
  //     queue: configService.get('app.rabbitmq.inventoryQueue'),
  //     noAck: false,
  //     queueOptions: {
  //       durable: true,
  //       arguments: {
  //         'x-queue-type': 'quorum',
  //       },
  //     },
  //   },
  // });

  // await app.startAllMicroservices();

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api/v1/');
  app.useGlobalPipes(new ValidationPipe());
  app.useGlobalPipes(new ValidationPipe());

  const serverEndpoint = `http://${host}:${port}`;
  const config = new DocumentBuilder()
    .setTitle('DB writer service')
    .setDescription('Persisting discovery inventory data into the database')
    .addServer(serverEndpoint, `Environment`)
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'swagger/json',
  });

  app.enableShutdownHooks();
  app.set('trust proxy', true);
  app.enableCors();

  await app.listen(port, '0.0.0.0');
}
bootstrap();
