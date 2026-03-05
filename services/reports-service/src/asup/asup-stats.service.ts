import { Injectable, Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

/**
 * Job types for ASUP reporting
 */
export type AsupJobType = 'discovery' | 'migration' | 'cutover';

/**
 * Interface for recording job run stats (COMPLETED or STOPPED jobs)
 */
export interface JobRunStats {
  jobRunId: string;
  jobConfigId: string;
  projectId: string;
  projectName: string;
  jobType: AsupJobType;
  protocol: string;
  sourceServerType?: string;      
  destinationServerType?: string;
  fileCount: number;
  sizeBytes: number;
  jobRunStartedAt?: Date;
  jobRunCompletedAt?: Date;
}

/**
 * Interface for aggregated job config stats (for XML generation)
 */
export interface AggregatedJobStats {
  jobConfigId: string;
  projectId: string;
  projectName: string;
  jobType: AsupJobType;
  protocol: string;
  sourceServerType: string;
  destinationServerType: string;
  totalFileCount: number;
  totalSizeBytes: number;
  jobRunCount: number;
}

/**
 * Interface for project with aggregated jobs (for XML generation)
 */
export interface ProjectStats {
  projectId: string;
  projectName: string;
  jobs: AggregatedJobStats[];
  totals: {
    discoveredFileCount: number;
    discoveredSizeBytes: number;
    migratedFileCount: number;
    migratedSizeBytes: number;
    totalJobRuns: number;
  };
}

/**
 * AsupStatsService
 * 
 * Manages the asup_stats table which stores stats for each job run.
 * Provides methods to:
 * 1. Record stats when a job run completes
 * 2. Get aggregated stats per job config for XML generation
 * 3. Get stats grouped by project for the full ASUP report
 */
@Injectable()
export class AsupStatsService {
  private readonly logger: LoggerService;

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly dataSource: DataSource,
  ) {
    this.logger = loggerFactory.create(AsupStatsService.name);
  }

  /**
   * Record stats for a COMPLETED or STOPPED job run.
   * Called by the jobs-service when a job run finishes (completed or stopped).
   * Failed/cancelled jobs are not recorded.
   */
  async recordJobRunStats(stats: JobRunStats): Promise<void> {
    this.logger.log(`Recording ASUP stats for job run: ${stats.jobRunId}`);

    const query = `
      INSERT INTO datamigrator.asup_stats (
        job_run_id, job_config_id,
        project_id, project_name,
        job_type, protocol, source_server_type, destination_server_type,
        file_count, size_bytes,
        transmitted
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE
      )
      ON CONFLICT (job_run_id) DO UPDATE SET
        file_count = EXCLUDED.file_count,
        size_bytes = EXCLUDED.size_bytes
    `;

    try {
      await this.dataSource.query(query, [
        stats.jobRunId,
        stats.jobConfigId,
        stats.projectId,
        stats.projectName,
        stats.jobType,
        stats.protocol || null,
        stats.sourceServerType || null,
        stats.destinationServerType || (stats.jobType === 'discovery' ? 'n/a' : null),
        stats.fileCount,
        stats.sizeBytes,
      ]);

      this.logger.log(`Recorded ASUP stats for job run: ${stats.jobRunId}`);
    } catch (error) {
      this.logger.error(`Failed to record ASUP stats: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get aggregated stats for all job configs, grouped by project.
   * Only includes UNTRANSMITTED records.
   * This is the main method for generating the ASUP XML report.
   */
  async getUntransmittedStatsGroupedByProject(): Promise<ProjectStats[]> {
    const query = `
      SELECT 
        project_id,
        project_name,
        job_config_id,
        job_type,
        protocol,
        source_server_type,
        destination_server_type,
        SUM(file_count) as total_file_count,
        SUM(size_bytes) as total_size_bytes,
        COUNT(*) as job_run_count
      FROM datamigrator.asup_stats
      WHERE transmitted = FALSE
      GROUP BY 
        project_id, project_name,
        job_config_id,
        job_type, protocol, source_server_type, destination_server_type
      ORDER BY project_id, job_type, job_config_id
    `;

    const result = await this.dataSource.query(query);
    const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] })?.rows ?? [];
    return this.mapRowsToProjectStats(rows);
  }

  /**
   * Helper method to map database rows to ProjectStats structure
   */
  private mapRowsToProjectStats(rows: any[]): ProjectStats[] {
    const projectMap = new Map<string, ProjectStats>();

    for (const row of rows) {
      const projectId = row.project_id;

      if (!projectMap.has(projectId)) {
        projectMap.set(projectId, {
          projectId,
          projectName: row.project_name,
          jobs: [],
          totals: {
            discoveredFileCount: 0,
            discoveredSizeBytes: 0,
            migratedFileCount: 0,
            migratedSizeBytes: 0,
            totalJobRuns: 0,
          },
        });
      }

      const project = projectMap.get(projectId)!;
      const fileCount = parseInt(row.total_file_count, 10) || 0;
      const sizeBytes = parseInt(row.total_size_bytes, 10) || 0;
      const runCount = parseInt(row.job_run_count, 10) || 0;

      // Add job to project
      project.jobs.push({
        jobConfigId: row.job_config_id,
        projectId: row.project_id,
        projectName: row.project_name,
        jobType: row.job_type as AsupJobType,
        protocol: row.protocol || 'UNKNOWN',
        sourceServerType: row.source_server_type || 'Unknown',
        destinationServerType: row.destination_server_type || 'n/a',
        totalFileCount: fileCount,
        totalSizeBytes: sizeBytes,
        jobRunCount: runCount,
      });

      // Update project totals
      if (row.job_type === 'discovery') {
        project.totals.discoveredFileCount += fileCount;
        project.totals.discoveredSizeBytes += sizeBytes;
      } else {
        // migration and cutover both count as migrated
        project.totals.migratedFileCount += fileCount;
        project.totals.migratedSizeBytes += sizeBytes;
      }
      project.totals.totalJobRuns += runCount;
    }

    return Array.from(projectMap.values());
  }

  /**
   * Mark all untransmitted records as transmitted.
   * Called after successful ASUP transmission.
   * Returns the number of records marked.
   */
  async markAsTransmitted(): Promise<number> {
    const query = `
      UPDATE datamigrator.asup_stats
      SET transmitted = TRUE
      WHERE transmitted = FALSE
    `;

    const result = await this.dataSource.query(query);
    const count = (result as { rowCount?: number })?.rowCount ?? 0;
    
    this.logger.log(`Marked ${count} ASUP stats records as transmitted`);
    return count;
  }

  /**
   * Get count of untransmitted records
   */
  async getUntransmittedCount(): Promise<number> {
    const query = `
      SELECT COUNT(*) as count FROM datamigrator.asup_stats WHERE transmitted = FALSE
    `;
    
    const result = await this.dataSource.query(query);
    const row = Array.isArray(result) ? result[0] : (result as { rows?: { count?: string }[] })?.rows?.[0];
    return parseInt(row?.count || '0', 10);
  }

}
