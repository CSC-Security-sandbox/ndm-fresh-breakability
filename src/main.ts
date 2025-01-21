import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import Logger from './logger/logging';

async function bootstrap() {
  const logger = Logger.getLogger();
  const app = await NestFactory.createApplicationContext(AppModule);
  const configService = app.get(ConfigService);
  const workerId = configService.get<string>('worker.workerId');
  const processId = process.pid;
  app.enableShutdownHooks();
  logger.info( `Worker Service Started.\n Worker ID: ${workerId}\nProcess Id: ${processId}`);
}
bootstrap();
