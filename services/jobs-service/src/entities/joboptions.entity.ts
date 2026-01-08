import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';
import { JobRunEntity } from './jobrun.entity';



@Entity({ name: 'job_options' })
export class JobOptionsEntity extends Base {
  @ApiProperty({ description: 'UUID of the job' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Exclude files older than this date' })
  @Column({ name: 'exclude_older_than', type: 'timestamp', nullable: true })
  excludeOlderThan: Date | null;

  @ApiProperty({ description: 'Patterns of files to exclude' })
  @Column({ name: 'exclude_file_patterns', type: 'text', nullable: true })
  excludeFilePatterns: string | null;

  @ApiProperty({ description: 'Preserve access time flag' })
  @Column({ name: 'preserve_access_time', type: 'boolean', default: false })
  preserveAccessTime: boolean;

  @ApiProperty({ description: 'Scan Alternate Data Streams (ADS) flag for SMB sources' })
  @Column({ name: 'should_scan_ads', type: 'boolean', default: false })
  shouldScanADS: boolean;

  @ApiProperty({ description: 'Source Working Directory' })
  @Column({ name: 'source_working_dir', type: 'text', nullable: true })
  sourceWorkingDir: string | null;

  @ApiProperty({ description: 'Target Working Directory' })
  @Column({ name: 'target_working_dir', type: 'text', nullable: true })
  targetWorkingDir: string | null;

  @ApiProperty({ description: 'Job Run Id' })
  @Column({ name: 'job_run_id', type: 'uuid', nullable: true })
  jobRunId: string | null;

  @OneToOne(()=> JobRunEntity,jobRun=> jobRun.options, {orphanedRowAction: 'delete', onDelete:'CASCADE'})
  @JoinColumn({ name: 'job_run_id' }) 
  jobRun: JobRunEntity

  @ApiProperty({ description: 'Skip files modified in a certain time' })
  @Column({ name: 'skip_file', type: 'text', nullable: true })
  skipFile: string | null;

  @ApiProperty({ description: 'ID of the associated identity mapping' })
  @Column({ name: 'identity_mapping_id', type: 'uuid', nullable: true })
  identityMappingId: string | null;
}