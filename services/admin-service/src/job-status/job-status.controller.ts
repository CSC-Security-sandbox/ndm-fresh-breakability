import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { JobStatusService } from './job-status.service';
import { JobStatusResponseDto } from './dto/job-status-response.dto';

@ApiTags('job-status')
@Controller('/api/v1/job-status')
export class JobStatusController {
  private readonly logger: LoggerService;

  constructor(
    private readonly jobStatusService: JobStatusService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(JobStatusController.name);
  }

  @Auth(Permission.ManageJob)
  @ApiBearerAuth()
  @Get()
  @ApiOperation({
    summary: 'Get running and scheduled job status',
    description:
      'Returns a list of all currently running migration jobs and all active scheduled jobs. ' +
      'This endpoint is restricted to users with the ManageJob (admin) permission.',
  })
  @ApiResponse({
    status: 200,
    description: 'Job status overview retrieved successfully',
    type: JobStatusResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — invalid or missing JWT token',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — user does not have ManageJob permission',
  })
  async getJobStatus(): Promise<JobStatusResponseDto> {
    this.logger.log('GET job status request received');
    return this.jobStatusService.getJobStatus();
  }
}
