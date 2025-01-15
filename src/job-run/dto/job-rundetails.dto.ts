import { ApiProperty } from '@nestjs/swagger';
import { Exclude, plainToClass } from 'class-transformer';
import { IsString, IsUUID, IsBoolean, IsNumber, IsOptional, IsObject } from 'class-validator';

class FileServerConfigDto {
  @ApiProperty()
  @IsString()
  configName: string;
}

class FileServerDto {
  @ApiProperty()
  @IsString()
  protocol: string;

  @ApiProperty()
  @IsObject()
  config: FileServerConfigDto;
}

class PathDto {
  @ApiProperty()
  @IsString()
  volumePath: string;

  @ApiProperty()
  @IsObject()
  fileServer: FileServerDto;
}

class JobConfigDto {
  @ApiProperty()
  @IsString()
  jobType: string;

  @ApiProperty()
  @IsObject()
  sourcePath: PathDto;

  @ApiProperty({ nullable: true })
  @IsOptional()
  @IsObject()
  targetPath: PathDto | null;
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

export class JobRunDetailsResponseDto {
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

  @Exclude() 
  workerMap: any[];

  @ApiProperty({ type: []})
  worker: string[];

  @ApiProperty()
  @IsObject()
  jobConfig: JobConfigDto;

  @ApiProperty()
  @IsNumber()
  scannedFileCount?: string;

  @ApiProperty()
  @IsString()
  totalScannedSize?: string;

  @ApiProperty()
  @IsString()
  scannedDirectoriesCount?: string;

  @ApiProperty()
  @IsObject()
  task?: TaskDto;
}


export function serializeJobRunDetailsResponse(plainObject: any): JobRunDetailsResponseDto {
  return plainToClass(JobRunDetailsResponseDto, plainObject);
}