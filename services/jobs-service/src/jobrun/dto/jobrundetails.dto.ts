import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { JobRunStatus } from 'src/constants/enums';

export class JobRunDetailsPageDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination',
    example: '1',
  })
  @IsOptional()
  @IsNumberString()
  page?: string;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: '10',
  })
  @IsOptional()
  @IsNumberString()
  limit?: string;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    example: 'createdAt',
    enum: ['createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
  })
  @IsOptional()
  @IsIn(['createdAt', 'createdBy', 'updatedAt', 'updatedBy'])
  sort?: string;

  @ApiPropertyOptional({
    description: 'Order of sorting',
    example: 'asc',
    enum: ['asc', 'desc'],
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'id of Job Run' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({ description: 'Status of job Run', enum: JobRunStatus })
  @IsOptional()
  @IsIn(Object.values(JobRunStatus))
  status?: JobRunStatus;

  @ApiPropertyOptional({ description: 'Start Time' })
  @IsOptional()
  @IsDateString()
  startTime?: Date;

  @ApiPropertyOptional({ description: 'End Time' })
  @IsOptional()
  @IsDateString()
  endTime?: Date;
}
