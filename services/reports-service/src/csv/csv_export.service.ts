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

export const CSV_FILE_NAMES = {
    COC: 'coc-report.csv',
    EXCLUDED: 'excluded-report.csv',
    SKIPPED: 'skipped-report.csv',
    DELETED: 'deleted-report.csv',
} as const;

export type CocBundleFileEntry =
    | { readonly fileName: string; readonly kind: 'inventory' }
    | {
        readonly fileName: string;
        readonly kind: 'list';
        readonly listType: 'excluded' | 'skipped' | 'deleted';
    };

export const COC_BUNDLE_ENTRIES: readonly CocBundleFileEntry[] = [
    { fileName: CSV_FILE_NAMES.COC, kind: 'inventory' },
    { fileName: CSV_FILE_NAMES.EXCLUDED, kind: 'list', listType: 'excluded' },
    { fileName: CSV_FILE_NAMES.SKIPPED, kind: 'list', listType: 'skipped' },
    { fileName: CSV_FILE_NAMES.DELETED, kind: 'list', listType: 'deleted' },
];

interface CsvStrategy {
    fetchBatch: (limit: number, cursor: string | null) => Promise<any[]>;
    nextCursor: (lastRow: any) => string | null;
    toRow: (raw: any) => Record<string, any>;
}

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
            this.logger = new Logger(CsvService.name);
        }
    }

    async generateCsv(filePath: string, jobRunId: string, batchSize: number = 50000, jobType?: string, resumeCursor?: string | null) {
        const protocol = await this.getProtocolForJobRun(jobRunId);
        const strategy: CsvStrategy = {
            fetchBatch: (limit, cursor) => this.getInventoryData(jobRunId, limit, cursor, jobType, protocol),
            nextCursor: (lastRow) => lastRow['_cursor_path'],
            toRow: ({ _cursor_path, ...csvRow }) => csvRow,
        };
        await this.generateCsvCore(filePath, jobRunId, batchSize, resumeCursor, strategy);
    }

    async generateListCsv(
        filePath: string,
        jobRunId: string,
        type: 'excluded' | 'skipped' | 'deleted',
        batchSize: number = 10000,
        resumeCursor?: string | null,
    ) {
        const strategy: CsvStrategy = {
            fetchBatch: async (limit, cursor) => {
                const q = await this.getListEntriesQuery(jobRunId, limit, cursor, type);
                return this.dataSource.query(q.query, q.values);
            },
            nextCursor: (lastRow) => lastRow?.Path ?? null,
            toRow: (row) => ({ 'Source Path': row['Source Path'] }),
        };
        await this.generateCsvCore(filePath, jobRunId, batchSize, resumeCursor, strategy);
    }

    private async generateCsvCore(
        filePath: string,
        jobRunId: string,
        batchSize: number,
        resumeCursor: string | null | undefined,
        strategy: CsvStrategy,
    ) {
        const projectId = await this.projectIdCacheService.getProjectIdFromCache(jobRunId);
        const isResume = resumeCursor !== null && resumeCursor !== undefined && resumeCursor !== '';
        this.logger.log(
            `projectId: ${projectId} ${isResume ? 'Resuming' : 'Starting'} CSV generation for jobRunId: ${jobRunId}, filePath: ${filePath}${isResume ? `, cursor: ${resumeCursor}` : ''}`,
        );

        if (!validateFilePath(filePath)) {
            this.logger.error(`projectId: ${projectId} File path contains invalid characters: ${filePath}`);
            throw new Error('File path contains invalid characters.');
        } else {
            this.logger.log(`projectId: ${projectId} File path validation passed: ${filePath}`);
        }

        let fileStream: fs.WriteStream | undefined;
        let csvStream: ReturnType<typeof fastCsv.format> | undefined;
        try {
            fileStream = isResume
                ? fs.createWriteStream(filePath, { flags: 'a' })
                : fs.createWriteStream(filePath);
            csvStream = fastCsv.format({ headers: !isResume });

            const streamDone = new Promise<void>((resolve, reject) => {
                fileStream!.once('finish', resolve);
                fileStream!.once('error', reject);
                csvStream!.once('error', reject);
            });

            csvStream.pipe(fileStream);

            let totalRecords = 0;
            let cursor: string | null = resumeCursor ?? null;

            while (true) {
                const result = await strategy.fetchBatch(batchSize, cursor);
                if (!result || result.length === 0) break;
                for (const row of result) {
                    const csvRow = strategy.toRow(row);
                    if (!csvStream.write(csvRow)) {
                        await new Promise<void>(resolve => csvStream!.once('drain', resolve));
                    }
                }

                totalRecords += result.length;
                cursor = strategy.nextCursor(result[result.length - 1]);

                if (totalRecords % (batchSize * 10) === 0) {
                    this.logger.log(`projectId: ${projectId} Processed ${totalRecords} records so far for jobRunId: ${jobRunId}`);
                }
            }

            csvStream.end();
            await streamDone;
            this.logger.log(`projectId: ${projectId} CSV generation completed for jobRunId: ${jobRunId}, total records: ${totalRecords}`);
        } catch (err) {
            this.logger.error(`projectId: ${projectId} Error generating CSV for jobRunId: ${jobRunId}: ${err.message}`, err?.stack || err);
            throw err;
        } finally {
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
          AND (i.entry_type IS NULL OR i.entry_type = 'inventory')
        AND ($2::text IS NULL OR i.path > $2::text)
            ORDER BY i.path
            LIMIT $3;
    `;
        return { query, values: [jobRunId, cursor, limit] };
    }

    async getListEntriesQuery(jobRunId: string, limit: number, cursor: string | null, kind: 'excluded' | 'skipped' | 'deleted') {
        const dbSchema = process.env.SCHEMA;
        let filter: string;
        switch (kind) {
            case 'excluded':
                filter = `i.entry_type = 'excluded'`;
                break;
            case 'skipped':
                filter = `i.entry_type = 'skipped'`;
                break;
            case 'deleted':
                filter = `(i.is_deleted = true)`;
                break;
        }
        const query = `
            SELECT
                COALESCE(v_source.volume_path, '') || i.path AS "Source Path",
                i.path AS "Path"
            FROM ${dbSchema}.inventory i
            LEFT JOIN ${dbSchema}.jobrun jr ON jr.id = i.job_run_id
            LEFT JOIN ${dbSchema}.jobconfig jc ON jc.id = jr.job_config_id
            LEFT JOIN ${dbSchema}.volume v_source ON jc.source_path_id = v_source.id
            WHERE i.job_run_id = $1
              AND ${filter}
              AND ($2::text IS NULL OR i.path > $2::text)
            ORDER BY i.path
            LIMIT $3
        `;
        return { query, values: [jobRunId, cursor, limit] };
    }

    async getExcludedEntriesQuery(jobRunId: string, limit: number, cursor: string | null) {
        return this.getListEntriesQuery(jobRunId, limit, cursor, 'excluded');
    }

    async getSkippedEntriesQuery(jobRunId: string, limit: number, cursor: string | null) {
        return this.getListEntriesQuery(jobRunId, limit, cursor, 'skipped');
    }

    async getDeletedEntriesQuery(jobRunId: string, limit: number, cursor: string | null) {
        return this.getListEntriesQuery(jobRunId, limit, cursor, 'deleted');
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
                  AND (i.entry_type IS NULL OR i.entry_type = 'inventory')
                  AND ($2::text IS NULL OR i.path > $2::text)
                ORDER BY i.path, 
                         CASE WHEN i.is_deleted = true THEN 1 ELSE 0 END,
                         CASE WHEN NULLIF(TRIM(i.source_checksum), '') IS NOT NULL
                                   AND NULLIF(TRIM(i.target_checksum), '') IS NOT NULL
                              THEN 0 ELSE 1 END,
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