import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class BulkJobIdsDto {
  @ApiProperty({
    description: 'Array of job config UUIDs to act on',
    type: [String],
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  ids: string[];
}

export class StoppedJobsReportDto {
  @ApiProperty({
    description: 'Array of stopped job run UUIDs',
    type: [String],
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  jobRunIds: string[];

  @ApiProperty({
    description: 'Array of deactivated job config UUIDs',
    type: [String],
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  jobConfigIds: string[];
}
