import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ErrorRemedyEntity } from '../entities/error-remedies.entity';
import { OperationErrorEntity } from 'src/entities/operation-error.entity';
import { USER_VISIBLE_ERROR_TYPES } from 'src/constants/enums';

@Injectable()
export class ErrorRemedyService {
  constructor(
    @InjectRepository(ErrorRemedyEntity)
    private readonly errorRemedyRepository: Repository<ErrorRemedyEntity>,

    @InjectRepository(OperationErrorEntity)
    private readonly operationErrorRepository: Repository<OperationErrorEntity>,
  ) {}

  async findByErrorCodes(codes: string[]): Promise<ErrorRemedyEntity[]> {
    return this.errorRemedyRepository.find({
      where: {
        errorCode: In(codes),
      },
    });
  }

  async findByErrorCode(code: string): Promise<ErrorRemedyEntity | undefined> {
    return this.errorRemedyRepository.findOne({
      where: {
        errorCode: code,
      },
    });
  }

  async getDistinctErrorCodes(jobRunId: string): Promise<{ errorCode: string }[]> {
    const errorCodes = await this.operationErrorRepository
      .createQueryBuilder('oe')
      .innerJoin("oe.operation", "o")
      .where("o.jobRunId = :jobRunId", { jobRunId })
      .andWhere("oe.errorType IN (:...errorTypes)", { errorTypes: USER_VISIBLE_ERROR_TYPES })
      .select('DISTINCT oe.errorCode', 'errorCode')
      .groupBy("oe.errorType, oe.errorCode")
      .getRawMany();
    return errorCodes
  };
}
