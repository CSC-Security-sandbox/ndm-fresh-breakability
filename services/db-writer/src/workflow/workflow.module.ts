import { Module } from "@nestjs/common";
import { WorkflowService } from "./workflow.service";

@Module({
  controllers: [],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
