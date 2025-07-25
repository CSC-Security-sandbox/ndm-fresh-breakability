import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const loggerFactory = await app.resolve(LoggerFactory);
  const logger: LoggerService = loggerFactory.create('Bootstrap');
  const configService = app.get(ConfigService);
  const workerId = configService.get<string>('worker.workerId');
  const processId = process.pid;
  app.enableShutdownHooks();
  await app.init();
  logger.log(`Worker Service Started.\nWorker ID: ${workerId}\nProcess ID: ${processId}`);
}
bootstrap();

