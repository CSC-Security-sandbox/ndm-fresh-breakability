/**
 * Lightweight WorkerEntity for the upgrade module
 * 
 * Maps to the same `worker` table owned by config-service.
 * Only includes columns needed for upgrade operations.
 */
import { Entity, Column, PrimaryColumn } from 'typeorm';

/**
 * Upgrade bundle distribution status for a worker
 */
export enum UpgradeBundleStatus {
  /** No upgrade bundle distribution initiated */
  IDLE = 'IDLE',
  /** Multicast triggered, worker download in progress */
  IN_PROGRESS = 'IN_PROGRESS',
  /** Worker downloaded and verified successfully */
  COMPLETED = 'COMPLETED',
}

@Entity({ name: 'worker' })
export class WorkerEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  workerId: string;

  @Column({ type: 'varchar', name: 'status' })
  status: string;

  @Column({ type: 'varchar', name: 'platform', nullable: true })
  platform: string;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'upgrade_bundle_staged',
    default: UpgradeBundleStatus.IDLE,
  })
  upgradeBundleStaged: UpgradeBundleStatus;
}
