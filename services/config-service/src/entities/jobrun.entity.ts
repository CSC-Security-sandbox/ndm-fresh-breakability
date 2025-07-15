import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';
import { WorkerConfiguration } from 'src/constants/types';
import { JobConfigEntity } from './jobconfig.entity';
import { WorkerJobRunMap } from './workerjobrun.entity';

// ---------- Job Run -----------/
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
  Blocked = 'BLOCKED'
}


@Entity({ name: 'jobrun' })
export class JobRunEntity extends Base {
  @ApiProperty({ description: 'UUID of the job run' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Job Run status' })
  @Column({ type: 'enum', enum: JobRunStatus, default: JobRunStatus.Ready, name:'status' })
  status: JobRunStatus;

  @ApiProperty({ description: 'Start time of the job' })
  @Column({ name: 'start_time' })
  startTime: Date;

  @ApiProperty({ description: 'End time of the job' })
  @Column({ name: 'end_time' })
  endTime: Date;

  @ApiProperty({ description: 'Job ID associated with this run' })
  @Column({ name: 'job_config_id' })
  jobConfigId: string;

  @ManyToOne(() => JobConfigEntity, jobConfig => jobConfig.jobRunDetails, {eager: false })
  @JoinColumn({ name: 'job_config_id' })
  jobConfig: JobConfigEntity; 

  @Column({ type: 'json', nullable: true, name: 'meta_config' }) 
  metaConfig: WorkerConfiguration[];

  @Column({ type: 'text', nullable: true, name: 'workflow_id' })
  workFlowId: string;

  @OneToMany(()=>WorkerJobRunMap, workerMap=>workerMap.jobRun, { cascade: true,  eager: false})
  workerMap: WorkerJobRunMap[]
}