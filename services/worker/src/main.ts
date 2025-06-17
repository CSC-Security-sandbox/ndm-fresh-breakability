import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from './logger/logger.service';
import { Runtime, makeTelemetryFilterString, DefaultLogger } from '@temporalio/worker';

function initializeRuntime(defaultLogger: DefaultLogger) {
  Runtime.install({
    logger: defaultLogger,
    telemetryOptions: {
   
      logging: {
          forward: {},
          filter: makeTelemetryFilterString({ core: 'TRACE', other: 'DEBUG' }),
      },   
    }    
  });
}


async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = app.get(Logger);
  const configService = app.get(ConfigService);
  const workerId = configService.get<string>('worker.workerId');
  const processId = process.pid;
  app.enableShutdownHooks();
  initializeRuntime(logger.defaultLogger);
  await app.init();
  logger.info( `Worker Service Started.\n Worker ID: ${workerId}\nProcess Id: ${processId}`);
}
bootstrap();