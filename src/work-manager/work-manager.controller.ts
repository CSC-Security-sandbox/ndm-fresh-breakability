import { Body, Controller, Get, Logger, Param, Post, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { WorkerConfiguration } from 'src/constants/types';
import { WorkManagerService } from './work-manager.service';
import { ClientIp } from 'src/middleware/clientip';
import { CreateRequestDto } from './dto/validate-connection.dto';
import { AuthWorker } from '@netapp-cloud-datamigrate/auth-lib';

@Controller('work-manager')
export class WorkManagerController {
    readonly logger = new Logger(WorkManagerController.name)
    constructor(
        private workManagerService: WorkManagerService
    ) {}

    @ApiOperation({ summary: 'Get Configuration by ID' })
    @ApiOkResponse({ description: 'Configuration Found' ,  type: WorkerConfiguration})
    @ApiNotFoundResponse({ description: 'Configuration Not Found' })
    @AuthWorker()
    @Get('config')
    async getConfiguration(@ClientIp() ip: string, @Req() req: any): Promise<WorkerConfiguration[]> {
        return await this.workManagerService.getConfiguration(req['worker_id'], ip, req['project_id'], req['worker_name'])
    }

  @ApiOperation({ summary: 'Create a new request' })
  @ApiResponse({ status: 201, description: 'Request created successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @Post('/validate-connection')
  async create(@Body() request: CreateRequestDto, @Req() req: any) {
    return await this.workManagerService.validateConnection(
      request,
      req?.trackId,
    );
  }

  @ApiOperation({ summary: 'Get Workflow Result' })
  @ApiResponse({ status: 201, description: 'Request created successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @Get('/workflow/details/:id')
  async getChildWorkFlowRes(@Param('id') id: string) {
    return await this.workManagerService.getChildWorkFlowRes(id);
  }

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
    @Body('workerIds') workerIds: string[],
  ) {
    console.log(
      `[WorkersController] - updateWorkerConfigurations - jobRunId: ${jobRunId} - workerIds: ${workerIds}`,
    );
    return  this.workManagerService.updateWorkerConfigurations(
      jobRunId,
      workerIds,
    );
  }
}
