import { ApiProperty } from '@nestjs/swagger';
import { ViewEntity, ViewColumn } from 'typeorm';

@ViewEntity({
  name: 'destination_files_n_dir_count_mv',
  schema: 'datamigrator',
  materialized: true,
})
export class DestinationFilesCountMvEntity {
  @ApiProperty({ description: 'UUID of the job config' })
  @ViewColumn({ name: 'job_config_id' })
  jobConfigId: string;

  @ApiProperty({ description: 'Total number of distinct files in the destination' })
  @ViewColumn({ name: 'total_destination_files' })
  totalDestinationFiles: number;

  @ApiProperty({ description: 'Total number of distinct directories in the destination' })
  @ViewColumn({ name: 'total_destination_directories' })
  totalDestinationDirectories: number;

  @ApiProperty({ description: 'Total number of distinct items (files + directories) in the destination' })
  @ViewColumn({ name: 'total_destination_items' })
  totalDestinationItems: number;

  @ApiProperty({ description: 'Number of job runs included in the count' })
  @ViewColumn({ name: 'job_run_count' })
  jobRunCount: number;

  @ApiProperty({ description: 'Total size of all destination files in bytes' })
  @ViewColumn({ name: 'total_destination_size' })
  totalDestinationSize: string;

  @ApiProperty({ description: 'Last time the materialized view was refreshed' })
  @ViewColumn({ name: 'last_refreshed' })
  lastRefreshed: Date;
}

