import { ApiProperty } from '@nestjs/swagger';
import {  Protocol } from 'src/constants/enums';
import { Type } from 'class-transformer';
import {
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsDate,
    IsObject,
    IsOptional,
    IsString,
    IsUUID,
    ValidateNested,
    isUUID
} from 'class-validator';



export class WorkFlowOptions {
  @ApiProperty({ description: 'Timeout for workflow execution', default: '60s', required: false })
  @IsOptional()
  @IsString()
  workflowExecutionTimeout: string = '60s';

  @ApiProperty({ description: 'Timeout for workflow task', default: '30s', required: false })
  @IsOptional()
  @IsString()
  workflowTaskTimeout: string = '30s';

  @ApiProperty({ description: 'Timeout for workflow run', default: '30s', required: false })
  @IsOptional()
  @IsString()
  workflowRunTimeout: string = '30s';

  @ApiProperty({ description: 'Delay before starting the workflow', default: '10s', required: false })
  @IsOptional()
  @IsString()
  startDelay: string = '1s';
}

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

  @ApiProperty({ type: WorkFlowOptions, description: 'Workflow options', required: false })
  @IsObject()
  @ValidateNested()
  @Type(() => WorkFlowOptions)
  @IsOptional()
  options: WorkFlowOptions = new WorkFlowOptions();
}

class speedTests{
  @ApiProperty({ description: 'Read test' })
  @IsBoolean()
  readTest: boolean;
  @ApiProperty({ description: 'Write test' })
  @IsBoolean()
  writeTest: boolean;
  @ApiProperty({ description: 'packet loss test' })
  @IsBoolean()
  packetLossTest: boolean;

}

export class speedTestConfigOptions{
  @ApiProperty({ description: 'File serverr name' })
  @IsString()
  fileServer: string;

  @ApiProperty({ description: 'protocol for file server', required: false })
  @IsString()
  protocol?: Protocol;

  @ApiProperty({ description: 'List of workers' })
  @IsArray()
  workers: string[];

  @ApiProperty({ description: 'List of workers' })
  test: speedTests;
}



export class JobConfigSpeedTest {
  
  @ApiProperty({ description: 'Job schedule configuration', example: new Date().toISOString() })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  firstRunAt: Date;

  @ApiProperty({ 
    description: 'List of speedTest Fileserver config and tests to be performed ', 
    isArray: true, 
    type: speedTestConfigOptions 
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => speedTestConfigOptions)
  speedTests: speedTestConfigOptions[];



  @ApiProperty({ description: 'UUID of createdBy', required: false })
  @IsOptional()
  @IsUUID()
  createdBy?: string;
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
  sourcePathId: string;

  @ApiProperty({ description: 'UUIDs of the destination file servers' })
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true }) 
  destinationPathId: string[];

}

export class JobConfigMigrateBulk {
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

export class JobConfigCutoverBulk {
  @ApiProperty({ 
    description: 'Details of all the bulk cutover configs', 
    isArray: true, 
    type: MigrateConfig 
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MigrateConfig)
  cutoverConfig: MigrateConfig[]
}

export class JobConfigPrecheck {
  @ApiProperty({
    description: "Details of all the precheck configs",
    isArray: true,
    type: MigrateConfig,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MigrateConfig)
  migrateConfigs: MigrateConfig[];

  @ApiProperty({ description: "Preserve access time flag", example: false })
  @IsBoolean()
  preserveAccessTime: boolean;

}
