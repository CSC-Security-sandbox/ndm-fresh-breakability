import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationErrorEntity } from '../entities/operation-error.entity';
import { OperationErrorExportData } from 'src/constants/types';

@Injectable()
export class OperationErrorService {
  constructor(
    @InjectRepository(OperationErrorEntity)
    private operationErrorRepo: Repository<OperationErrorEntity>,
  ) { }

  /**
   * Fetch operation errors for given date range using raw SQL
   */
  async getOperationErrorsByDateRange(
    startDate: string,
    endDate: string,
  ): Promise<OperationErrorExportData[]> {
    const query = `
      SELECT 
        oe.id,
        oe.operation_id as "operationId",
        oe.error_code as "errorCode",
        oe.error_message as "errorMessage",
        oe.created_at as "createdAt",
        oe.file_name as "fileName",
        oe.file_path as "filePath",
        oe.error_type as "errorType",
        oe.operation_type as "operationType",
        oe.origin,
        p.id as "projectId",
        p.project_name as "projectName"
      FROM datamigrator.operation_errors oe
      INNER JOIN datamigrator.operations o ON oe.operation_id = o.id
      INNER JOIN datamigrator.jobrun jr ON o.job_run_id = jr.id
      INNER JOIN datamigrator.jobconfig jc ON jr.job_config_id = jc.id
      INNER JOIN datamigrator.config c ON c.id IN (
        SELECT config_id FROM datamigrator.file_server fs 
        WHERE fs.id IN (
          SELECT file_server_id FROM datamigrator.volume v
          WHERE v.id = jc.source_path_id OR v.id = jc.target_path_id
        )
      )
      INNER JOIN datamigrator.project p ON c.project_id = p.id
      WHERE DATE(oe.created_at) >= $1
        AND DATE(oe.created_at) <= $2
      ORDER BY DATE(oe.created_at), oe.created_at, p.id
    `;

    return await this.operationErrorRepo.query(query, [
      startDate,
      endDate,
    ]);
  }
}
