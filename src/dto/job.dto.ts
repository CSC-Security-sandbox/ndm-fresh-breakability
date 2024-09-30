import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsNumber,
  IsUUID,
} from 'class-validator';

export class JobDTO {
  @ApiProperty({ description: 'UUID of the source configuration' })
  @IsUUID()
  @IsString()
  source_config_id: string;

  @ApiProperty({ description: 'UUID of the target configuration' })
  @IsUUID()
  @IsString()
  target_config_id: string;

  @ApiProperty({ description: 'File filters, e.g. .txt' })
  @IsString()
  file_filters: string;

  @ApiProperty({ description: 'Flag for recursive file search' })
  @IsBoolean()
  recursive_flag: boolean;

  @ApiProperty({ description: 'Timeout for the job in seconds' })
  @IsNumber()
  timeout: number;

  @ApiProperty({ description: 'Number of retries allowed' })
  @IsNumber()
  retries: number;

  @ApiProperty({ description: 'Network throttling rate' })
  @IsNumber()
  network_throtlling: number;

  @ApiProperty({ description: 'Flag for overwrite policy' })
  @IsBoolean()
  overwrite_policy: boolean;

  @ApiProperty({ description: 'File permissions, e.g. 755' })
  @IsString()
  file_permissions: string;

  @ApiProperty({ description: 'Cron settings enabled/disabled' })
  @IsBoolean()
  cron_settings: boolean;

  @ApiProperty({ description: 'Algorithms for integration' })
  @IsString()
  integrative_algorithms: string;

  @ApiProperty({ description: 'Notification settings' })
  @IsString()
  notification: string;

  @ApiProperty({ description: 'Chunk size for file transfer' })
  @IsNumber()
  chunk_size: number;
}
