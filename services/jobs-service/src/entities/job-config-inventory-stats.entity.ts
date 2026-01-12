import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Base } from './base.entity';

@Entity({ name: 'job_config_inventory_stats' })
@Unique('uq_job_config_inventory_stats_job_config_id', ['jobConfigId'])
export class JobConfigInventoryStatsEntity extends Base {
  @ApiProperty({ description: 'UUID of the inventory stats record' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'UUID of the job configuration' })
  @Column({ type: 'uuid', name: 'job_config_id', nullable: false })
  jobConfigId: string;

  @ApiProperty({ description: 'Total number of unique files' })
  @Column({ type: 'bigint', name: 'file_count', nullable: false, default: 0 })
  fileCount: number;

  @ApiProperty({ description: 'Total number of unique directories' })
  @Column({ type: 'bigint', name: 'dir_count', nullable: false, default: 0 })
  dirCount: number;

  @ApiProperty({ description: 'Total size of all files in bytes' })
  @Column({ type: 'bigint', name: 'total_size', nullable: false, default: 0 })
  totalSize: number;

  @ApiProperty({ description: 'Last updated timestamp' })
  @Column({ type: 'timestamp', name: 'last_updated_at', nullable: false, default: () => 'now()' })
  lastUpdatedAt: Date;
}
