import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";


export enum SuccessEmailType {
  CREATE_CONFIGURATION = 'create_configuration',
  ERROR_REMEDY = 'error_remedy',
  JOB_CREATION = 'job_creation',
  JOB_UPDATE = 'job_update',
  UPDATE_CONFIGURATION = 'update_configuration',
  WORKER_USAGE = 'worker_usage',
}

export type CreateConfigurationEmailContent = {
  configName: string;
  fileServers: {
    host: string;
    serverType: string;
    protocol: string;
    workerNames: string[];
  }[];
};

export type ErrorRemedyEmailContent = {
  jobType: string;
  jobRunId: string;
  sourceHost: string;
  sourcePath: string;
  targetHost: string;
  targetPath: string;
  errorRemedies: {
    errorCode: string;
    description: string;
    resolutionSteps: string;
    referenceCommands?: string;
  }[];
};

export type MigrateJobEmailContent = {
  savedJobConfigs: {
    id: string;
    sourcePath: { volumePath: string };
    targetPath: { volumePath: string };
    jobType: string;
  }[];
};

export type JobStatusUpdateEmailContent = {
  jobType: string;
  jobAction: string;
  sourcePath: {
    volumePath: string;
    fileServer: { host: string };
  };
  targetPath: {
    volumePath: string;
    fileServer: { host: string };
  };
};

export type ConfigUpdateEmailContent = {
  configName: string;
  removedWorkers: {
    workerName: string;
  }[];
  addedWorkers: {
    workerName: string;
  }[];
};

export type WorkerUsesEmailContent = {
  id: string;
  ip: string;
};

export class SuccessEventEmailDto {
  @ApiProperty({ enum: SuccessEmailType, enumName: 'SuccessEmailType', description: 'Type of success email' })
  @IsString({ message: 'successEmailType must be a string' })
  successEmailType: SuccessEmailType;

  @ApiProperty({
    description: 'Project ID associated with the email event'
  })
  @IsString({ message: 'projectId must be a string' })
  projectId?: string;

  @ApiProperty({
    description: 'Trace ID for request tracking'
  })
  @IsString({ message: 'traceId must be a string' })
  traceId?: string;

  @ApiProperty({
    description: 'Content for create configuration email',
    required: false,
  })
  createConfig?: CreateConfigurationEmailContent;

  @ApiProperty({
    description: 'Content for error remedy email',
    required: false,
  })
  errorRemedy?: ErrorRemedyEmailContent;

  @ApiProperty({
    description: 'Content for migrate job email',
    required: false,
  })
  migrateJob?: MigrateJobEmailContent;

  @ApiProperty({
    description: 'Content for job status update email',
    required: false,
  })
  jobStatusUpdate?: JobStatusUpdateEmailContent;

  @ApiProperty({
    description: 'Content for configuration update email',
    required: false,
  })
  configUpdate?: ConfigUpdateEmailContent;

  @ApiProperty({
    description: 'Content for worker uses email',
    required: false,
  })
  workerUsage?: WorkerUsesEmailContent;
};