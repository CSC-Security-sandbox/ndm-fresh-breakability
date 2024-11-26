import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID, IsString, IsOptional } from 'class-validator';
import { JobIdMappingType } from 'src/entities/jobmapping.entity';

export class AccessControlMapping {
  @ApiProperty({ description: 'UUID of the file server' })
  @IsUUID()
  @IsNotEmpty()
  job_config_id: string;

  @ApiProperty({ description: 'Type of mapping, e.g. GID' })
  @IsString()
  @IsNotEmpty()
  type: JobIdMappingType;

  @ApiProperty({ description: 'Source ID' })
  @IsString()
  @IsNotEmpty()
  source_id: string;

  @ApiProperty({ description: 'Destination ID' })
  @IsString()
  @IsNotEmpty()
  destination_id: string;
}

export class UpdateJobMappingDto {
  @ApiProperty({ description: 'UUID of the file server', required: false })
  @IsUUID()
  @IsOptional()
  job_config_id?: string;

  @ApiProperty({ description: 'Type of mapping, e.g. GID', required: false })
  @IsString()
  @IsOptional()
  type?: JobIdMappingType;

  @ApiProperty({ description: 'Source ID', required: false })
  @IsString()
  @IsOptional()
  source_id?: string;

  @ApiProperty({ description: 'Destination ID', required: false })
  @IsString()
  @IsOptional()
  destination_id?: string;
}
