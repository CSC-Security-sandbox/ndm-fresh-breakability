import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { JobRunEntity } from './jobrun.entity';

@Entity({ name: 'ingest_jobrun_config' })
export class IngestJobRunConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'job_run_id', type: 'uuid', unique: true })
  jobRunId: string;

  @Column({ name: 'task_queue', type: 'varchar' })
  taskQueue: string;

  @OneToOne(() => JobRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_run_id' })
  jobRun: JobRunEntity;
}
