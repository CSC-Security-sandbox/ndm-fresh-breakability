import { Entity, Column, PrimaryColumn, OneToOne, JoinColumn } from 'typeorm';
import { UpgradeBundleStatus } from '../constants/worker.enums';
import { WorkerStatsEntity } from './worker-stats.entity';

/**
 * Lightweight projection of the worker table for admin-service.
 * Only maps columns needed for upgrade operations.
 */
@Entity({ name: 'worker' })
export class WorkerEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  workerId: string;

  @Column({ type: 'varchar', length: 255, name: 'worker_name', nullable: true })
  workerName: string;

  @Column({ type: 'varchar', length: 255, name: 'ip_address', nullable: true })
  ipAddress: string;

  @Column({ type: 'varchar', name: 'status' })
  status: string;

  @Column({ type: 'varchar', name: 'platform', nullable: true })
  platform: string;

  @Column({ type: 'varchar', length: 100, name: 'staged_version', nullable: true })
  stagedVersion: string;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'upgrade_bundle_staged',
    default: UpgradeBundleStatus.IDLE,
  })
  upgradeBundleStaged: UpgradeBundleStatus;

  @Column({ type: 'varchar', length: 100, name: 'worker_version', nullable: true })
  workerVersion: string;

  @OneToOne(() => WorkerStatsEntity)
  @JoinColumn({ name: 'id', referencedColumnName: 'workerId' })
  stats: WorkerStatsEntity;
}
