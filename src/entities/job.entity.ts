import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';

@Entity({ name: 'job', schema: 'job' })
export class JobEntity extends Base {
  @ApiProperty({ description: 'UUID of the job' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'UUID of the source configuration' })
  @Column({ type: 'uuid', nullable: false, name: 'source_config_id' })
  source_config_id: string;

  @ApiProperty({ description: 'UUID of the target configuration' })
  @Column({ type: 'uuid', nullable: false, name: 'target_config_id' })
  target_config_id: string;

  @ApiProperty({ description: 'File filters, e.g. .txt' })
  @Column({ name: 'file_filters' })
  file_filters: string;

  @ApiProperty({ description: 'Flag for recursive file search' })
  @Column({ name: 'recursive_flag' })
  recursive_flag: boolean;

  @ApiProperty({ description: 'Timeout for the job in seconds' })
  @Column({ name: 'timeout' })
  timeout: number;

  @ApiProperty({ description: 'Number of retries allowed' })
  @Column({ name: 'retries' })
  retries: number;

  @ApiProperty({ description: 'Network throttling rate' })
  @Column({ name: 'network_throtlling' })
  network_throtlling: number;

  @ApiProperty({ description: 'Flag for overwrite policy' })
  @Column({ name: 'overwrite_policy' })
  overwrite_policy: boolean;

  @ApiProperty({ description: 'File permissions, e.g. 755' })
  @Column({ name: 'file_permissions' })
  file_permissions: string;

  @ApiProperty({ description: 'Cron settings enabled/disabled' })
  @Column({ name: 'cron_settings' })
  cron_settings: boolean;

  @ApiProperty({ description: 'Algorithms for integration' })
  @Column({ name: 'integrative_algorithms' })
  integrative_algorithms: string;

  @ApiProperty({ description: 'Notification settings' })
  @Column({ name: 'notification' })
  notification: string;

  @ApiProperty({ description: 'Chunk size for file transfer' })
  @Column({ name: 'chunk_size' })
  chunk_size: number;
}


