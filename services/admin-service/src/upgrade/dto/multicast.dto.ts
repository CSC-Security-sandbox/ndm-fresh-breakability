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
 * Per-worker status in the multicast status response
 */
export class WorkerUpgradeStatusDto {
  @ApiProperty({ description: 'Worker ID' })
  workerId: string;

  @ApiProperty({ description: 'Worker name', required: false })
  workerName?: string;

  @ApiProperty({ description: 'Worker IP address', required: false })
  ipAddress?: string;

  @ApiProperty({ description: 'Platform', enum: ['linux', 'windows'], required: false })
  platform?: string;

  @ApiProperty({ description: 'Current running version', required: false })
  currentVersion?: string;

  @ApiProperty({ description: 'Version being staged', required: false })
  stagedVersion?: string;

  @ApiProperty({ description: 'Bundle distribution status', enum: ['IDLE', 'IN_PROGRESS', 'COMPLETED', 'FAILED'] })
  bundleStatus: string;

  @ApiProperty({ description: 'Whether worker is reporting health checks', required: false })
  healthy?: boolean;

  @ApiProperty({ description: 'Last health check timestamp', required: false })
  lastSeen?: string;
}

/**
 * Response DTO for GET /api/v1/upgrade/multicast/:workflowId
 * Combines Temporal workflow status with per-worker DB status
 */
export class MulticastStatusDto {
  @ApiProperty({ description: 'Workflow ID' })
  workflowId: string;

  @ApiProperty({ description: 'Temporal workflow status', enum: ['RUNNING', 'COMPLETED', 'FAILED', 'TERMINATED', 'TIMED_OUT'] })
  workflowStatus: string;

  @ApiProperty({ description: 'Aggregate summary' })
  summary: {
    total: number;
    completed: number;
    inProgress: number;
    failed: number;
    idle: number;
  };

  @ApiProperty({ description: 'Per-worker status', type: [WorkerUpgradeStatusDto] })
  workers: WorkerUpgradeStatusDto[];

  @ApiProperty({ description: 'Temporal workflow result (when completed)', required: false })
  workflowResult?: any;
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
