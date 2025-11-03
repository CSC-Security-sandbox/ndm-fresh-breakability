import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import {
  Auth,
  AuthWorker,
  Permission,
} from '@netapp-cloud-datamigrate/auth-lib';
import { WorkerConfiguration } from 'src/constants/types';
import { ClientIp } from 'src/middleware/clientip';
import { WorkManagerService } from './work-manager.service';
import { CreateRequestDto } from './dto/validate-connection.dto';
import { ConfigStatusPayloadDTO } from './dto/validate-export-path.dto';

@Controller('work-manager')
export class WorkManagerController {
  readonly logger = new Logger(WorkManagerController.name);
  constructor(private workManagerService: WorkManagerService) {}

  @ApiOperation({ summary: 'Get Configuration by ID' })
  @ApiOkResponse({
    description: 'Configuration Found',
    type: WorkerConfiguration,
  })
  @ApiNotFoundResponse({ description: 'Configuration Not Found' })
  @AuthWorker()
  @Post('config')
  @ApiBody({
    description: 'Worker configuration request with environment variables',
    required: true,
  })
  async getConfiguration(
    @ClientIp() ip: string,
    @Req() req: any,
    @Body() body: any,
  ): Promise<WorkerConfiguration[]> {
    this.logger.debug(
      `Fetching configuration for worker ID: ${req['worker_id']} from IP: ${ip} for project ID: ${req['project_id']} on platform: ${req?.headers['x-client-platform']}`,
    );
    return await this.workManagerService.getConfiguration(
      req['worker_id'],
      ip,
      req['project_id'],
      req?.headers['x-client-platform'],
      body?.envVariables,
      body?.isRebootCall,
    );
  }

  @ApiOperation({ summary: 'Get Worker Configurations' })
  @ApiOkResponse({
    description: 'Configurations Retrieved',
    type: [WorkerConfiguration],
  })
  @ApiNotFoundResponse({ description: 'Worker Not Found' })
  @AuthWorker()
  @Get('config')
  async getWorkerConfigurations(
    @ClientIp() ip: string,
    @Req() req: any,
  ): Promise<WorkerConfiguration[]> {
    this.logger.debug(
      `Fetching configurations for worker ID: ${req['worker_id']} from IP: ${ip} for project ID: ${req['project_id']} on platform: ${req?.headers['x-client-platform']}`,
    );
    return await this.workManagerService.getConfiguration(
      req['worker_id'],
      ip,
      req['project_id'],
      req?.headers['x-client-platform'],
      {},     
      false,
    );
  }

  @ApiOperation({ summary: 'Create a new request' })
  @ApiResponse({ status: 201, description: 'Request created successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiBearerAuth()
  @Auth(Permission.ManageConfig)
  @Post('/validate-connection')
  async create(@Body() request: CreateRequestDto, @Req() req: any) {
    return await this.workManagerService.validateConnection(
      request,
      req?.trackId,
    );
  }

  @ApiOperation({ summary: 'Validating export path and working directory' })
  @ApiResponse({ status: 201, description: 'Request created successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiBearerAuth()
  @AuthWorker()
  @Post('/validate/working-directory')
  async validateWorkingDirectory(@Body() data: ConfigStatusPayloadDTO) {
    return await this.workManagerService.validateWorkingDirectory(data);
  }

  @ApiOperation({ summary: 'Get Workflow Result' })
  @ApiResponse({ status: 201, description: 'Request created successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiBearerAuth()
  @Auth(Permission.ManageJob)
  @Get('/workflow/details/:id')
  async getChildWorkFlowRes(@Param('id') id: string) {
    return await this.workManagerService.getChildWorkFlowRes(id);
  }

  @ApiBearerAuth()
  @AuthWorker()
  @Post('/update/configs')
  @ApiOperation({
    summary: 'Update worker configurations',
    description: 'Update worker configurations',
  })
  @ApiBody({
    description: 'Job Run ID',
    required: true,
  })
  @ApiBody({
    description: 'List of Worker Ids ready for this job run',
    required: true,
  })
  updateWorkerConfigurations(
    @Body('jobRunId') jobRunId: string,
    @Body('workerId') workerId: string,
  ) {
    return this.workManagerService.updateWorkerConfigurations(
      jobRunId,
      workerId,
    );
  }
}
