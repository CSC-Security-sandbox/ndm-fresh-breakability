import { Entity, Column, PrimaryColumn } from 'typeorm';
import { UpgradeBundleStatus } from '../constants/worker.enums';

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
