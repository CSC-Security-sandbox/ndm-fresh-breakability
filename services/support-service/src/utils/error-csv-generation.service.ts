import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationErrorEntity } from '../entities/operation-error.entity';
import { OperationErrorExportData } from 'src/constants/types';
import { GET_OPERATION_ERRORS_BY_DATE_RANGE, USER_VISIBLE_ERROR_TYPES } from 'src/constants/sql-queries';

@Injectable()
export class OperationErrorService {
  constructor(
    @InjectRepository(OperationErrorEntity)
    private operationErrorRepo: Repository<OperationErrorEntity>,
  ) {}

  /**
     * Fetch operation errors for given project IDs and date range using raw SQL
     */

  async getOperationErrorsByProjectAndDateRange(
    projectIds: string[],
    startDate: string,
    endDate: string,
  ): Promise<OperationErrorExportData[]> {
    return await this.operationErrorRepo.query(GET_OPERATION_ERRORS_BY_DATE_RANGE, [
      projectIds,
      startDate,
      endDate,
      [...USER_VISIBLE_ERROR_TYPES],
    ]);
  }
}
