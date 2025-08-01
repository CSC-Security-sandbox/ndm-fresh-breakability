import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationErrorEntity } from '../entities/operation-error.entity';
import { OperationErrorExportData } from 'src/constants/types';
import { GET_OPERATION_ERRORS_BY_DATE_RANGE } from 'src/constants/sql-queries';

@Injectable()
export class OperationErrorService {
  constructor(
    @InjectRepository(OperationErrorEntity)
    private operationErrorRepo: Repository<OperationErrorEntity>,
  ) {}

  // Fetches operation errors for given date range using raw SQL

  async getOperationErrorsByDateRange(
    startDate: string,
    endDate: string,
  ): Promise<OperationErrorExportData[]> {
    return await this.operationErrorRepo.query(GET_OPERATION_ERRORS_BY_DATE_RANGE, [
      startDate,
      endDate,
    ]);
  }
}
