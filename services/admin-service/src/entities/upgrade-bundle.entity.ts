import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { Base } from './base.entity';

@Entity('upgrade_bundles')
export class UpgradeBundle extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, name: 'file_name' })
  fileName: string;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'file_path' })
  filePath: string;

  @Column({ type: 'bigint', name: 'file_size' })
  fileSize: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  version: string;

  @Column({ type: 'enum', enum: ['pending', 'uploading', 'success', 'failed', 'cancelled'], default: 'pending', name: 'upload_status' })
  uploadStatus: string;

  @Column({ type: 'timestamp', nullable: true, name: 'upload_started_at' })
  uploadStartedAt: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'upload_completed_at' })
  uploadCompletedAt: Date;

  @Column({ type: 'boolean', default: false, name: 'upgrade_success' })
  upgradeSuccess: boolean;

  @Column({ type: 'timestamp', nullable: true, name: 'upgrade_completed_at' })
  upgradeCompletedAt: Date;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'installed_cp_version' })
  installedCpVersion: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'staged', 'in_progress', 'success', 'failed', 'rolled_back'],
    default: 'pending',
    name: 'upgrade_status',
  })
  upgradeStatus: string;
}