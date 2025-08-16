import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class WorkerConfiguration {
  workerId: string;
  configName: string;
  taskQueueId: string;
  dynamicTaskQueue: boolean;
}
export class Options {
  @ApiProperty({
    description: "Timeout for workflow execution",
    default: "60s",
    required: false,
  })
  @IsOptional()
  @IsString()
  workflowExecutionTimeout: string = "60s";

  @ApiProperty({
    description: "Timeout for workflow task",
    default: "30s",
    required: false,
  })
  @IsOptional()
  @IsString()
  workflowTaskTimeout: string = "30s";

  @ApiProperty({
    description: "Timeout for workflow run",
    default: "30s",
    required: false,
  })
  @IsOptional()
  @IsString()
  workflowRunTimeout: string = "30s";

  @ApiProperty({
    description: "Delay before starting the workflow",
    default: "10s",
    required: false,
  })
  @IsOptional()
  @IsString()
  startDelay: string = "1s";
}
