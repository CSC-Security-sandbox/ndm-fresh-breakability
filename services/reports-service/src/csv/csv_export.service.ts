import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { validateFilePath } from 'src/utils/utils';
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';
import { ProjectIdCacheService } from '../utils/project-id-cache.service';

@Injectable()
export class CsvService {
    private readonly logger: LoggerService | Logger;

    constructor(
        private readonly dataSource: DataSource,
        private readonly projectIdCacheService: ProjectIdCacheService,
        @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory
    ) {
        if (loggerFactory) {
            this.logger = loggerFactory.create(CsvService.name);
        } else {
            // Fallback to basic NestJS Logger for worker threads
            this.logger = new Logger(CsvService.name);
        }
    }

    /**
     * Delegates CSV generation entirely to the database via the
     * generate_inventory_csv stored procedure.  PostgreSQL writes
     * the file directly to the shared /reports host-mount, eliminating
     * cursor batching, Node.js object allocation, and fast-csv overhead.
     *
     * The batchSize parameter is kept for interface compatibility but is
     * no longer used — the procedure processes all rows in a single pass.
     *
     * Prerequisites:
     *   1. GRANT pg_write_server_files TO dmadmin;  (run as postgres superuser)
     *   2. postgres pod must have /data/reports mounted at /reports
     *      (add extraVolumes/extraVolumeMounts in postgres-values.j2)
     */
    async generateCsv(filePath: string, jobRunId: string, _batchSize: number = 10000, jobType?: string) {
        const projectId = await this.projectIdCacheService.getProjectIdFromCache(jobRunId);
        this.logger.log(`projectId: ${projectId} Starting CSV generation for jobRunId: ${jobRunId}, filePath: ${filePath}, jobType: ${jobType}`);

        if (!validateFilePath(filePath)) {
            this.logger.error(`projectId: ${projectId} File path contains invalid characters: ${filePath}`);
            throw new Error('File path contains invalid characters.');
        }

        const schema = process.env.SCHEMA;
        const normalizedJobType = (jobType || '').toUpperCase();

        try {
            await this.dataSource.query(
                `CALL ${schema}.generate_inventory_csv($1::uuid, $2, $3, $4)`,
                [jobRunId, filePath, schema, normalizedJobType]
            );
            this.logger.log(`projectId: ${projectId} CSV generation completed for jobRunId: ${jobRunId}`);
        } catch (err) {
            this.logger.error(`projectId: ${projectId} Error generating CSV for jobRunId: ${jobRunId}: ${err.message}`, err?.stack || err);
            throw err;
        }
    }
}
