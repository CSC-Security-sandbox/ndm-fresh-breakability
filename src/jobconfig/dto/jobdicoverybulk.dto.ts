import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsDate,
    IsOptional,
    IsString,
    IsUUID
} from 'class-validator';

export class JobConfigDiscoverBulk {
  @ApiProperty({ description: 'Exclude files older than this date', required: false, })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  excludeOlderThan?: Date;

  @ApiProperty({ description: 'Patterns of files to exclude', required: false , })
  @IsOptional()
  @IsString()
  excludeFilePatterns?: string;

  @ApiProperty({ description: 'Preserve access time flag', example: false})
  @IsBoolean()
  preserveAccessTime: boolean;

  @ApiProperty({ description: 'Job schedule configuration', example: new Date().toISOString() })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  firstRunAt: Date;

  @ApiProperty({ description: 'List of UUIDs of the source path configurations' })
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true }) 
  sourcePathIds: string[];

  @ApiProperty({ description: 'UUID of createdBy', required: false })
  @IsOptional()
  @IsUUID()
  createdBy?: string;
}
