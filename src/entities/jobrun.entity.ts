import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';
import { JobEntity } from './job.entity';

@Entity({ name: 'job_run' })
export class JobRunEntity extends Base {
  @ApiProperty({ description: 'UUID of the job run' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Job run status' })
  @Column({ name: 'status' })
  status: string;

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

  @ManyToOne(() => JobEntity, job => job.id)
  @JoinColumn({ name: 'job_id' }) 
  job: JobEntity;
}