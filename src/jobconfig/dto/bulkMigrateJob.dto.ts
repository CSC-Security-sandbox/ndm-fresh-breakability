import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsDate,
    IsOptional,
    IsString,
    IsUUID,
    ValidateNested
} from 'class-validator';

export class MigrateJobConfigOptions {
    @ApiProperty({ description: 'Exclude files older than this date', required: false })
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
  }
  
  export class MigrateConfig {
    @ApiProperty({ description: 'UUID of the source path configurations' })
    @IsUUID()
    sourcePathId: string;
  
    @ApiProperty({ description: 'UUIDs of the destination file servers' }) 
    @IsArray()
    @ArrayUnique()
    @IsUUID('all', { each: true }) 
    destinationPathId: string[];
  }
  
  export class BulkMigrateJobConfig {
    @ApiProperty({ description: 'Timestamp for 1st migrate run', example: new Date().toISOString() })
    @Type(() => Date)
    @IsDate()
    firstRunAt: Date;
  
    @ApiProperty({ description: 'Future run schedule (incremental sync config)', required: false , })
    @IsString()
    futureRunSchedule: string;
  
    @ApiProperty({ 
      description: 'Details of all the bulk migrate configs', 
      isArray: true, 
      type: MigrateConfig 
    })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MigrateConfig)
    migrateConfigs: MigrateConfig[]
  
    @ApiProperty({
      type: 'string',
      format: 'binary',
      description: 'BLOB data for SID mappings (Excel file content)',
    })
    @IsOptional()
    sidMapping: Buffer;
  
    @ApiProperty({
      type: 'string',
      format: 'binary',
      description: 'BLOB data for GID mappings (Excel file content)',
    })
    @IsOptional()
    gidMapping: Buffer;
  
    @ApiProperty({
      type: MigrateJobConfigOptions,
      description: 'Migrate job options'
    })
    options: MigrateJobConfigOptions
  }





















  

  
 