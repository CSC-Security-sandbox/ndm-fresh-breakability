import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { JobRunStatus } from '../constants/job-enums';
import { JobConfig } from './job-config.entity';

/**
 * Read-only entity mapping to the `jobrun` table managed by jobs-service.
 * Used by admin-service to query running job information.
 */
@Entity({ name: 'jobrun' })
export class JobRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', name: 'status' })
  status: JobRunStatus;

  @Column({ type: 'text', name: 'sub_status', nullable: true })
  subStatus: string | null;

  @Column({ name: 'start_time' })
  startTime: Date;

  @Column({ name: 'end_time', nullable: true })
  endTime: Date | null;

  @Column({ name: 'iteration_number' })
  iterationNumber: number;

  @Column({ name: 'job_config_id' })
  jobConfigId: string;

  @ManyToOne(() => JobConfig, (jobConfig) => jobConfig.jobRuns, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'job_config_id' })
  jobConfig: JobConfig;

  @Column({ type: 'varchar', name: 'job_run_type', default: 'REGULAR' })
  jobRunType: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  @Column({ type: 'uuid', nullable: true })
  updated_by: string;
}
