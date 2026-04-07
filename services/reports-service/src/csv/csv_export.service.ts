import { Injectable, Logger, InternalServerErrorException, BadRequestException, ServiceUnavailableException, Inject, Optional } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as fastCsv from 'fast-csv';
import { validateFilePath } from 'src/utils/utils';
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';
import { ProjectIdCacheService } from '../utils/project-id-cache.service';
import { JobType } from 'src/constants/enums';
import { JobRunEntity } from 'src/entities/jobrun.entity';

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
        @InjectRepository(JobRunEntity)
        private readonly jobRunRepository: Repository<JobRunEntity>,
        @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory
    ) {
        if (loggerFactory) {
            this.logger = loggerFactory.create(CsvService.name);
        } else {
            // Fallback to basic NestJS Logger for worker threads
            this.logger = new Logger(CsvService.name);
        }
    }

    async generateCsv(filePath: string, jobRunId: string, batchSize: number = 50000, jobType?: string, resumeCursor?: string | null) {
        const projectId = await this.projectIdCacheService.getProjectIdFromCache(jobRunId);
        const isResume = resumeCursor !== null && resumeCursor !== undefined && resumeCursor !== '';
        this.logger.log(`projectId: ${projectId} ${isResume ? 'Resuming' : 'Starting'} CSV generation for jobRunId: ${jobRunId}, filePath: ${filePath}, jobType: ${jobType}${isResume ? `, cursor: ${resumeCursor}` : ''}`);
        
        if (!validateFilePath(filePath)) {
            this.logger.error(`projectId: ${projectId} File path contains invalid characters: ${filePath}`);
            throw new Error('File path contains invalid characters.');
        } else {
            this.logger.log(`projectId: ${projectId} File path validation passed: ${filePath}`);
        }
        // Hoisted outside try so finally can access them for cleanup
        let fileStream: fs.WriteStream | undefined;
        let csvStream: ReturnType<typeof fastCsv.format> | undefined;
        try {
            // Append mode when resuming so existing rows are preserved; write mode for fresh start
            fileStream = isResume
                ? fs.createWriteStream(filePath, { flags: 'a' })
                : fs.createWriteStream(filePath);
            // Skip writing headers again when appending to an existing CSV
            csvStream = fastCsv.format({ headers: !isResume });

            // Register error/finish listeners before piping so no events are missed
            const streamDone = new Promise<void>((resolve, reject) => {
                fileStream!.once('finish', resolve);
                fileStream!.once('error', reject);
                csvStream!.once('error', reject);
            });

            csvStream.pipe(fileStream);

            let totalRecords = 0;
            let cursor: string | null = resumeCursor ?? null;
            const protocol = await this.getProtocolForJobRun(jobRunId);

            while (true) {
                const result = await this.getInventoryData(jobRunId, batchSize, cursor, jobType, protocol);
                if (!result || result.length === 0) break;
                for (const row of result) {
                    const { _cursor_path, ...csvRow } = row;
                    // Honor backpressure: pause writes until the internal buffer drains
                    if (!csvStream.write(csvRow)) {
                        await new Promise<void>(resolve => csvStream!.once('drain', resolve));
                    }
                }

                totalRecords += result.length;
                cursor = result[result.length - 1]['_cursor_path'];

                if (totalRecords % (batchSize * 10) === 0) {
                    this.logger.log(`projectId: ${projectId} Processed ${totalRecords} records so far for jobRunId: ${jobRunId}`);
                }
            }

            csvStream.end();
            await streamDone; // Wait for all bytes to flush to disk before returning
            this.logger.log(`projectId: ${projectId} CSV generation completed for jobRunId: ${jobRunId}, total records: ${totalRecords}`);
        } catch (err) {
            this.logger.error(`projectId: ${projectId} Error generating CSV for jobRunId: ${jobRunId}: ${err.message}`, err?.stack || err);
            throw err;
        } finally {
            // destroy() is a no-op on already-finished streams; guards FD leaks on any error path
            csvStream?.destroy();
            fileStream?.destroy();
        }
    }

    async getProtocolForJobRun(jobRunId: string): Promise<string> {
        const jobRun = await this.jobRunRepository.findOne({
            where: { id: jobRunId },
            relations: ['jobConfig', 'jobConfig.sourcePath', 'jobConfig.sourcePath.fileServer'],
        });
        return jobRun?.jobConfig?.sourcePath?.fileServer?.protocol || CsvService.DEFAULT_PROTOCOL;
    }

    async getInventoryData(jobRunId: string, limit: number, cursor: string | null, jobType?: string, protocol?: string) {
        let query;
        if (jobType?.toUpperCase() === JobType.CutOver) {
            query = await this.getCutoverInventoryDataQuery(jobRunId, limit, cursor);
        } else {
            query = await this.getInventoryDataQuery(jobRunId, limit, cursor, jobType, protocol);
        }
        return this.dataSource.query(query.query, query.values);
    }

    async getInventoryDataQuery(jobRunId: string, limit: number, cursor: string | null, jobType?: string, protocol?: string) {
        const dbSchema = process.env.SCHEMA;
        const isMigrate = jobType?.toUpperCase() === JobType.Migrate;
        const columns = this.getMigrationCoCColumns(protocol, isMigrate);

        const query = `
            SELECT DISTINCT ON (i.path)
                i.path AS _cursor_path,
                COALESCE(v_source.volume_path, '') || i.path as "Source Path",
                v_target.volume_path || i.path as "Destination Path",
                ${columns}
            FROM ${dbSchema}.inventory i
            LEFT JOIN ${dbSchema}.jobrun ON jobrun.id = i.job_run_id
            LEFT JOIN ${dbSchema}.jobconfig jc ON jc.id = jobrun.job_config_id
            LEFT JOIN ${dbSchema}.volume v_source ON jc.source_path_id = v_source.id
            LEFT JOIN ${dbSchema}.volume v_target ON jc.target_path_id = v_target.id
            WHERE i.job_run_id = $1
              AND (i.is_deleted = false OR i.is_deleted IS NULL)
              AND ($2::text IS NULL OR i.path > $2)
            ORDER BY i.path
            LIMIT $3;
    `;
        return { query, values: [jobRunId, cursor, limit] };
    }

    async getCutoverInventoryDataQuery(jobRunId: string, limit: number, cursor: string | null) {
        const dbSchema = process.env.SCHEMA;
        const query = `
            WITH all_related_jobs AS (
                SELECT jr.id, jr.start_time
                FROM ${dbSchema}.jobrun jr
                JOIN ${dbSchema}.jobconfig jc ON jr.job_config_id = jc.id
                WHERE (jc.source_path_id, jc.target_path_id) = (
                    SELECT jc2.source_path_id, jc2.target_path_id
                    FROM ${dbSchema}.jobrun jr2
                    JOIN ${dbSchema}.jobconfig jc2 ON jr2.job_config_id = jc2.id
                    WHERE jr2.id = $1
                )
                ORDER BY jr.start_time DESC
            ),
            latest_file_versions AS (
                SELECT DISTINCT ON (i.path)
                    i.path AS _cursor_path,
                    COALESCE(v_source.volume_path, '') || i.path as "Source Path",
                    v_target.volume_path || i.path as "Destination Path",
                    i.source_checksum as "Source Checksum",
                    i.target_checksum as "Destination Checksum",
                    CASE
                        WHEN i.source_checksum = i.target_checksum THEN 'yes'
                        ELSE 'no'
                    END AS "ChecksumMatchStatus",
                    TO_CHAR(i.checksum_time AT TIME ZONE 'UTC', 'Dy Mon DD YYYY HH24:MI:SS') as "Checksum Generated Timestamp (UTC)",
                    CASE
                        WHEN UPPER(TRIM(COALESCE(i.file_type, ''))) = 'SYMBOLIC_LINK' THEN 'softlink'
                        WHEN i.is_directory THEN 'directory'
                        ELSE 'file'
                    END AS "Type",
                    FIRST_VALUE(i.is_deleted) OVER (
                        PARTITION BY i.path 
                        ORDER BY arj.start_time DESC
                    ) as latest_deletion_status
                FROM ${dbSchema}.inventory i
                JOIN all_related_jobs arj ON i.job_run_id = arj.id
                JOIN ${dbSchema}.jobrun jr ON jr.id = i.job_run_id
                JOIN ${dbSchema}.jobconfig jc ON jc.id = jr.job_config_id
                LEFT JOIN ${dbSchema}.volume v_source ON jc.source_path_id = v_source.id
                LEFT JOIN ${dbSchema}.volume v_target ON jc.target_path_id = v_target.id
                WHERE i.is_directory = false
                  AND ($2::text IS NULL OR i.path > $2)
                ORDER BY i.path, 
                         CASE WHEN i.is_deleted = true THEN 1 ELSE 0 END,
                         CASE WHEN i.source_checksum IS NOT NULL AND i.target_checksum IS NOT NULL THEN 0 ELSE 1 END,
                         arj.start_time DESC
            )
            SELECT 
                _cursor_path,
                "Source Path",
                "Destination Path",
                "Source Checksum",
                "Destination Checksum",
                "ChecksumMatchStatus",
                "Checksum Generated Timestamp (UTC)",
                "Type"
            FROM latest_file_versions
            WHERE (latest_deletion_status = false OR latest_deletion_status IS NULL)
            ORDER BY _cursor_path
            LIMIT $3;
        `;
        return { query, values: [jobRunId, cursor, limit] };
    }

    getMigrationCoCColumns(protocol: string, includeCocStatusColumns: boolean = false): string {
        const statusColumns = includeCocStatusColumns
            ? `
            COALESCE(i.copy_content_status, '') as "CopyContentStatus",
            COALESCE(i.stamp_meta_data_status, '') as "StampMetaDataStatus",`
            : '';
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
            TO_CHAR(i.checksum_time AT TIME ZONE 'UTC', 'Dy Mon DD YYYY HH24:MI:SS') as "Checksum Generated Timestamp (UTC)",${statusColumns}${statusColumns ? '' : ','}
            CASE
                WHEN UPPER(TRIM(COALESCE(i.file_type, ''))) = 'SYMBOLIC_LINK' THEN 'softlink'
                WHEN i.is_directory THEN 'directory'
                ELSE 'file'
            END AS "Type",
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