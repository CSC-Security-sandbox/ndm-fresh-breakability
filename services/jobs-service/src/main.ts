import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ResponseInterceptor } from '@netapp-cloud-datamigrate/api-handler-lib';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const loggerFactory = await app.resolve(LoggerFactory);
  const configService = app.get(ConfigService);
  const port: number = configService.get<number>('app.http.port');

  app.useGlobalInterceptors(new ResponseInterceptor([], [], loggerFactory));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.setGlobalPrefix('api/v1/');

  app.useGlobalPipes(new ValidationPipe());

  const config = new DocumentBuilder()
    .setTitle('Job service')
    .setDescription('Job Management')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('/api/v1/jobs-docs', app, document, {
    jsonDocumentUrl: 'swagger/json',
  });

  app.enableShutdownHooks();
  app.set('trust proxy', true);

  app.enableCors();

  Logger.log('Service Queue Microservice is listening...');
  Logger.log('Task Queue Microservice is listening...');
  await app.listen(port, '0.0.0.0');
  Logger.log(`Service started on port ${port}`);
}
void bootstrap();
