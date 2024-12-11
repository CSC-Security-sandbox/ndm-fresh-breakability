import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Timestamp } from 'typeorm';
import { Base } from './base.entity';
import { JobRunEntity } from './jobrun.entity';
import { VolumeEntity } from './volume.entity';

export enum JobStatus {
  Active = 'ACTIVE',
  InActive = 'IN_ACTIVE',
}

export enum JobType {
  Scan = 'SCAN',
  Migrate = 'MIGRATE',
  CutOver = 'CUT_OVER',
}

export enum JobScheduleType {
  Now = 'NOW',
  Date = 'DATE',
  CronExp = 'CRON_EXP',
}

export enum IncrementalJobScheduleType {
  Off = 'OFF',
  Date = 'DATE',
  CronExp = 'CRON_EXP',
}

export class JobSchedule {
  @ApiProperty({ description: 'Job schedule type', enum: JobScheduleType })
  type: JobScheduleType;

  @ApiProperty({ description: 'Job schedule expression' })
  schedule: string;
}

export class IncrementalSchedule {
  @ApiProperty({ description: 'Job schedule type', enum: IncrementalJobScheduleType })
  type: IncrementalJobScheduleType;

  @ApiProperty({ description: 'Job schedule expression' })
  schedule: string;
}

@Entity({ name: 'jobconfig', schema: 'migrate' })
export class JobConfigEntity extends Base {
  @ApiProperty({ description: 'UUID of the job' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Job type, e.g., discovery' })
  @Column({ type: 'enum', enum: JobType, name: 'job_type' })
  jobType: JobType;

  @ApiProperty({ description: 'Status of the job' })
  @Column({ type: 'enum', enum: JobStatus, name: 'status' })
  status: JobStatus;

  @ApiProperty({ description: 'Exclude files older than this date' })
  @Column({ name: 'exclude_older_than', type: 'timestamp', nullable: true })
  excludeOlderThan: Date | null;

  @ApiProperty({ description: 'Patterns of files to exclude' })
  @Column({ name: 'exclude_file_patterns', type: 'text', nullable: true })
  excludeFilePatterns: string | null;

  @ApiProperty({ description: 'Preserve access time flag' })
  @Column({ name: 'preserve_access_time', type: 'boolean', default: false })
  preserveAccessTime: boolean;

  @ApiProperty({ description: 'Job schedule configuration' })
  @Column({ name: 'first_run_at', type: 'timestamp' ,nullable: true})
  firstRunAt: Timestamp;

  @ApiProperty({ description: 'Incremental job schedule configuration' })
  @Column({ name: 'future_schedule_at', type: 'text', nullable: true })
  futureScheduleAt: string;

  @ApiProperty({ description: 'UUID of the source path configuration' })
  @Column({ type: 'uuid', nullable: false, name: 'source_path_id' })
  sourcePathId: string;

  @ApiProperty({ description: 'UUID of the target path configuration' })
  @Column({ type: 'uuid', nullable: true, name: 'target_path_id' })
  targetPathId: string;

  @OneToMany(() => JobRunEntity, jobRun => jobRun.jobConfig, { cascade: true, eager: false })
  jobRunDetails: JobRunEntity[];

  @ManyToOne(() => VolumeEntity, volume => volume.jobConfig, { onDelete: 'CASCADE', orphanedRowAction: 'delete' })
  @JoinColumn({ name: 'source_path_id' })
  paths: VolumeEntity
}