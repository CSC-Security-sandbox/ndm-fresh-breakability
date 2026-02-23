import { ApiProperty } from '@nestjs/swagger';
import { plainToClass, Type } from 'class-transformer';
import { IsString, IsUUID, IsNumber, IsOptional, IsObject, IsBoolean, IsDate, } from 'class-validator';
import { Protocol } from 'src/constants/enums';

class FileServerConfigDto {
  @ApiProperty()
  @IsString()
  configName: string;
}

class FileServerDto {
  @ApiProperty()
  @IsString()
  protocol: Protocol;

  @ApiProperty()
  @IsString()
  path: string;
  
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  directoryPath?: string; 

  @ApiProperty()
  @IsString()
  serverName: string;

  @ApiProperty()
  @IsString()
  configName: string;
}

class JobConfigDto {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty()
  @IsString()
  jobType: string;

  @ApiProperty()
  @IsObject()
  sourceServer: FileServerDto;

  @ApiProperty({ nullable: true })
  @IsOptional()
  @IsObject()
  destinationServer: FileServerDto | null;
}

class JobOptionsDto {
  @ApiProperty()
  @IsBoolean()
  preserveAccessTime: boolean;

  @ApiProperty()
  @IsBoolean()
  preservePermissions: boolean;

  @ApiProperty({ nullable: true, required: false })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  excludeOlderThan?: Date;

  @ApiProperty({ nullable: true, required: false })
  @IsOptional()
  @IsString()
  excludeFilePatterns?: string;

  @ApiProperty({ nullable: true, required: false })
  @IsOptional()
  @IsString()
  skipFile?: string;

  @ApiProperty({ nullable: true, required: false })
  @IsOptional()
  @IsUUID()
  identityMappingId?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  shouldScanADS?: boolean;
}

export class TaskDto {
  @ApiProperty()
  @IsString()
  completed: number = 0;

  @ApiProperty()
  @IsString()
  pending: number = 0;

  @ApiProperty()
  @IsString()
  errored: number = 0;

  @ApiProperty()
  @IsString()
  running: number = 0;
}

export class JobRunStats {
  @ApiProperty()
  @IsNumber()
  fileCount?: string = "0";

  @ApiProperty()
  @IsString()
  totalSize?: string = "0";

  @ApiProperty()
  @IsString()
  directories?: string = "0";
}

export class JobReportResponseDto {
  @ApiProperty()
  value: string | number;

  @ApiProperty()
  @IsString()
  category: string;

  @ApiProperty()
  @IsString()
  sub_category: Date;
}

export class JobRunDetailsResponseDto {
  @ApiProperty()
  @IsOptional()
  lastRefreshed?: Date;
  @ApiProperty()
  @IsUUID()
  id: string;

  @ApiProperty()
  @IsString()
  status: string;

  @ApiProperty()
  @IsString()
  startTime: Date;

  @ApiProperty()
  @IsString()
  endTime: Date;

  @ApiProperty()
  @IsNumber()
  worker: number;

  @ApiProperty()
  @IsObject()
  jobConfig: JobConfigDto;

  @ApiProperty()
  @IsObject()
  jobOptions: JobOptionsDto;
  
  @ApiProperty()
  @IsObject()
  @IsOptional()
  discovery?: JobRunStats;

  @ApiProperty()
  @IsObject()
  @IsOptional()
  migrate?: JobRunStats;

  @ApiProperty()
  @IsObject()
  @IsOptional()
  cutOver?: JobRunStats;

  @ApiProperty()
  @IsObject()
  task?: TaskDto;
}

export function serializeJobRunDetailsResponse(plainObject: any): JobRunDetailsResponseDto {
  return plainToClass(JobRunDetailsResponseDto, plainObject);
}