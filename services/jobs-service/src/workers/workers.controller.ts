import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { WorkersStatusPageDto, WorkerStatusPageResponseDto } from './dto/workers.page.dto';
import { WorkersService } from './workers.service';
import { Ctx, MessagePattern, Payload, RmqContext } from '@nestjs/microservices';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import { WorkerJobRunActivationParamsDto } from './dto/woker-jobrun-activation.dto';
import {
    LoggerFactory,
    LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@ApiTags("Workers")
@Controller('workers')
export class WorkersController {
    private logger: LoggerService;
    constructor(
        private workersService: WorkersService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory
    ) {
        this.logger = loggerFactory.create(WorkersController.name);
    }

    @ApiOperation({ summary: 'Get a paginated list of Workers', description: 'Returns a list of Workers based on the provided pagination parameters.' })
    @ApiOkResponse({ description: 'The list of Workers has been retrieved successfully.', type: WorkerStatusPageResponseDto })
    @ApiBadRequestResponse({
        description: 'Invalid pagination parameters.'
    })
    @ApiBearerAuth()
    @Auth(Permission.ViewAgentsList)
    @Get('/')
    async getWorkers(@Query(new ValidationPipe({ transform: false, whitelist: true })) workerStatusPageDto: WorkersStatusPageDto) {
        return await this.workersService.findAllWorkers(workerStatusPageDto);
    }


    @Post(':workerId/jobrun/:jobrunId/activation-statue/:active')
    @ApiOperation({ summary: 'Update the activation status of a worker job run' })
    @ApiResponse({ status: 200, description: 'Worker job run status updated successfully.' })
    @ApiResponse({ status: 400, description: 'Invalid input parameters.' })
    @ApiResponse({ status: 404, description: 'Worker or Job Run not found.' })
    async updateWorkerJobRunStatus(
        @Param(new ValidationPipe({ transform: true }))
        params: WorkerJobRunActivationParamsDto,
    ) {
        const { workerId, jobrunId, active } = params;
        return this.workersService.updateWorkerJobRunStatus(workerId, jobrunId, active);
    }
}

