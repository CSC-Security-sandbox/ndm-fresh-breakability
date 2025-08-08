import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ErrorRemedyEntity } from '../entities/error-remedies.entity';
import { OperationErrorEntity } from 'src/entities/operation-error.entity';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class ErrorRemedyService {
  private logger: LoggerService;
  constructor(
    @InjectRepository(ErrorRemedyEntity)
    private readonly errorRemedyRepository: Repository<ErrorRemedyEntity>,

    @InjectRepository(OperationErrorEntity)
    private readonly operationErrorRepository: Repository<OperationErrorEntity>,

    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(ErrorRemedyService.name);
  }

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
      .select('DISTINCT oe.errorCode', 'errorCode')
      .groupBy("oe.errorType, oe.errorCode")
      .getRawMany();
    return errorCodes
  };
}
