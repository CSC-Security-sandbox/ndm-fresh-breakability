import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum JobRunStatus {
  Ready = 'READY',
  Running = 'RUNNING',
  Paused = 'PAUSED',
  Pausing = 'PAUSING',
  Stopped = 'STOPPED',
  Stopping = 'STOPPING',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Errored = 'ERRORED',
  Blocked = 'BLOCKED',
  Pending = 'PENDING',
}

@Entity({ name: 'jobrun' })
export class JobRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', name: 'status' })
  status: JobRunStatus;

  @Column({ name: 'start_time', nullable: true })
  startTime: Date;

  @Column({ name: 'job_config_id' })
  jobConfigId: string;
}
