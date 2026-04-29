import {
  Entity,
  Column,
  PrimaryColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Base } from './base.entity';
import { UpgradeBundleStatus, UpgradeExecutionStatus } from '../constants/worker.enums';
import { WorkerStatsEntity } from './worker-stats.entity';

@Entity({ name: 'worker' })
export class WorkerEntity extends Base {
  @ApiProperty({ description: 'workerId' })
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  workerId: string;

  @ApiProperty({ description: 'projectId' })
  @Column({ type: 'uuid', nullable: false, name: 'project_id' })
  projectId: string;

  @ApiProperty({ description: 'workerName' })
  @Column({ type: 'varchar', length: 255, nullable: false, name: 'worker_name' })
  workerName: string;

  @ApiProperty({ description: 'ipAddress' })
  @Column({ type: 'varchar', length: 255, nullable: false, name: 'ip_address' })
  ipAddress: string;

  @ApiProperty({ description: 'status' })
  @Column({ type: 'varchar', name: 'status' })
  status: string;

  @ApiProperty({ description: 'platform' })
  @Column({ type: 'varchar', name: 'platform', nullable: true })
  platform: string;

  @ApiProperty({ description: 'workerVersion' })
  @Column({ type: 'varchar', length: 100, name: 'worker_version', nullable: true })
  workerVersion: string;

  @Column({ type: 'varchar', length: 100, name: 'staged_version', nullable: true })
  stagedVersion: string;

  @Column({ type: 'varchar', nullable: true, name: 'current_multicast_workflow_id' })
  currentMulticastWorkflowId: string;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'upgrade_bundle_staged',
    default: UpgradeBundleStatus.IDLE,
  })
  upgradeBundleStaged: UpgradeBundleStatus;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'upgrade_execution_status',
    default: UpgradeExecutionStatus.IDLE,
  })
  upgradeExecutionStatus: UpgradeExecutionStatus;

  @Column({ type: 'timestamp', name: 'upgrade_completed_at', nullable: true })
  upgradeCompletedAt: Date;

  @OneToOne(() => WorkerStatsEntity, (stats) => stats.worker, { cascade: true })
  @JoinColumn({ name: 'id', referencedColumnName: 'workerId' })
  stats: WorkerStatsEntity;
}
