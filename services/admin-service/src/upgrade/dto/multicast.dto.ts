import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsOptional, ArrayNotEmpty } from 'class-validator';

/**
 * DTO for POST /api/v1/upgrade/multicast
 * Triggers binary distribution to workers
 * 
 * Note: Platform is NOT needed in the payload.
 * Workers detect their own platform via process.platform at runtime.
 */
export class MulticastRequestDto {
  @ApiProperty({
    description: 'Worker IDs to distribute binaries to',
    example: ['53d5f0cd-bdf8-4e59-86d2-2b4443670586', '17d5dd44-1639-43d0-8381-d9f68189c17e'],
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  workerIds: string[];

  @ApiProperty({
    description: 'Target version to distribute',
    example: '2026.02.08184701-nightly',
  })
  @IsString()
  version: string;
}

/**
 * Response DTO for multicast API
 */
export class MulticastResponseDto {
  @ApiProperty({
    description: 'Workflow ID for tracking',
    example: 'BinaryMulticast-abc123',
  })
  workflowId: string;

  @ApiProperty({
    description: 'Status of the multicast operation',
    example: 'started',
    enum: ['started', 'error'],
  })
  status: 'started' | 'error';

  @ApiProperty({
    description: 'Optional message',
    example: 'Multicast workflow started for 5 workers',
    required: false,
  })
  @IsOptional()
  message?: string;
}

/**
 * DTO for multicast status response
 */
export class MulticastStatusDto {
  @ApiProperty({
    description: 'Workflow ID',
  })
  workflowId: string;

  @ApiProperty({
    description: 'Overall status',
    enum: ['running', 'completed', 'partial', 'failed'],
  })
  status: 'running' | 'completed' | 'partial' | 'failed';

  @ApiProperty({
    description: 'Summary of results',
  })
  summary: {
    total: number;
    success: number;
    failed: number;
    pending: number;
  };

  @ApiProperty({
    description: 'Per-worker results',
    type: 'array',
    required: false,
  })
  results?: WorkerResultDto[];
}

/**
 * Per-worker result
 */
export class WorkerResultDto {
  @ApiProperty({ description: 'Worker ID' })
  workerId: string;

  @ApiProperty({ description: 'Platform', enum: ['linux', 'windows'] })
  platform: 'linux' | 'windows';

  @ApiProperty({ description: 'Status', enum: ['success', 'failed', 'pending'] })
  status: 'success' | 'failed' | 'pending';

  @ApiProperty({ description: 'Message', required: false })
  message?: string;

  @ApiProperty({ description: 'Timestamp', required: false })
  timestamp?: string;
}
