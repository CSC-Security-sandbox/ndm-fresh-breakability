import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

/**
 * DTO for POST /api/v1/upgrade/multicast
 * Triggers binary distribution to ALL active workers.
 * 
 * No workerIds needed - the service fetches all active workers from DB.
 * No platform needed - workers detect their own platform at runtime.
 */
export class MulticastRequestDto {
  @ApiProperty({
    description: 'Target version to distribute',
    example: '2026.02.08184701-nightly',
  })
  @IsString()
  version: string;
}

/**
 * DTO for POST /api/v1/upgrade/worker/ack
 * Worker calls this after successful binary download + verification
 */
export class WorkerAckDto {
  @ApiProperty({
    description: 'Worker ID that completed the download',
    example: '53d5f0cd-bdf8-4e59-86d2-2b4443670586',
  })
  @IsString()
  workerId: string;

  @ApiProperty({
    description: 'Version that was staged',
    example: '2026.02.08184701-nightly',
  })
  @IsString()
  version: string;

  @ApiProperty({
    description: 'Status of the download',
    example: 'success',
    enum: ['success', 'failed'],
  })
  @IsString()
  status: 'success' | 'failed';

  @ApiProperty({
    description: 'Optional error message if failed',
    required: false,
  })
  @IsOptional()
  @IsString()
  message?: string;
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
