import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { Runtime } from '@temporalio/worker';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const loggerFactory = await app.resolve(LoggerFactory);
  const logger: LoggerService = loggerFactory.create('Bootstrap');
  const configService = app.get(ConfigService);
  const workerId = configService.get<string>('worker.workerId');
  const otelCollectorEndpoint = configService.get<string>('worker.otelCollectorEndPoint');
  const processId = process.pid;
  app.enableShutdownHooks();
  initializeTemporalTelemetry(otelCollectorEndpoint);

  await app.init();
  logger.log(
    `Worker Service Started.\nWorker ID: ${workerId}\nProcess ID: ${processId}`,
  );
}
bootstrap();

//send temporal-sdk metrics to OpenTelemetry collector
function initializeTemporalTelemetry(otelCollectorEndpoint: string): void {
  Runtime.install({
    telemetryOptions: {
      metrics: {
        metricPrefix: 'temporal_sdk_metrics_',
        // OpenTelemetry collector configuration
        otel: {
          url: `http://${otelCollectorEndpoint}/v1/metrics`,
          http: true,
          metricsExportInterval: '10s',
          temporality: 'cumulative',
          useSecondsForDurations: true,
        },
      },
    },
  });
}
