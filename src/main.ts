import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);
  const host: string = configService.get<string>('app.http.host');
  const port: number = configService.get<number>('app.http.port');



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

  SwaggerModule.setup('db-writer-docs', app, document, {
    jsonDocumentUrl: 'swagger/json',
  });

  app.enableShutdownHooks();
  app.set('trust proxy', true);
  app.enableCors();

  await app.listen(port, '0.0.0.0');
}
bootstrap();
