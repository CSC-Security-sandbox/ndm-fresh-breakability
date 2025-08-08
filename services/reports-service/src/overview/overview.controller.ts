import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { OverviewService } from './overview.service';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OverviewDTO } from './overview.dto';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { In } from 'typeorm';

@Controller('overview')
export class OverviewController {
  private logger: LoggerService;
  downloadReports(arg0: undefined[], arg1: string): any {
    throw new Error('Method not implemented.');
  }
  constructor(private readonly overviewService: OverviewService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(OverviewController.name);
  }

  @ApiTags('overview')
  @ApiOperation({ summary: 'Get Storage and Jobs Overview' })
  @ApiResponse({ status: 200, description: 'Returns the storage and job overview details.' })
  @ApiResponse({ status: 404, description: 'Required parameters are missing in the request.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @ApiOkResponse({ description: 'Configuration Found', type: OverviewDTO })
  @ApiQuery({ name: 'projectId', required: false, type: String, description: 'Project Id' })
  @ApiQuery({ name: 'fileServerId', required: false, type: String, description: 'File Server Id' })
  @ApiQuery({ name: 'jobConfigId', required: false, type: String, description: 'Job Config Id' })
  @ApiBearerAuth()
  @Auth(Permission.Reports)
  @Get()
  async getStorageAndJobsOverview(
    @Query('projectId') projectId: string,
    @Query('fileServerId') configId: string,
    @Query('jobConfigId') jobConfigId: string,
  ) {
    if (!projectId && !configId && !jobConfigId) {
      throw new BadRequestException(`Required parameters['ProjectId or configId or JobConfig Id ' are missing in the request`);
    }
    return await this.overviewService.getStorageAndJobsOverview(projectId, configId, jobConfigId);
  }
}
