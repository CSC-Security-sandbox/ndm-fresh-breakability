import { SupportBundleStatus } from 'src/constants/enums';
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('support_bundle_logs')
export class SupportBundleEntity {
  @PrimaryColumn({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    type: 'enum',
    enum: SupportBundleStatus,
  })
  status: SupportBundleStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'workflow_id', type: 'text' })
  workflowId: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'jsonb', nullable: false })
  filters: {
    startDate: string;
    endDate: string;
    projectWorkerMap?: {
      projectId?: string;
      workerIds?: string[];
    }[];
    otherMetrics?: string[];
  };
}
