import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { JobStatus, JobType } from '../constants/job-enums';
import { JobRun } from './job-run.entity';

/**
 * Read-only entity mapping to the `jobconfig` table managed by jobs-service.
 * Used by admin-service to query job status information.
 */
@Entity({ name: 'jobconfig' })
export class JobConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', name: 'job_type' })
  jobType: JobType;

  @Column({ type: 'varchar', name: 'status' })
  status: JobStatus;

  @Column({ name: 'first_run_at', type: 'timestamp with time zone', nullable: true })
  firstRunAt: Date | null;

  @Column({ name: 'future_schedule_at', type: 'text', nullable: true })
  futureScheduleAt: string | null;

  @Column({ type: 'uuid', nullable: false, name: 'source_path_id' })
  sourcePathId: string;

  @Column({ type: 'uuid', nullable: true, name: 'target_path_id' })
  targetPathId: string | null;

  @Column({ name: 'scheduler', type: 'varchar', nullable: true })
  scheduler: string | null;

  @OneToMany(() => JobRun, (jobRun) => jobRun.jobConfig, { eager: false })
  jobRuns: JobRun[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  @Column({ type: 'uuid', nullable: true })
  updated_by: string;
}
