import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum JobStatus {
  Active = 'ACTIVE',
  InActive = 'IN_ACTIVE',
}

@Entity({ name: 'jobconfig' })
export class JobConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', name: 'status' })
  status: JobStatus;

  @Column({ type: 'varchar', name: 'job_type' })
  jobType: string;

  @Column({ name: 'future_schedule_at', type: 'text', nullable: true })
  futureScheduleAt: string;

  @Column({ name: 'scheduler', type: 'varchar', nullable: true })
  scheduler: string;
}
