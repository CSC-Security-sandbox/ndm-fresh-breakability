import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from './logger/logger.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const configService = app.get(ConfigService);
  const logger = app.get(LoggerService);
  const workerId = configService.get<string>('worker.workerId');
  const processId = process.pid;
  app.enableShutdownHooks();
  logger.info( `Worker Service Started.\n Worker ID: ${workerId}\nProcess Id: ${processId}`);
}
bootstrap();
