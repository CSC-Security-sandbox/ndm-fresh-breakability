import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Transport } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);
  const host: string = configService.get<string>('app.http.host');
  const port: number = configService.get<number>('app.http.port');

    app.connectMicroservice({
      transport: Transport.RMQ,
      options: {
        urls: configService.get('app.rabbitmq.urls'),
        queue: configService.get('app.rabbitmq.reportsQueue'),
        noAck: false,
        queueOptions: {
          durable: configService.get('app.rabbitmq.durable'),
          arguments: {
            'x-queue-type': 'quorum',
          },
        },
      },
    });
    await app.startAllMicroservices()

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.setGlobalPrefix('api/v1/report');

  app.useGlobalPipes(new ValidationPipe());

  const config = new DocumentBuilder()
  .setTitle('Reports service')
  .setDescription('Used for discovery of files')
  .setVersion('1.0')
  .addTag('Reports discovery')
  .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document,{
    jsonDocumentUrl: 'swagger/json',
  });
  app.enableShutdownHooks();
  app.set('trust proxy', true);
  
  app.enableCors();

  await app.listen(port, '0.0.0.0');
}
bootstrap();
