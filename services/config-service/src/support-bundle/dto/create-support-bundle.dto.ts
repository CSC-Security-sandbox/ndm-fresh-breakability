import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsArray,
  IsDateString,
} from 'class-validator';

export class CreateSupportBundleDTO {
  @ApiProperty({ description: 'Start date', type: String, format: 'date-time' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'End date', type: String, format: 'date-time' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({
    description: 'List of other metrics to include',
    type: [String],
    example: ['state data', 'inventory data'],
  })
  @IsOptional()
  @IsArray()
  otherMetrics?: string[];
}
