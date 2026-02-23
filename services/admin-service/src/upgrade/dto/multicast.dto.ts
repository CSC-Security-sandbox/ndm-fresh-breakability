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
    description: 'Upgrade bundle ID',
    example: '53d5f0cd-bdf8-4e59-86d2-2b4443670586',
  })
  @IsString()
  bundleId: string;

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
    description: 'Upgrade bundle ID',
    example: '53d5f0cd-bdf8-4e59-86d2-2b4443670586',
  })
  @IsString()
  bundleId: string;

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

// =============================================================================
// Upgrade Execution DTOs
// =============================================================================

/**
 * DTO for POST /api/v1/upgrade/execute
 */
export class ExecuteUpgradeRequestDto {
  @ApiProperty({
    description: 'Upgrade bundle ID',
    example: '53d5f0cd-bdf8-4e59-86d2-2b4443670586',
  })
  @IsString()
  bundleId: string;

  @ApiProperty({
    description: 'Target version to execute upgrade for',
    example: '2026.02.10185052-nightly',
  })
  @IsString()
  version: string;
}

export class ExecuteUpgradeResponseDto {
  @ApiProperty({ description: 'Workflow ID for tracking' })
  workflowId: string;

  @ApiProperty({ description: 'Status', enum: ['started', 'error'] })
  status: 'started' | 'error';

  @ApiProperty({ description: 'Message', required: false })
  @IsOptional()
  message?: string;

  @ApiProperty({ description: 'Workers that were triggered', required: false })
  triggeredWorkers?: string[];
}

/**
 * DTO for POST /api/v1/upgrade/worker/execution-ack
 */
export class ExecutionAckDto {
  @ApiProperty({ description: 'Worker ID' })
  @IsString()
  workerId: string;

  @ApiProperty({ description: 'Upgrade bundle ID' })
  @IsString()
  bundleId: string;

  @ApiProperty({ description: 'Version the worker upgraded to' })
  @IsString()
  version: string;

  @ApiProperty({ description: 'Previous version before upgrade', required: false })
  @IsOptional()
  @IsString()
  previousVersion?: string;
}

/**
 * Per-worker execution status
 */
export class WorkerExecutionStatusDto {
  @ApiProperty({ description: 'Worker ID' })
  workerId: string;

  @ApiProperty({ description: 'Worker name', required: false })
  workerName?: string;

  @ApiProperty({ description: 'Worker IP', required: false })
  ipAddress?: string;

  @ApiProperty({ description: 'Platform', required: false })
  platform?: string;

  @ApiProperty({ description: 'Current running version', required: false })
  currentVersion?: string;

  @ApiProperty({ description: 'Execution status', enum: ['IDLE', 'IN_PROGRESS', 'COMPLETED', 'FAILED'] })
  executionStatus: string;

  @ApiProperty({ description: 'Upgrade completed timestamp', required: false })
  upgradeCompletedAt?: string;
}

/**
 * Response DTO for GET /api/v1/upgrade/execute/:workflowId
 */
export class ExecutionStatusDto {
  @ApiProperty({ description: 'Workflow ID' })
  workflowId: string;

  @ApiProperty({ description: 'Temporal workflow status' })
  workflowStatus: string;

  @ApiProperty({ description: 'True when all workers completed or 5-minute window has elapsed' })
  upgradeCompleted: boolean;

  @ApiProperty({ description: 'Overall upgrade outcome', enum: ['success', 'failure', 'in_progress'] })
  upgradeStatus: 'success' | 'failure' | 'in_progress';

  @ApiProperty({ description: 'Aggregate summary' })
  summary: {
    total: number;
    completed: number;
    inProgress: number;
    failed: number;
    notStarted: number;
  };

  @ApiProperty({ description: 'Workers that completed upgrade', type: [WorkerExecutionStatusDto] })
  completed: WorkerExecutionStatusDto[];

  @ApiProperty({ description: 'Workers that were triggered but have not completed (failed, in progress)', type: [WorkerExecutionStatusDto] })
  notCompleted: WorkerExecutionStatusDto[];

  @ApiProperty({ description: 'Workers that were never staged (not part of upgrade)', type: [WorkerExecutionStatusDto] })
  notStaged: WorkerExecutionStatusDto[];
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
