import { SupportBundleStatus } from 'src/constants/enums';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('support_bundle_logs')
export class SupportBundleEntity {
  @PrimaryGeneratedColumn('uuid')
  request_id: string;

  @Column({ type: 'uuid', nullable: true })
  user_id: string;

  @Column({
    type: 'enum',
    enum: SupportBundleStatus,
  })
  status: SupportBundleStatus;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @Column({ type: 'uuid' })
  created_by: string;

  @Column({ type: 'text' })
  workflow_id: string;

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
