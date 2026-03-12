import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, IsOptional } from 'class-validator';

export class SystemStats {
  @ApiProperty({ description: 'CPU Usage in percentage' })
  @IsOptional()
  cpuUsage: string;
  @ApiProperty({ description: 'Memory Usage in percentage' })
  @IsOptional()
  memoryUsage: string;
  @ApiProperty({ description: 'Memory Limit in percentage' })
  @IsOptional()
  memoryLimit: string;
  @ApiProperty({ description: 'Disk Limit in percentage' })
  @IsOptional()
  diskLimit: string;
  @ApiProperty({ description: 'Disk Usage in percentage' })
  @IsOptional()
  diskUsage: string;
}

export class HealthcheckStats {
  @IsUUID()
  workerId: string;

  @ApiProperty({ description: 'Preserve access time flag', example: 'HEALTHY' })
  @IsString()
  healthStatus: string;

  @ApiProperty({ description: 'System Stats' })
  @IsOptional()
  systemStats?: SystemStats;
}
