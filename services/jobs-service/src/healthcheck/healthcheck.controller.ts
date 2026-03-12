import {
  Body,
  Controller,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  Post,
  Req,
} from '@nestjs/common';
import { getErrorMessage } from '../utils/error-message';
import { HealthcheckService } from './healthcheck.service';
import { HealthcheckStats } from './dto/healthcheck.dto';
import { HealthCheckResponse } from './dto/healthcheck-response.dto';
import { AuthWorker } from '@netapp-cloud-datamigrate/auth-lib';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

/** Request shape after AuthWorker guard (adds worker_id) */
export interface HealthCheckRequest {
  worker_id?: string;
}

@ApiTags('jobs')
@Controller('statscheck')
export class HealthcheckController {
  private readonly logger: LoggerService;

  constructor(
    private healthcheckService: HealthcheckService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(HealthcheckController.name);
  }

  @Post('/')
  @AuthWorker()
  @ApiBearerAuth()
  async healthCheck(
    @Body() healthStats: HealthcheckStats,
    @Req() req: HealthCheckRequest,
  ): Promise<HealthCheckResponse> {
    try {
      this.logger.log(
        `Received health check stats from worker: ${req.worker_id}`,
      );
      await this.healthcheckService.createOrUpdateHealthCheckStats(healthStats);
      return this.createResponse(HttpStatus.OK);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      this.logger.error(
        'Error creating or updating health check stats:',
        message,
      );
      throw new InternalServerErrorException(
        `Error creating or updating health check stats: ${message}`,
      );
    }
  }

  createResponse(statusCode: number): HealthCheckResponse {
    return {
      statusCode,
    };
  }
}
