import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsArray,
  IsDateString,
  ValidateNested,
  IsUUID,
} from 'class-validator';

export class ProjectWorkerMapDTO {
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
  @ApiProperty({ description: 'Start date', type: String, format: 'date-time' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'End date', type: String, format: 'date-time' })
  @IsDateString()
  endDate: string;

  @ApiProperty({
    description: 'Mapping of projects to their worker IDs',
    type: [ProjectWorkerMapDTO],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProjectWorkerMapDTO)
  projectWorkerMap: ProjectWorkerMapDTO[];

  @ApiPropertyOptional({
    description: 'List of other metrics to include',
    type: [String],
    example: ['state data', 'inventory data'],
  })
  @IsOptional()
  @IsArray()
  otherMetrics?: string[];
}
