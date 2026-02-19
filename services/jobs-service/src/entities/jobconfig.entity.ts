import { ApiProperty } from '@nestjs/swagger';
import { JobStatus, JobType, Protocol } from 'src/constants/enums';
import { Column, Entity, JoinColumn, ManyToOne,OneToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';

import { JobRunEntity } from './jobrun.entity';
import { VolumeEntity } from './volume.entity';
import { Exclude } from 'class-transformer';
import { SpeedTestConfigEntity } from './speed-test-job-config.entity';


@Entity({ name: 'jobconfig' })
export class JobConfigEntity extends Base {
  @ApiProperty({ description: 'UUID of the job' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Job type, e.g., discovery' })
  @Column({ type: 'varchar', name: 'job_type' })
  jobType: JobType;

  @ApiProperty({ description: 'Status of the job' })
  @Column({ type: 'varchar', name: 'status' })
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

  @ApiProperty({ description: 'Scan Alternate Data Streams flag (Windows/SMB only)' })
  @Column({ name: 'should_scan_ads', type: 'boolean', default: false })
  shouldScanADS: boolean;

  @ApiProperty({ description: 'Job schedule configuration' })
  @Column({ name: 'first_run_at', type: 'timestamp with time zone' , nullable: true})
  firstRunAt: Date;

  @ApiProperty({ description: 'Incremental job schedule configuration' })
  @Column({ name: 'future_schedule_at', type: 'text', nullable: true })
  futureScheduleAt: string;

  @ApiProperty({ description: 'UUID of the source path configuration' })
  @Column({ type: 'uuid', nullable: false, name: 'source_path_id' })
  sourcePathId: string;

  @ApiProperty({ description: 'Directory path on the source volume' })
  @Column({ type: 'text', nullable: true, name: 'source_directory_path' })
  sourceDirectoryPath: string;

  @ApiProperty({ description: 'UUID of the target path configuration' })
  @Column({ type: 'uuid', nullable: true, name: 'target_path_id' })
  targetPathId: string;

  @ApiProperty({ description: 'Directory path on the target volume' })
  @Column({ type: 'text', nullable: true, name: 'target_directory_path' })
  targetDirectoryPath: string;

  @OneToMany(() => JobRunEntity, jobRun => jobRun.jobConfig, { cascade: true, eager: false })
  jobRuns: JobRunEntity[];

  @ManyToOne(() => VolumeEntity, volume => volume.sourcePath, { onDelete:'CASCADE'})
  @JoinColumn({ name: 'source_path_id' }) 
  sourcePath: VolumeEntity;

  @ManyToOne(() => VolumeEntity, volume => volume.targetPath, { onDelete:'CASCADE'})
  @JoinColumn({ name: 'target_path_id' }) 
  targetPath: VolumeEntity;

  @OneToMany(() => SpeedTestConfigEntity, speedTestConfig => speedTestConfig.jobConfig, { cascade: true })
  speedTestConfigs: SpeedTestConfigEntity[];

  @Column({ name: 'scheduler', type: 'varchar', nullable: true })
  scheduler: string;

  @Column({ name: 'skip_file', type: 'text', nullable: true })
  skipFile: string;
}
