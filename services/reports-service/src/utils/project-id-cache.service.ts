import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';

export const SQL_QUERIES = {
  GET_PROJECT_ID_FROM_JOBRUN: `
    SELECT c.project_id
    FROM datamigrator.jobrun jr
    JOIN datamigrator.jobconfig jc ON jr.job_config_id = jc.id
    JOIN datamigrator.volume v ON jc.source_path_id = v.id
    JOIN datamigrator.file_server fs ON v.file_server_id = fs.id
    JOIN datamigrator.config c ON fs.config_id = c.id
    WHERE jr.id = $1
  `,
};

const CACHE_MAX_SIZE = 10000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  projectId: string;
  expiresAt: number;
}

@Injectable()
export class ProjectIdCacheService {
  private readonly logger: LoggerService | Logger;
  private jobRunIdToProjectIdMap: Map<string, CacheEntry> = new Map();

  constructor(
    private readonly dataSource: DataSource,
    @Optional() @Inject(LoggerFactory) private readonly loggerFactory?: LoggerFactory,
  ) {
    if (this.loggerFactory) {
      this.logger = this.loggerFactory.create(ProjectIdCacheService.name);
    } else {
      // Fallback to basic NestJS Logger for worker threads
      this.logger = new Logger(ProjectIdCacheService.name);
    }
  }

  /**
   * Retrieves projectId from the cache for a given jobRunId
   * If not found in cache, attempts to fetch from database (handles service restart scenarios)
   * 
   * @param {string} jobRunId - The job run identifier
   * @returns {Promise<string | null>} - The cached projectId or null if not found
   */
  async getProjectIdFromCache(jobRunId: string): Promise<string | null> {
    // Early guard: return null for empty or falsy jobRunId to avoid unnecessary DB calls
    if (!jobRunId || !jobRunId.trim()) {
      this.logger.log(`getProjectIdFromCache called with invalid jobRunId: '${jobRunId}'`);
      return null;
    }

    // First try to get from cache
    const cached = this.jobRunIdToProjectIdMap.get(jobRunId);
    let projectId: string | null = null;

    if (cached) {
      if (Date.now() < cached.expiresAt) {
        this.logger.log(`Retrieved projectId: ${cached.projectId} from cache for jobRunId: ${jobRunId}`);
        return cached.projectId;
      }
      this.jobRunIdToProjectIdMap.delete(jobRunId);
    }

    // If not in cache, try database lookup (handles service restart scenarios)
    this.logger.log(`ProjectId not found in cache for jobRunId: ${jobRunId}, attempting database lookup`);
    projectId = await this.getProjectIdFromDatabase(jobRunId);

    if (projectId) {
      // Cache the result for future use
      this.setProjectIdInCache(jobRunId, projectId);
    }

    return projectId;
  }

  /**
   * Manually set projectId in cache - useful for worker threads
   */
  setProjectIdInCache(jobRunId: string, projectId: string): void {
    if (projectId && jobRunId) {
      if (this.jobRunIdToProjectIdMap.size >= CACHE_MAX_SIZE) {
        const firstKey = this.jobRunIdToProjectIdMap.keys().next().value;
        if (firstKey) this.jobRunIdToProjectIdMap.delete(firstKey);
      }
      this.jobRunIdToProjectIdMap.set(jobRunId, {
        projectId,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      this.logger.log(`Cached projectId: ${projectId} for jobRunId: ${jobRunId}`);
    } else {
      this.logger.error(`Failed to cache projectId: invalid parameters - jobRunId: '${jobRunId}', projectId: '${projectId}'`);
    }
  }

  /**
   * Clears projectId from cache for a specific jobRunId or all entries
   * 
   * @param {string} [jobRunId] - Optional specific jobRunId to clear. If not provided, clears all cache
   * @returns {void}
   */
  clearProjectIdCache(jobRunId?: string): void {
    if (jobRunId) {
      if (this.jobRunIdToProjectIdMap.has(jobRunId)) {
        this.jobRunIdToProjectIdMap.delete(jobRunId);
        this.logger.debug(`Cleared projectId cache for jobRunId: ${jobRunId}`);
      }
    } else {
      const cacheSize = this.jobRunIdToProjectIdMap.size;
      this.jobRunIdToProjectIdMap.clear();
      this.logger.debug(`Cleared all projectId cache entries: ${cacheSize} items`);
    }
  }

  /**
   * Retrieves projectId from database when not found in cache
   * This method handles service restart scenarios where the cache is lost
   * 
   * @param {string} jobRunId - The job run identifier
   * @returns {Promise<string | null>} - The projectId from database or null if not found
   */
  private async getProjectIdFromDatabase(jobRunId: string): Promise<string | null> {
    try {
      const result = await this.dataSource.query(SQL_QUERIES.GET_PROJECT_ID_FROM_JOBRUN, [jobRunId]);

      if (result && result.length > 0 && result[0].project_id) {
        const projectId = result[0].project_id;
        this.logger.log(`Retrieved projectId: ${projectId} from database for jobRunId: ${jobRunId}`);
        return projectId;
      }

      this.logger.log(`No projectId found in database for jobRunId ${jobRunId}`);
      return null;
    } catch (error) {
      this.logger.error(`Error getting projectId from database for jobRunId ${jobRunId}: `, error);
      return null;
    }
  }

  /**
   * Helper method to log with project context
   * @param {string} jobRunId - The job run identifier
   * @param {string} message - The message to log
   * @param {string} level - Log level (log, warn, error, debug)
   */
  async logWithProjectId(jobRunId: string, message: string, level: 'log' | 'warn' | 'error' | 'debug' = 'log'): Promise<void> {
    // Early guard: if jobRunId is invalid, log without project context
    if (!jobRunId || !jobRunId.trim()) {
      this.logger[level](message);
      return;
    }

    const projectId = await this.getProjectIdFromCache(jobRunId);
    const contextualMessage = projectId ? `projectId: ${projectId} ${message}` : message;
    this.logger[level](contextualMessage);
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { size: number; entries: Array<{ jobRunId: string; projectId: string }> } {
    const entries = Array.from(this.jobRunIdToProjectIdMap.entries()).map(([jobRunId, entry]) => ({
      jobRunId,
      projectId: entry.projectId,
    }));

    return {
      size: this.jobRunIdToProjectIdMap.size,
      entries,
    };
  }
}