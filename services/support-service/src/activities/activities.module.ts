import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import appConfig from 'src/config/app.config';
import databaseConfig from 'src/config/database.config';
import temporalConfig from 'src/config/temporal.config';
import { OperationErrorEntity } from 'src/entities/operation-error.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { PrometheusService } from 'src/prometheus/prometheus.service';
import { PrometheusClientService } from 'src/prometheus/prometheus-client.service';
import { PrometheusDataProcessorService } from 'src/prometheus/prometheus-data-processor.service';
import { ZipHandlerService } from 'src/services/zip-handler.service';
import { OperationErrorService } from 'src/utils/error-csv-generation.service';
import { ActivitiesService } from './activities.service';
import { ConfigurationDataCsvGenerationActivity } from './config-data-csv-generation/config-data-csv-generation.activity';
import { ErrorCsvGenerationActivity } from './error-csv-generation/error-csv-generation.activity';
import { LogGeneratorActivity } from './log-generator/log-generator.activity';
import { NotifyConfigActivity } from './notify-config/notify-config.activity';
import { StateDataCsvGenerationActivity } from './state-data-csv-generation/state-data-csv-generation.activity';
import { SystemInventoryCsvGenerationActivity } from './system-inventory-csv-generation/system-inventory-csv-generation.activity';

import { SystemInventoryProcessorService } from './system-inventory-csv-generation/system-inventory-processor.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OperationErrorEntity, WorkerEntity]),
    ConfigModule.forRoot({ load: [appConfig, databaseConfig, temporalConfig] }),
  ],
  providers: [
    ActivitiesService,
    LogGeneratorActivity,
    NotifyConfigActivity,
    ErrorCsvGenerationActivity,
    ConfigurationDataCsvGenerationActivity,
    StateDataCsvGenerationActivity,
    ConfigService,
    OperationErrorService,
    PrometheusService,
    PrometheusClientService,
    PrometheusDataProcessorService,
    SystemInventoryCsvGenerationActivity,
    ConfigService,
    OperationErrorService,
    SystemInventoryProcessorService,
    PrometheusService,
    PrometheusClientService,
    ZipHandlerService,
  ],
  exports: [
    ActivitiesService,
    LogGeneratorActivity,
    NotifyConfigActivity,
    ErrorCsvGenerationActivity,
    OperationErrorService,
  ],
})
export class ActivitiesModule {}
