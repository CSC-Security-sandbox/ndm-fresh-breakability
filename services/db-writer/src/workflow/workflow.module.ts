import { Module } from "@nestjs/common";
import { WorkflowService } from "./workflow.service";
import {
  LoggerModule
} from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [LoggerModule.forRoot()],
  controllers: [],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
