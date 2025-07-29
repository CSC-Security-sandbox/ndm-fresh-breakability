import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";
import { SuccessEmailType, CreateConfigurationEmailContent,
  ErrorRemedyEmailContent, MigrateJobEmailContent,
  JobStatusUpdateEmailContent, ConfigUpdateEmailContent,
  WorkerUsesEmailContent
} from "src/constants/email-content.enum";

export class EmailDto {
  body: any;
}

export class SuccessEventEmailDto {
  @ApiProperty({ enum: SuccessEmailType, enumName: 'SuccessEmailType', description: 'Type of success email' })
  @IsString({ message: 'successEmailType must be a string' })
  successEmailType: SuccessEmailType;

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