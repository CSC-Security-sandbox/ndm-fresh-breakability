import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WorkflowService } from './workflow.service';
import temporalConfig from '../config/temporal.config';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [
    LoggerModule,
    ConfigModule.forFeature(temporalConfig),
  ],
  providers: [WorkflowService, ConfigService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
