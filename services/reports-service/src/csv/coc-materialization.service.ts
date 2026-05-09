import { Injectable, Logger, Inject, Optional, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COC_CUTOVER_TABLE_PREFIX = 'coc_cutover_temp';

/** SMB ACE-block extraction patterns — kept in sync with CsvService.ACE_*. */
const ACE_SOURCE_PREFIX = 'ACE in source:';
const ACE_TARGET_PREFIX = 'ACE in target:';
const ACE_SOURCE_PATTERN = 'ACE in source:.*$';
const ACE_TARGET_PATTERN = 'ACE in target:.*$';

/** Session advisory lock key1 (arbitrary namespace; pair with hashtext(jobRunId) as key2). */
const COC_CUTOVER_LOCK_KEY = 913_740_281;

@Injectable()
export class CocMaterializationService {
  private readonly logger: LoggerService | Logger;

  constructor(
    private readonly dataSource: DataSource,
    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory,
  ) {
    this.logger = loggerFactory
      ? loggerFactory.create(CocMaterializationService.name)
      : new Logger(CocMaterializationService.name);
  }

  isEnabled(): boolean {
    return (process.env.USE_MATERIALIZED_CUTOVER ?? 'true').toLowerCase() !== 'false';
  }

  /**
   * Unlogged table :  table with no WAL. So no extra space occupied for WAL
   *
   * Builds or Returns the existing unlogged table containing the resolved
   * cutover inventory for a single jobRun's lineage. The table holds one row
   * per surviving path with all projection transforms baked in, indexed by
   * `path` (PK) for O(log n) keyset reads.
   *
   * Idempotent + crash-safe:
   *   - exists with rows > 0   -> reuse (resume path)
   *   - exists empty / partial -> drop + rebuild (build crashed mid-INSERT)
   *   - not exists             -> build
   *
   * Concurrency: `CREATE` / `INSERT` / `ANALYZE` run as separate commits on a
   * dedicated connection, with a session advisory lock held for the whole
   * build so pooled connections cannot inherit a stuck lock. A lockless fast
   * path skips the dedicated connection when the table already has rows.
   *
   * Suffixes are baked into source_path/destination_path. They're derived
   * from the immutable jobConfig directory paths, so they can't drift across
   * resume calls for the same jobRun.
   *
   *  SESSION LEVEL LOCK: A session-level advisory lock is tied to the database session (connection),
   *  not to the current SQL transaction.
   *
   * CAUTION/NOTE : IF YOU USE CONNECTION POOLING, THIS SESSION LOCK CAN BREAK.
   */
  async ensureCutoverInventoryMaterialized(
    jobRunId: string,
    sourceDirSuffix: string,
    targetDirSuffix: string,
  ): Promise<string> {
    this.assertUuid(jobRunId);
    const schema = process.env.SCHEMA;
    const tableName = this.tableNameFor(jobRunId);
    const fq = `${schema}.${this.quoteIdent(tableName)}`;

    const reused = await this.tryReuseMaterializedTable(schema, tableName, fq, jobRunId);
    if (reused !== null) {
      return reused;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      await queryRunner.query(`SELECT pg_advisory_lock($1::integer, hashtext($2::text))`, [
        COC_CUTOVER_LOCK_KEY,
        jobRunId,
      ]);

      const exists = await queryRunner.query(
        'SELECT to_regclass($1) IS NOT NULL AS exists',
        [`${schema}.${tableName}`],
      );
      if (exists[0]?.exists) {
        const cnt = await queryRunner.query(`SELECT count(*)::bigint AS c FROM ${fq}`);
        const rowCount = Number(cnt[0]?.c ?? 0);
        if (rowCount > 0) {
          this.logger.log(
            `Reusing materialized cutover table ${fq} (rows=${rowCount}) for jobRunId=${jobRunId}`,
          );
          return fq;
        }
        this.logger.warn(
          `Empty materialized cutover table ${fq} found for jobRunId=${jobRunId}; rebuilding`,
        );
        await queryRunner.query(`DROP TABLE ${fq}`);
      }

      this.logger.log(`Building materialized cutover table ${fq} for jobRunId=${jobRunId}`);
      const buildStart = Date.now();

      // Schema is protocol-agnostic: holds both NFS and SMB metadata columns.
      // The read query in CsvService projects only the protocol-relevant subset.
      // This keeps the build path simple (no protocol param) and lets a single
      // table serve any protocol the lineage might end up rendering as.
      await queryRunner.query(
        `CREATE UNLOGGED TABLE ${fq} (
           path                          text PRIMARY KEY,
           source_path                   text NOT NULL,
           destination_path              text NOT NULL,
           source_checksum               text,
           destination_checksum          text,
           checksum_match_status         text,
           checksum_generated_ts_utc     text,
           copy_content_status           text,
           stamp_meta_data_status        text,
           type                          text,
           file_size                     bigint,
           -- NFS-specific (NULL for SMB rows)
           source_uid                    text,
           destination_uid               text,
           source_gid                    text,
           destination_gid               text,
           source_unix_permissions       text,
           destination_unix_permissions  text,
           -- SMB-specific (NULL for NFS rows)
           source_owner_sid              text,
           source_group_sid              text,
           source_ace_details            text,
           target_owner_sid              text,
           target_group_sid              text,
           target_ace_details            text
         )`,
      );

      // Build query — bakes every transform at build time so paginated reads
      // are pure column copies. Both NFS and SMB columns are populated from
      // the same row; the off-protocol columns naturally come back NULL
      // (regex_match returns NULL on no match; jsonb ->> returns NULL on
      // missing keys). Verified row-for-row equivalent to the original
      // getCutoverInventoryDataQuery for the 8 columns it produced.
      await queryRunner.query(
        `INSERT INTO ${fq}
         WITH all_related_jobs AS (
           SELECT jr.id, jr.start_time
           FROM ${schema}.jobrun jr
           JOIN ${schema}.jobconfig jc ON jr.job_config_id = jc.id
           WHERE (jc.source_path_id, jc.target_path_id) = (
             SELECT jc2.source_path_id, jc2.target_path_id
             FROM ${schema}.jobrun jr2
             JOIN ${schema}.jobconfig jc2 ON jr2.job_config_id = jc2.id
             WHERE jr2.id = $1
           )
         ),
         latest_file_versions AS (
           SELECT DISTINCT ON (i.path)
             i.path AS path,
             COALESCE(v_source.volume_path, '') || $2 || i.path AS source_path,
             COALESCE(v_target.volume_path, '') || $3 || i.path AS destination_path,
             i.source_checksum AS source_checksum,
             i.target_checksum AS destination_checksum,
             CASE WHEN i.source_checksum = i.target_checksum THEN 'yes' ELSE 'no' END AS checksum_match_status,
             TO_CHAR(i.checksum_time AT TIME ZONE 'UTC', 'Dy Mon DD YYYY HH24:MI:SS') AS checksum_generated_ts_utc,
             COALESCE(i.copy_content_status, '')      AS copy_content_status,
             COALESCE(i.stamp_meta_data_status, '')   AS stamp_meta_data_status,
             CASE
               WHEN UPPER(TRIM(COALESCE(i.file_type, ''))) = 'SYMBOLIC_LINK' THEN 'softlink'
               WHEN i.is_directory THEN 'directory'
               ELSE 'file'
             END AS type,
             i.file_size AS file_size,
             -- NFS columns (NULL for SMB rows)
             i.source_meta->>'uid'                    AS source_uid,
             i.target_meta->>'uid'                    AS destination_uid,
             i.source_meta->>'gid'                    AS source_gid,
             i.target_meta->>'gid'                    AS destination_gid,
             i.source_meta->>'permission'             AS source_unix_permissions,
             i.target_meta->>'permission'             AS destination_unix_permissions,
             -- SMB columns (NULL for NFS rows)
             (regexp_match(i.source_meta->>'sid', 'Owner: (S-[0-9-]+)'))[1] AS source_owner_sid,
             (regexp_match(i.source_meta->>'sid', 'Group: (S-[0-9-]+)'))[1] AS source_group_sid,
             regexp_replace(
               substring(i.source_meta->>'sid' FROM '${ACE_SOURCE_PATTERN}'),
               '${ACE_SOURCE_PREFIX} ', '', 'g'
             ) AS source_ace_details,
             (regexp_match(i.target_meta->>'sid', 'Owner: (S-[0-9-]+)'))[1] AS target_owner_sid,
             (regexp_match(i.target_meta->>'sid', 'Group: (S-[0-9-]+)'))[1] AS target_group_sid,
             regexp_replace(
               substring(i.target_meta->>'sid' FROM '${ACE_TARGET_PATTERN}'),
               '${ACE_TARGET_PREFIX} ', '', 'g'
             ) AS target_ace_details,
             FIRST_VALUE(i.is_deleted) OVER (
               PARTITION BY i.path ORDER BY arj.start_time DESC
             ) AS latest_deletion_status
           FROM ${schema}.inventory i
           JOIN all_related_jobs arj ON i.job_run_id = arj.id
           JOIN ${schema}.jobrun jr ON jr.id = i.job_run_id
           JOIN ${schema}.jobconfig jc ON jc.id = jr.job_config_id
           LEFT JOIN ${schema}.volume v_source ON jc.source_path_id = v_source.id
           LEFT JOIN ${schema}.volume v_target ON jc.target_path_id = v_target.id
           WHERE i.is_directory = false
             AND (i.entry_type IS NULL OR i.entry_type = 'inventory')
           ORDER BY i.path,
                    CASE WHEN i.is_deleted = true THEN 1 ELSE 0 END,
                    CASE WHEN NULLIF(TRIM(i.source_checksum), '') IS NOT NULL
                              AND NULLIF(TRIM(i.target_checksum), '') IS NOT NULL
                         THEN 0 ELSE 1 END,
                    arj.start_time DESC
         )
         SELECT
           path, source_path, destination_path,
           source_checksum, destination_checksum,
           checksum_match_status, checksum_generated_ts_utc,
           copy_content_status, stamp_meta_data_status,
           type, file_size,
           source_uid, destination_uid, source_gid, destination_gid,
           source_unix_permissions, destination_unix_permissions,
           source_owner_sid, source_group_sid, source_ace_details,
           target_owner_sid, target_group_sid, target_ace_details
         FROM latest_file_versions
         WHERE (latest_deletion_status = false OR latest_deletion_status IS NULL)`,
        [jobRunId, sourceDirSuffix ?? '', targetDirSuffix ?? ''],
      );

      await queryRunner.query(`ANALYZE ${fq}`);

      const cnt = await queryRunner.query(`SELECT count(*)::bigint AS c FROM ${fq}`);
      this.logger.log(
        `Built materialized cutover table ${fq} for jobRunId=${jobRunId}: rows=${cnt[0]?.c}, took ${Date.now() - buildStart}ms`,
      );
      return fq;
    } finally {
      try {
        await queryRunner.query(`SELECT pg_advisory_unlock($1::integer, hashtext($2::text))`, [
          COC_CUTOVER_LOCK_KEY,
          jobRunId,
        ]);
      } catch (unlockErr) {
        this.logger.warn(
          `pg_advisory_unlock failed for jobRunId=${jobRunId}: ${(unlockErr as Error).message}`,
        );
      }
      await queryRunner.release();
    }
  }

  private async tryReuseMaterializedTable(
    schema: string,
    tableName: string,
    fq: string,
    jobRunId: string,
  ): Promise<string | null> {
    const exists = await this.dataSource.query(
      'SELECT to_regclass($1) IS NOT NULL AS exists',
      [`${schema}.${tableName}`],
    );
    if (!exists[0]?.exists) {
      return null;
    }
    const cnt = await this.dataSource.query(`SELECT count(*)::bigint AS c FROM ${fq}`);
    const rowCount = Number(cnt[0]?.c ?? 0);
    if (rowCount > 0) {
      this.logger.log(
        `Reusing materialized cutover table ${fq} (rows=${rowCount}) for jobRunId=${jobRunId}`,
      );
      return fq;
    }
    return null;
  }

  /** We will try to drop and log error and never throw. Orphan cleanup will catch this if not done here. */
  async dropMaterialized(jobRunId: string): Promise<void> {
    if (!UUID_RE.test(jobRunId)) return;
    const schema = process.env.SCHEMA;
    const fq = `${schema}.${this.quoteIdent(this.tableNameFor(jobRunId))}`;
    try {
      await this.dataSource.query(`DROP TABLE IF EXISTS ${fq}`);
      this.logger.log(`Dropped materialized cutover table ${fq} for jobRunId=${jobRunId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to drop materialized cutover table ${fq} for jobRunId=${jobRunId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Hourly orphan sweep: drop materialized tables whose jobRun already has a
   * saved COC report (i.e. ZIP was produced — table is no longer needed).
   * Runs cheaply: 1 metadata query + N small DROPs.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async dropOrphans(): Promise<number> {
    if (!this.isEnabled()) return 0;
    const schema = process.env.SCHEMA;
    try {
      // Match both current prefix and legacy `coc_cutover_*` tables left over
      // from prior schema versions, so a prefix bump never strands old tables.
      const rows: { tablename: string }[] = await this.dataSource.query(
        `SELECT t.tablename
         FROM pg_tables t
         JOIN ${schema}.reports rep
           ON rep.report_type = 'COC'
          AND rep.job_run_id = (
            replace(substring(t.tablename FROM $2), '_', '-')
          )::uuid
         WHERE t.schemaname = $1
           AND t.tablename LIKE 'coc_cutover_%'`,
        [
          schema,
          `^(?:coc_cutover_temp)_(.+)$`,
        ],
      );
      let dropped = 0;
      for (const r of rows) {
        try {
          await this.dataSource.query(
            `DROP TABLE IF EXISTS ${schema}.${this.quoteIdent(r.tablename)}`,
          );
          dropped++;
        } catch (err) {
          this.logger.warn(
            `Orphan drop failed for ${r.tablename}: ${(err as Error).message}`,
          );
        }
      }
      if (dropped > 0) {
        this.logger.log(`Orphan-cleanup: dropped ${dropped} materialized cutover table(s)`);
      }
      return dropped;
    } catch (err) {
      this.logger.warn(`Orphan-cleanup sweep failed: ${(err as Error).message}`);
      return 0;
    }
  }



  private assertUuid(id: string): void {
    if (!UUID_RE.test(id)) {
      throw new BadRequestException(`Invalid jobRunId (expected UUID): ${id}`);
    }
  }

  private tableNameFor(jobRunId: string): string {
    // UUID format guarantees a-f0-9 + hyphens; replace hyphens with underscores.
    return `${COC_CUTOVER_TABLE_PREFIX}_${jobRunId.replace(/-/g, '_')}`;
  }

  private quoteIdent(s: string): string {
    return `"${s.replace(/"/g, '""')}"`;
  }

}
