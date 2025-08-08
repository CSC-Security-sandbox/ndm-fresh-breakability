import { Module } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { ConfigModule } from '@nestjs/config';
import temporalConfig from 'src/config/temporal.config';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [
    LoggerModule.forRoot(),
    ConfigModule.forRoot({ load: [temporalConfig] }),
  ],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule { }
