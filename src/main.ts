import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const host: string = configService.get<string>('app.http.host', '0.0.0.0');
  const port: number = configService.get<number>('app.http.port', 3000) ?? 3000;

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.setGlobalPrefix('api/v1/');

  app.enableShutdownHooks();
  app.enableCors();
  await app.listen(port, '0.0.0.0');
  }
bootstrap();
