import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';
import { JobConfigEntity } from './jobconfig.entity';
import { JobRunStatus } from 'src/constants/enums';



@Entity({ name: 'jobrun', schema: 'migrate' })
export class JobRunEntity extends Base {
  @ApiProperty({ description: 'UUID of the job run' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Job Run status' })
  @Column({ type: 'enum', enum: JobRunStatus, default: JobRunStatus.Pending, name:'status' })
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

  @ManyToOne(() => JobConfigEntity, jobConfig => jobConfig.jobRunDetails, {eager: false })
  jobConfig: JobConfigEntity; 
}