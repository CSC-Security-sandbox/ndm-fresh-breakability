import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';

export enum JobRunStatus {
  Ready = 'READY',
  Pending = 'PENDING',
  Running = 'RUNNING',
  Paused = 'PAUSED',
  Stopped = 'STOPPED',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Errored = 'ERRORED'
}

@Entity({ name: 'job_run' })
export class JobRunEntity extends Base {
  @ApiProperty({ description: 'UUID of the job run' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Job Run status' })
  @Column({ type: 'enum', enum: JobRunStatus, default: JobRunStatus.Pending, name:'status' })
  status: JobRunStatus;

  @ApiProperty({ description: 'Start time of the job' })
  @Column({ name: 'chunk_size' })
  start_time: Date;

  @ApiProperty({ description: 'End time of the job' })
  @Column({ name: 'chunk_size' })
  end_time: Date;

  @ApiProperty({ description: 'Iteration number of the job' })
  @Column({ name: 'chunk_size' })
  iteration_number: number;

  @ApiProperty({ description: 'Job ID associated with this run' })
  @Column({ name: 'job_id' })
  job_id: string;

  // @ManyToOne(() => JobConfigEntity, job => job.id)
  // @JoinColumn({ name: 'job_id' }) 
  // job: JobConfigEntity;
}