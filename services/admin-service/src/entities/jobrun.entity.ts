import { JobRunStatus, JobRunType, WorkerConfiguration, JobRunStats, PausedReason } from 'src/constants/job-run.enums';
import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';
import { JobConfigEntity } from './jobconfig.entity';


@Entity({ name: 'jobrun' })
export class JobRunEntity extends Base {
  @ApiProperty({ description: "UUID of the job run" })
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ApiProperty({ description: "Job Run status" })
  @Column({ type: "varchar", name: "status" })
  status: JobRunStatus;

  @Column({ type: 'text', name: "sub_status", nullable: true }) 
  subStatus: string;

  @ApiProperty({ description: "Start time of the job" })
  @Column({ name: "start_time" })
  startTime: Date;

  @ApiProperty({ description: "End time of the job" })
  @Column({ name: "end_time", nullable: true })
  endTime: Date;

  @ApiProperty({ description: "Iteration number of the job" })
  @Column({ name: "iteration_number" })
  iterationNumber: number;

  @ApiProperty({ description: "Job ID associated with this run" })
  @Column({ name: "job_config_id" })
  jobConfigId: string;

  @ApiProperty({ description: "Job ID associated with this run" })
  @Column({ name: "is_report_ready" })
  isReportReady: boolean;

  @ApiProperty({ description: "Type of job run (REGULAR or RETRY)" })
  @Column({ type: 'varchar', name: 'job_run_type', default: 'REGULAR' })
  jobRunType: JobRunType;

  @ManyToOne(() => JobConfigEntity, (jobConfig) => jobConfig.jobRuns, {
    onDelete: "CASCADE",
    orphanedRowAction: "delete",
  })
  @JoinColumn({ name: "job_config_id" })
  jobConfig: JobConfigEntity;

  @Column({ type: 'json', nullable: true, name: 'meta_config' }) 
  metaConfig: WorkerConfiguration[];

  @Column({ type: 'text', nullable: true, name: 'workflow_id' })
  workFlowId: string;

  @Column({ type: 'json', nullable: true, name: 'job_stats' }) 
  jobStats: JobRunStats

  @Column({ type: 'text', nullable: true, name: 'paused_reason' })
  pausedReason: PausedReason;
}
