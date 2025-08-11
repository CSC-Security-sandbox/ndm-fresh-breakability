import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { json } from 'express';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { ResponseInterceptor } from '@netapp-cloud-datamigrate/api-handler-lib';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const loggerFactory = app.resolve(LoggerFactory);
  app.useGlobalInterceptors(
    new ResponseInterceptor([], [], await loggerFactory),
  );
  const jsonPayloadLimit = configService.get<string>(
    'app.options.jsonPayloadLit',
  );
  const host: string = configService.get<string>('app.http.host');
  const port: number = configService.get<number>('app.http.port');

  app.use(json({ limit: jsonPayloadLimit }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api/v1');

  const serverEndpoint = `http://${host}:${port}`;
  app.useGlobalPipes(new ValidationPipe());
  const config = new DocumentBuilder()
    .setTitle('Config service')
    .setDescription('Configuration Management')
    .setVersion('1.0')
    .addServer(serverEndpoint, `Environment`)
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('config-docs', app, document, {
    jsonDocumentUrl: 'swagger/json',
  });

  app.enableShutdownHooks();
  app.set('trust proxy', true);
  app.enableCors();
  await app.listen(port, '0.0.0.0');
}
bootstrap();
