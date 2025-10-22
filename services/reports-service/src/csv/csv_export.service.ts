import { Injectable, Logger, InternalServerErrorException, BadRequestException, ServiceUnavailableException, Inject, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as fastCsv from 'fast-csv';
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

    async generateCsv(filePath: string, jobRunId: string, batchSize: number = 10000) {
        const projectId = await this.projectIdCacheService.getProjectIdFromCache(jobRunId);
        this.logger.log(`projectId: ${projectId} Starting CSV generation for jobRunId: ${jobRunId}, filePath: ${filePath}`);
        
        if (!validateFilePath(filePath)) {
            this.logger.error(`projectId: ${projectId} File path contains invalid characters: ${filePath}`);
            throw new Error('File path contains invalid characters.');
        } else {
            this.logger.log(`projectId: ${projectId} File path validation passed: ${filePath}`);
        }
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        try {
            const fileStream = fs.createWriteStream(filePath); 
            const csvStream = fastCsv.format({ headers: true });
            csvStream.pipe(fileStream);
            let offset = 1;

            let totalRecords = 0;
            while (true) {
                const result = await this.getInventoryData(jobRunId, batchSize, offset);
                if (!result || result.length === 0) break;
                for (const row of result) {
                    csvStream.write(row);
                }
                totalRecords += result.length;
                offset++;
                
                if (offset % 10 === 0) {
                    this.logger.log(`projectId: ${projectId} Processed ${totalRecords} records so far for jobRunId: ${jobRunId}`);
                }
            }
            csvStream.end();
            this.logger.log(`projectId: ${projectId} CSV generation completed for jobRunId: ${jobRunId}, total records: ${totalRecords}`);
        } catch (err) {
            this.logger.error(`projectId: ${projectId} Error generating CSV for jobRunId: ${jobRunId}: ${err.message}`, err?.stack || err);
            throw err;
        } finally {
            await queryRunner.release();
        }
    }

    async getInventoryData(jobRunId: string, limit: number, offset: number) {
        const query = await this.getInventoryDataQuery(jobRunId, limit, offset);
        return this.dataSource.query(query.query, query.values);
    }

    async getInventoryDataQuery(jobRunId: string, limit: number, offset: number) {
        const dbSchema = process.env.SCHEMA;
        const query = `
           SELECT
                v_source.volume_path || i.path as "Source Path",
                v_target.volume_path || i.path as "Target Path",
                jc.job_type AS "Migration Type",
                i.created_at AS "Start Time",
                i.updated_at AS "End Time",
                CASE
                    WHEN is_directory THEN 'success'
                    ELSE
                        CASE
                            WHEN source_checksum = target_checksum THEN 'success'
                            ELSE 'failed'
                        END
                END AS status,
                CASE 
                    WHEN is_directory THEN 'd'
                    ELSE 'f'
                END AS type,
                file_size as "Size",
                source_checksum as "Source Checksum",
                target_checksum as "Target Checksum",
                CASE 
                    WHEN count(iccm.id) > 0 THEN 'Yes'
                    ELSE 'No'
                END AS "External mapping file used",

                 -- Birth time
                i.source_meta->>'birthTime'     AS "Source BirthTime",
                i.target_meta->>'birthTime'     AS "Target BirthTime",

                -- Access time
                i.source_meta->>'accessTime'    AS "Source AccessTime",
                i.target_meta->>'accessTime'    AS "Target AccessTime",

                -- Modified time
                i.source_meta->>'modifiedTime'  AS "Source ModifiedTime",
                i.target_meta->>'modifiedTime'  AS "Target ModifiedTime",

                -- Permission
                i.source_meta->>'permission'    AS "Source Permission",
                i.target_meta->>'permission'    AS "Target Permission",

                -- UID
                i.source_meta->>'uid'           AS "Source UID",
                i.target_meta->>'uid'           AS "Target UID",

                -- GID
                i.source_meta->>'gid'           AS "Source GID",
                i.target_meta->>'gid'           AS "Target GID",

                -- SID
                i.source_meta->>'sid'           AS "Source SID",
                i.target_meta->>'sid'           AS "Target SID"

            FROM ${dbSchema}.inventory i
            LEFT JOIN ${dbSchema}.jobrun ON jobrun.id = i.job_run_id
            LEFT JOIN ${dbSchema}.jobconfig jc ON jc.id = jobrun.job_config_id
            LEFT JOIN ${dbSchema}.volume v_source ON jc.source_path_id = v_source.id
            LEFT JOIN ${dbSchema}.volume v_target ON jc.target_path_id = v_target.id
            LEFT JOIN ${dbSchema}.identity_config_cross_mapping iccm ON iccm.job_config_id = jc.id
            WHERE job_run_id = $1
            GROUP BY v_source.volume_path, v_target.volume_path, i.path, jc.job_type, i.created_at, i.updated_at, i.is_directory, i.source_checksum, i.target_checksum, i.file_size, i.source_meta, i.target_meta
            ORDER BY i.created_at DESC
            LIMIT $2 OFFSET ($3 - 1) * $2;
        `;
        return { query, values: [jobRunId, limit, offset] };
    }
}