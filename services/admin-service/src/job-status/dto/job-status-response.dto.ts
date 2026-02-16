import { ApiProperty } from '@nestjs/swagger';

export class RunningJobDto {
  @ApiProperty({ description: 'Job run ID' })
  jobRunId: string;

  @ApiProperty({ description: 'Job config ID' })
  jobConfigId: string;

  @ApiProperty({ description: 'Type of the job (e.g., MIGRATE, DISCOVER)' })
  jobType: string;

  @ApiProperty({ description: 'Current status of the job run' })
  status: string;

  @ApiProperty({ description: 'Sub-status of the job run', nullable: true })
  subStatus: string | null;

  @ApiProperty({ description: 'Start time of the job run' })
  startTime: Date;

  @ApiProperty({ description: 'Iteration number of the job run' })
  iterationNumber: number;

  @ApiProperty({ description: 'Type of job run (REGULAR or RETRY)' })
  jobRunType: string;
}

export class ScheduledJobDto {
  @ApiProperty({ description: 'Job config ID' })
  jobConfigId: string;

  @ApiProperty({ description: 'Type of the job (e.g., MIGRATE, DISCOVER)' })
  jobType: string;

  @ApiProperty({ description: 'Status of the job config' })
  status: string;

  @ApiProperty({ description: 'Scheduled first run time', nullable: true })
  firstRunAt: Date | null;

  @ApiProperty({
    description: 'Incremental sync schedule expression',
    nullable: true,
  })
  futureScheduleAt: string | null;

  @ApiProperty({ description: 'When the job config was created' })
  createdAt: Date;
}

export class JobStatusResponseDto {
  @ApiProperty({
    description: 'List of currently running migration jobs',
    type: [RunningJobDto],
  })
  runningJobs: RunningJobDto[];

  @ApiProperty({
    description: 'Total count of running jobs',
  })
  runningJobsCount: number;

  @ApiProperty({
    description: 'List of active scheduled jobs',
    type: [ScheduledJobDto],
  })
  scheduledJobs: ScheduledJobDto[];

  @ApiProperty({
    description: 'Total count of active scheduled jobs',
  })
  scheduledJobsCount: number;
}
