import { ApiProperty } from "@nestjs/swagger";
import { Protocol } from "src/constants/enums";
import { Type } from "class-transformer";
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
} from "class-validator";

export class WorkFlowOptions {
  @ApiProperty({
    description: "Timeout for workflow execution",
    default: "60s",
    required: false,
  })
  @IsOptional()
  @IsString()
  workflowExecutionTimeout: string = "60s";

  @ApiProperty({
    description: "Timeout for workflow task",
    default: "30s",
    required: false,
  })
  @IsOptional()
  @IsString()
  workflowTaskTimeout: string = "30s";

  @ApiProperty({
    description: "Timeout for workflow run",
    default: "30s",
    required: false,
  })
  @IsOptional()
  @IsString()
  workflowRunTimeout: string = "30s";

  @ApiProperty({
    description: "Delay before starting the workflow",
    default: "10s",
    required: false,
  })
  @IsOptional()
  @IsString()
  startDelay: string = "1s";
}

export class JobConfigDiscoverBulk {
  @ApiProperty({
    description: "Exclude files older than this date",
    required: false,
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  excludeOlderThan?: Date;

  @ApiProperty({ description: "Patterns of files to exclude", required: false })
  @IsOptional()
  @IsString()
  excludeFilePatterns?: string;

  @ApiProperty({ description: "Preserve access time flag", example: false })
  @IsBoolean()
  preserveAccessTime: boolean;

  @ApiProperty({ description: "Scan Alternate Data Streams flag (Windows/SMB only)", example: false, required: false })
  @IsOptional()
  @IsBoolean()
  shouldScanADS?: boolean;

  @ApiProperty({
    description: "Job schedule configuration",
    example: new Date().toISOString(),
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  firstRunAt: Date;

  @ApiProperty({
    description: "List of UUIDs of the source path configurations",
  })
  @IsArray()
  @ArrayUnique()
  @IsUUID("all", { each: true })
  sourcePathIds: string[];

  @ApiProperty({ description: "UUID of createdBy", required: false })
  @IsOptional()
  @IsUUID()
  createdBy?: string;

  @ApiProperty({
    type: WorkFlowOptions,
    description: "Workflow options",
    required: false,
  })
  @IsObject()
  @ValidateNested()
  @Type(() => WorkFlowOptions)
  @IsOptional()
  options: WorkFlowOptions = new WorkFlowOptions();
}

export class UpdateDiscoveryConfigDto {
  @ApiProperty({ 
    description: 'Patterns of files to exclude', 
    required: false,
    example: '*.log\n*.tmp\n/temp/*'
  })
  @IsOptional()
  @IsString()
  excludeFilePatterns?: string;

  @ApiProperty({ 
    description: 'Job schedule configuration', 
    example: new Date().toISOString(),
    required: false
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  firstRunAt?: Date;

  @ApiProperty({ 
    description: 'Scan Alternate Data Streams flag (Windows/SMB only)', 
    example: 'Enabled',
    required: false
  })
  @IsOptional()
  @IsString()
  shouldScanADS?: string;
}

export class UpdateMigrationConfigDto {
  @ApiProperty({ 
    description: 'Patterns of files to exclude', 
    required: false,
    example: '*.log\n*.tmp\n/temp/*'
  })
  @IsOptional()
  @IsString()
  excludeFilePatterns?: string;

  @ApiProperty({ 
    description: 'Job schedule configuration', 
    example: new Date().toISOString(),
    required: false
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  firstRunAt?: Date;

  @ApiProperty({ 
    description: 'Exclude files older than this date', 
    required: false
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  excludeOlderThan?: Date;

  @ApiProperty({ 
    description: 'Preserve access time flag', 
    example: false,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  preserveAccessTime?: boolean;

  @ApiProperty({ 
    description: 'Skip file configuration', 
    required: false,
    example: '15-Mins'
  })
  @IsOptional()
  @IsString()
  skipFile?: string;

  @ApiProperty({ 
    description: 'Incremental job schedule configuration', 
    required: false
  })
  @IsOptional()
  @IsString()
  futureScheduleAt?: string;

  @ApiProperty({ 
    description: 'Base64 encoded SID mapping file content', 
    required: false 
  })
  @IsOptional()
  @IsString()
  sidMapping?: string;

  @ApiProperty({ 
    description: 'Base64 encoded GID mapping file content', 
    required: false 
  })
  @IsOptional()
  @IsString()  
  gidMapping?: string;
}

export class MigrateJobConfigOptions {
  @ApiProperty({
    description: "Exclude files older than this date",
    required: false,
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  excludeOlderThan?: Date;

  @ApiProperty({ description: "Patterns of files to exclude", required: false })
  @IsOptional()
  @IsString()
  excludeFilePatterns?: string;

  @ApiProperty({ description: "Preserve access time flag", example: false })
  @IsBoolean()
  preserveAccessTime: boolean;
}

export class MigrateConfig {
  @ApiProperty({ description: "UUID of the source path configurations" })
  @IsUUID()
  sourcePathId: string;

  @ApiProperty({ description: "UUIDs of the destination file servers" })
  @IsArray()
  @ArrayUnique()
  @IsUUID("all", { each: true })
  destinationPathId: string[];
}

export class JobConfigMigrateBulk {
  @ApiProperty({
    description: "Timestamp for 1st migrate run",
    example: new Date().toISOString(),
  })
  @Type(() => Date)
  @IsDate()
  firstRunAt: Date;

  @ApiProperty({
    description: "Future run schedule (incremental sync config)",
    required: false,
  })
  @IsString()
  futureRunSchedule: string;

  @ApiProperty({
    description: "Details of all the bulk migrate configs",
    isArray: true,
    type: MigrateConfig,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MigrateConfig)
  migrateConfigs: MigrateConfig[];

  @ApiProperty({
    type: "string",
    format: "binary",
    description: "BLOB data for SID mappings (Excel file content)",
  })
  @IsOptional()
  sidMapping: Buffer;

  @ApiProperty({
    type: "string",
    format: "binary",
    description: "BLOB data for GID mappings (Excel file content)",
  })
  @IsOptional()
  gidMapping: Buffer;

  @ApiProperty({
    type: MigrateJobConfigOptions,
    description: "Migrate job options",
  })
  options: MigrateJobConfigOptions;
}

export class JobConfigCutoverBulk {
  @ApiProperty({
    description: "Details of all the bulk cutover configs",
    isArray: true,
    type: MigrateConfig,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MigrateConfig)
  cutoverConfig: MigrateConfig[];
}

export class Options {
  @ApiProperty({
    description: "Timeout for workflow execution",
    default: "5m",
    required: false,
  })
  @IsOptional()
  @IsString()
  workflowExecutionTimeout: string = "5m";

  @ApiProperty({
    description: "Timeout for workflow task",
    default: "5m",
    required: false,
  })
  @IsOptional()
  @IsString()
  workflowTaskTimeout: string = "5m";

  @ApiProperty({
    description: "Timeout for workflow run",
    default: "5m",
    required: false,
  })
  @IsOptional()
  @IsString()
  workflowRunTimeout: string = "5m";

  @ApiProperty({
    description: "Delay before starting the workflow",
    default: "1s",
    required: false,
  })
  @IsOptional()
  @IsString()
  startDelay: string = "1s";
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

  @ApiProperty({
    type: Options,
    description: "Workflow options",
    required: false,
  })
  @IsObject()
  @ValidateNested()
  @Type(() => Options)
  @IsOptional()
  options: Options = new Options();
}
