import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsArray,
  IsUUID,
  IsDateString,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ProjectWorkerMapDto {
  @ApiPropertyOptional({
    description: 'Project ID',
    type: String,
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({
    description: 'List of Worker IDs',
    type: [String],
    format: 'uuid',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  workerIds?: string[];
}

export class CreateSupportBundleDTO {
  @ApiProperty({ description: 'User ID', type: String, format: 'uuid' })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'Start date', type: String, format: 'date-time' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'End date', type: String, format: 'date-time' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({
    description: 'Mapping of projects to their worker IDs',
    type: [ProjectWorkerMapDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProjectWorkerMapDto)
  projectWorkerMap?: ProjectWorkerMapDto[];

  @ApiPropertyOptional({
    description: 'List of other metrics to include',
    type: [String],
    example: ['state data', 'inventory data'],
  })
  @IsOptional()
  @IsArray()
  otherMetrics?: string[];
}
