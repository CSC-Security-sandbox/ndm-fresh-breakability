import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { Base } from './base.entity';
import { UploadStatus, UpgradeStatus, WorkerAggregateStatus } from '../upgrade/enums/upgrade.enums';

@Entity('upgrade_bundles')
export class UpgradeBundle extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, name: 'file_name' })
  fileName: string;

  // Note: file_path column removed - deploy path is derived from version: /upload/upgrade-${version}

  @Column({ type: 'bigint', name: 'file_size' })
  fileSize: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  version: string;

  @Column({ type: 'varchar', length: 20, name: 'upload_status' })
  uploadStatus: UploadStatus;

  @Column({ type: 'timestamp', nullable: true, name: 'upload_started_at' })
  uploadStartedAt: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'upload_completed_at' })
  uploadCompletedAt: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'processing_started_at' })
  processingStartedAt: Date;

  @Column({ type: 'varchar', length: 20, default: UpgradeStatus.PENDING, name: 'upgrade_status' })
  upgradeStatus: UpgradeStatus;

  @Column({ type: 'timestamp', nullable: true, name: 'upgrade_completed_at' })
  upgradeCompletedAt: Date;

  @Column({ type: 'uuid', nullable: true, name: 'uploaded_by' })
  uploadedBy: string;

  @Column({ type: 'uuid', nullable: true, name: 'upgraded_by' })
  upgradedBy: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'multicast_workflow_id' })
  multicastWorkflowId: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'execution_workflow_id' })
  executionWorkflowId: string;

  @Column({ type: 'timestamptz', nullable: true, name: 'upgrade_worker_triggered_at' })
  upgradeWorkerTriggeredAt: Date;

  @Column({ type: 'varchar', length: 20, default: WorkerAggregateStatus.IDLE, name: 'worker_upload_status' })
  workerUploadStatus: WorkerAggregateStatus;

  @Column({ type: 'varchar', length: 20, default: WorkerAggregateStatus.IDLE, name: 'worker_upgrade_status' })
  workerUpgradeStatus: WorkerAggregateStatus;
}
