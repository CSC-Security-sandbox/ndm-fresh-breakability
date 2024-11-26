import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';
import { JobConfigEntity } from './jobconfig.entity';

export enum JobRunStatus {
  Ready = 'READY',
  Pending = 'PENDING',
  Running = 'RUNNING',
  Completed = 'COMPLETED',
  Stopped = 'STOPPED',
  Paused = 'PAUSED',
  Errored = 'ERRORED',
  Exited = 'EXITED'
}
@Entity({ name: 'jobrun', schema: 'migrate' })
export class JobRunEntity extends Base {
  @ApiProperty({ description: 'UUID of the job run' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Job run status' })
  @Column({ type: 'enum', enum: JobRunStatus, default: JobRunStatus.Pending })
  status: JobRunStatus;

  @ApiProperty({ description: 'Start time of the job' })
  @Column({ name: 'start_time' })
  startTime: Date;

  @ApiProperty({ description: 'End time of the job' })
  @Column({ name: 'end_time' })
  endTime: Date;

  @ApiProperty({ description: 'Iteration number of the job' })
  @Column({ name: 'iteration_number' })
  iterationNumber: number;

  @ApiProperty({ description: 'Job ID associated with this run' })
  @Column({ name: 'job_config_id' })
  jobConfigId: string;

  @ManyToOne(() => JobConfigEntity, job => job.id)
  @JoinColumn({ name: 'job_config_id' }) 
  job: JobConfigEntity;
}