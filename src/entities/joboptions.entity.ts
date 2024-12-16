import { ApiProperty } from '@nestjs/swagger';
import { JobStatus, JobType } from 'src/constants/enums';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';
import { JobRunEntity } from './jobrun.entity';
import { VolumeEntity } from './volume.entity';



@Entity({ name: 'job_options', schema: 'migrateadmin' })
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

  @OneToOne(()=> JobRunEntity,jobRun=> jobRun.options, {orphanedRowAction: 'delete', onDelete:'CASCADE'})
  @JoinColumn({ name: 'job_run_id' }) 
  jobRun: JobRunEntity

}