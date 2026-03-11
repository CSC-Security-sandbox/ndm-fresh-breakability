import { ArrayUnique, IsEnum, IsUUID, ArrayNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CutOverStatus } from 'src/constants/enums';

export enum JobRunActions {
  PAUSE = 'PAUSE',
  STOP = 'STOP',
  RESUME = 'RESUME',
}

export class JobRunActionsReq {
  @ApiProperty({
    description: 'The action to be performed on the job runs',
    enum: JobRunActions,
    example: JobRunActions.PAUSE,
  })
  @IsEnum(JobRunActions)
  action: JobRunActions;

  @ApiProperty({
    description:
      'An array of UUIDs representing job runs to be acted upon (at least one required)',
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440000'],
  })
  @ArrayNotEmpty()
  @IsUUID(4, { each: true })
  @ArrayUnique()
  jobRuns: string[];
}

export class ApprovalRequestDTO {
  @ApiProperty({
    description: 'Job run ID to be approve',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  jobRunId: string;

  @ApiProperty({
    description: 'The action to be performed on the job runs',
    enum: CutOverStatus,
    example: CutOverStatus.APPROVED,
  })
  @IsEnum(CutOverStatus)
  action: CutOverStatus;
}
