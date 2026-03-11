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
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'SourceNotInDestination', async: false })
export class SourceNotInDestinationConstraint implements ValidatorConstraintInterface {
  validate(destinationPathIds: string[], args: ValidationArguments) {
    const migrateConfig = args.object as MigrateConfig;
    if (
      !migrateConfig ||
      !migrateConfig.sourcePathId ||
      !Array.isArray(destinationPathIds)
    ) {
      return false;
    }
    return !destinationPathIds.includes(migrateConfig.sourcePathId);
  }

  defaultMessage(args: ValidationArguments) {
    return `sourcePathId must not be present in destinationPathId[]`;
  }
}

export class MigrateJobConfigOptions {
  @ApiProperty({
    description: 'Exclude files older than this date',
    required: false,
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  excludeOlderThan?: Date;

  @ApiProperty({ description: 'Patterns of files to exclude', required: false })
  @IsOptional()
  @IsString()
  excludeFilePatterns?: string;

  @ApiProperty({ description: 'Preserve access time flag', example: false })
  @IsBoolean()
  preserveAccessTime: boolean;

  @ApiProperty({ description: 'Preserve permissions flag', example: true })
  @IsBoolean()
  preservePermissions: boolean;

  @ApiProperty({ description: 'Skip Files time duration', example: '1h' })
  @IsString()
  skipFile: string;
}

export class MigrateConfig {
  @ApiProperty({ description: 'UUID of the source path configurations' })
  @IsUUID()
  sourcePathId: string;

  @ApiProperty({ description: 'UUIDs of the destination file servers' })
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  @Validate(SourceNotInDestinationConstraint)
  destinationPathId: string[];

  @ApiProperty({
    description: 'Directory path on source volume',
    required: false,
  })
  @IsOptional()
  @IsString()
  sourceDirectoryPath?: string;

  @ApiProperty({
    description: 'Directory path on destination volume',
    required: false,
  })
  @IsOptional()
  @IsString()
  destinationDirectoryPath?: string;
}

export class BulkMigrateJobConfig {
  @ApiProperty({
    description: 'Timestamp for 1st migrate run',
    example: new Date().toISOString(),
  })
  @Type(() => Date)
  @IsDate()
  @IsOptional()
  firstRunAt: Date;

  @ApiProperty({
    description: 'Future run schedule (incremental sync config)',
    required: false,
  })
  @IsString()
  futureRunSchedule: string;

  @ApiProperty({
    description: 'Details of all the bulk migrate configs',
    isArray: true,
    type: MigrateConfig,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MigrateConfig)
  migrateConfigs: MigrateConfig[];

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'BLOB data for SID mappings (Excel file content)',
  })
  @IsOptional()
  sidMapping: string | boolean;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'BLOB data for GID mappings (Excel file content)',
  })
  @IsOptional()
  gidMapping: string | boolean;

  @ApiProperty({
    type: MigrateJobConfigOptions,
    description: 'Migrate job options',
  })
  @ValidateNested({ each: true })
  @Type(() => MigrateJobConfigOptions)
  options: MigrateJobConfigOptions;
}
