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
    private static readonly DEFAULT_PROTOCOL = 'NFS';
    private static readonly PROTOCOL_SMB = 'SMB';
    private static readonly ACE_SOURCE_PREFIX = 'ACE in source:';
    private static readonly ACE_TARGET_PREFIX = 'ACE in target:';
    private static readonly ACE_SOURCE_PATTERN = 'ACE in source:.*$';
    private static readonly ACE_TARGET_PATTERN = 'ACE in target:.*$';
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
        const protocolQuery = `
        SELECT fs.protocol
        FROM ${dbSchema}.jobrun jr
        JOIN ${dbSchema}.jobconfig jc ON jc.id = jr.job_config_id
        JOIN ${dbSchema}.volume v ON v.id = jc.source_path_id
        JOIN ${dbSchema}.file_server fs ON fs.id = v.file_server_id
        WHERE jr.id = $1
    `;
        const protocolResult = await this.dataSource.query(protocolQuery, [jobRunId]);
        const protocol = protocolResult[0]?.protocol || CsvService.DEFAULT_PROTOCOL;
        const columns = this.getMigrationCoCColumns(protocol);
    
        const query = `
        SELECT DISTINCT ON (i.path)
            COALESCE(v_source.volume_path, '') || i.path as "Source Path",
            v_target.volume_path || i.path as "Destination Path",
            ${columns}
        FROM ${dbSchema}.inventory i
        LEFT JOIN ${dbSchema}.jobrun ON jobrun.id = i.job_run_id
        LEFT JOIN ${dbSchema}.jobconfig jc ON jc.id = jobrun.job_config_id
        LEFT JOIN ${dbSchema}.volume v_source ON jc.source_path_id = v_source.id
        LEFT JOIN ${dbSchema}.volume v_target ON jc.target_path_id = v_target.id
        WHERE i.job_run_id = $1
        ORDER BY i.path, i.updated_at DESC, i.created_at DESC
        LIMIT $2 OFFSET ($3 - 1) * $2;
    `;
        return { query, values: [jobRunId, limit, offset] };
    }

    getMigrationCoCColumns(protocol: string): string {
        const baseColumns = `
            i.source_checksum as "Source Checksum",
            i.target_checksum as "Destination Checksum",
            CASE
                WHEN i.is_directory THEN 'yes'
                ELSE
                    CASE
                        WHEN i.source_checksum = i.target_checksum THEN 'yes'
                        ELSE 'no'
                    END
            END AS "ChecksumMatchStatus",
            CASE
                WHEN i.is_directory THEN 'directory'
                ELSE 'file'
            END AS Type,
            i.file_size AS "Size in Bytes"
        `;
           
        //  Check protocol (case-insensitive)
        const protocolUpper = (protocol || CsvService.DEFAULT_PROTOCOL).toUpperCase();

        if (protocolUpper === CsvService.PROTOCOL_SMB) {
            return `
                ${baseColumns},
                (regexp_match(i.source_meta->>'sid', 'Owner: (S-[0-9-]+)'))[1] AS "Source Owner SID",
                (regexp_match(i.source_meta->>'sid', 'Group: (S-[0-9-]+)'))[1] AS "Source Group SID",
                regexp_replace(
                   substring(i.source_meta->>'sid' FROM '${CsvService.ACE_SOURCE_PATTERN}'), 
                    '${CsvService.ACE_SOURCE_PREFIX} ', 
                    '',
                    'g'
                ) AS "Source ACE Details",
                (regexp_match(i.target_meta->>'sid', 'Owner: (S-[0-9-]+)'))[1] AS "Target Owner SID",
                (regexp_match(i.target_meta->>'sid', 'Group: (S-[0-9-]+)'))[1] AS "Target Group SID",
                regexp_replace(
                    substring(i.target_meta->>'sid' FROM '${CsvService.ACE_TARGET_PATTERN}'), 
                    '${CsvService.ACE_TARGET_PREFIX} ', 
                    '',
                    'g'
                ) AS "Target ACE Details"
            `;
        } else {
            return `
                ${baseColumns},
                i.source_meta->>'uid' as "Source UID",
                i.target_meta->>'uid' as "Destination UID",
                i.source_meta->>'gid' as "Source GID",
                i.target_meta->>'gid' as "Destination GID",
                i.source_meta->>'permission' as "Source Unix Permissions",
                i.target_meta->>'permission' as "Destination Unix Permissions"
            `;
        }
    }
}