import { ApiProperty } from '@nestjs/swagger';
import { ViewEntity, ViewColumn, Index } from 'typeorm';

@ViewEntity({
  name: 'storage_jobs_overview_mv',
  materialized: true
})
export class StorageOverviewSummaryEntity {
  @ApiProperty({ description: 'UUID of the project' })
  @ViewColumn({ name: 'project_id' })
  projectId: string;

  @ApiProperty({ description: 'File Server Id' })
  @ViewColumn({ name: 'config_id' })
  configId: string;

  @ApiProperty({ description: 'Total Discovered Size' })
  @ViewColumn({ name: 'total_discovered_size'})
  totalDiscoveredSize: number;

  @ApiProperty({ description: 'Total Migrated Size' })
  @ViewColumn({ name: 'total_migrated_size', })
  totalMigratedSize: number;

  @ApiProperty({ description: 'Total Pending Size' })
  @ViewColumn({ name: 'total_pending_size'})
  totalPendingSize: number;

  @ApiProperty({ description: 'Total Discovery Job Runs' })
  @ViewColumn({ name: 'debug_discovery_job_runs'})
  debugDiscoveryJobRuns: number;

  @ApiProperty({ description: 'Total Migration Job Runs' })
  @ViewColumn({ name: 'debug_migration_job_runs'})
  debugMigrationJobRuns: number;

  @ApiProperty({ description: 'Last Refreshed time' })
  @ViewColumn({ name: 'last_refreshed'})
  lastRefreshed: Date;
}