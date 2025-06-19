import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as fastCsv from 'fast-csv';
import { filePathValidation } from 'src/utils/filepath-validation';

@Injectable()
export class CsvService {
    private readonly logger = new Logger("CSV file");

    constructor(private readonly dataSource: DataSource) { }

    async generateCsv(filePath: string, jobRunId: string, batchSize: number = 10000) {
        // const sanitizedFilePath = filePath.replace(/[^a-zA-Z0-9_\-./]/g, '');
        const sanitisedFilePath = filePathValidation(filePath);
        this.logger.log("sanitised file", filePath);
        if (sanitisedFilePath !== filePath) {
            throw new Error('File path contains invalid characters.');
        }
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        try {
            const fileStream = fs.createWriteStream(filePath); //three
            const csvStream = fastCsv.format({ headers: true });
            csvStream.pipe(fileStream);
            let offset = 1;

            while (true) {
                const result = await this.getInventoryData(jobRunId, batchSize, offset);
                if (result.length === 0) break;
                for (const row of result) {
                    csvStream.write(row);
                }
                offset++;
            }
            csvStream.end();
        } catch (err) {
            console.error('Error:', err);
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
                v_source.volume_path || i.path as "source path",
                v_target.volume_path || i.path as "target path",
                jc.job_type AS "Migration Type",
                i.created_at AS "start time",
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
                file_size as "size",
                source_checksum as "source checksum",
                target_checksum as "target checksum",
                CASE 
                    WHEN count(iccm.id) > 0 THEN 'Yes'
                    ELSE 'No'
                END AS "External mapping file used"
            FROM ${dbSchema}.inventory i
            LEFT JOIN ${dbSchema}.jobrun ON jobrun.id = i.job_run_id
            LEFT JOIN ${dbSchema}.jobconfig jc ON jc.id = jobrun.job_config_id
            LEFT JOIN ${dbSchema}.volume v_source ON jc.source_path_id = v_source.id
            LEFT JOIN ${dbSchema}.volume v_target ON jc.target_path_id = v_target.id
            LEFT JOIN ${dbSchema}.identity_config_cross_mapping iccm ON iccm.job_config_id = jc.id
            WHERE job_run_id = $1
            GROUP BY v_source.volume_path, v_target.volume_path, i.path, jc.job_type, i.created_at, i.updated_at, i.is_directory, i.source_checksum, i.target_checksum, i.file_size
            ORDER BY i.created_at DESC
            LIMIT $2 OFFSET ($3 - 1) * $2;
        `;
        return { query, values: [jobRunId, limit, offset] };
    }
}