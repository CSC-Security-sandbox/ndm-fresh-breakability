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
    ValidateNested,
    Validate,
    ValidatorConstraint, 
    ValidatorConstraintInterface, 
    ValidationArguments
} from 'class-validator';


@ValidatorConstraint({ name: 'UniqueSourcePathId', async: false })
export class UniqueSourcePathIdConstraint implements ValidatorConstraintInterface {
    validate(value: string, args: ValidationArguments) {
        const bulkConfig = args.object as BulkMigrateJobConfig;
        const sourceIds = bulkConfig.migrateConfigs.map(config => config.sourcePathId);
        return sourceIds.filter(id => id === value).length === 1;
    }

    defaultMessage(args: ValidationArguments) {
        return `sourcePathId must be unique across all migrateConfigs.`;
    }
}

@ValidatorConstraint({ name: 'UniqueDestinationPathId', async: false })
export class UniqueDestinationPathIdConstraint implements ValidatorConstraintInterface {
    validate(value: string[], args: ValidationArguments) {
        return new Set(value).size === value.length;
    }

    defaultMessage(args: ValidationArguments) {
        return `Each destinationPathId array must contain unique values.`;
    }
}

@ValidatorConstraint({ name: 'SourceNotInDestination', async: false })
export class SourceNotInDestinationConstraint implements ValidatorConstraintInterface {
    validate(value: string[], args: ValidationArguments) {
        const migrateConfig = args.object as MigrateConfig;
        return !value.includes(migrateConfig.sourcePathId);
    }

    defaultMessage(args: ValidationArguments) {
        return `sourcePathId cannot be in destinationPathId array.`;
    }
}

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
    @Validate(UniqueSourcePathIdConstraint)
    sourcePathId: string;
  
    @ApiProperty({ description: 'UUIDs of the destination file servers' }) 
    @IsArray()
    @ArrayUnique()
    @IsUUID('all', { each: true }) 
    @Validate(UniqueDestinationPathIdConstraint)
    @Validate(SourceNotInDestinationConstraint)
    destinationPathId: string[];
  }
  
  export class BulkMigrateJobConfig {
    @ApiProperty({ description: 'Timestamp for 1st migrate run', example: new Date().toISOString() })
    @Type(() => Date)
    @IsDate()
    firstRunAt: Date;
  
    @ApiProperty({ description: 'Future run schedule (incremental sync config)', required: false })
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