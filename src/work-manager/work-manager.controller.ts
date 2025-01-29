import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WorkerConfiguration } from 'src/constants/types';
import { WorkManagerService } from './work-manager.service';
import { ClientIp } from 'src/middleware/clientip';
import { CreateRequestDto } from './dto/validate-connection.dto';

@Controller('work-manager')
export class WorkManagerController {

    constructor(
        private workManagerService: WorkManagerService
    ) {}

    @ApiOperation({ summary: 'Get Configuration by ID' })
    @ApiOkResponse({ description: 'Configuration Found' ,  type: WorkerConfiguration})
    @ApiNotFoundResponse({ description: 'Configuration Not Found' })
    @Get('config/:id')
    async getConfiguration(@Param('id') id: string, @ClientIp() ip: string, @Req() req: any): Promise<WorkerConfiguration[]> {
        return await this.workManagerService.getConfiguration(id, ip, req.headers['project-id'], req.headers['worker-name'])
    }

    @ApiOperation({ summary: 'Create a new request' }) 
    @ApiResponse({ status: 201, description: 'Request created successfully' })
    @ApiResponse({ status: 400, description: 'Bad Request' })
    @Post('/validate-connection')
    async create(@Body() request: CreateRequestDto, @Req() req: any) {
        return await this.workManagerService.validateConnection(request, req?.trackId)
    }

    @ApiOperation({ summary: 'Get Workflow Result' }) 
    @ApiResponse({ status: 201, description: 'Request created successfully' })
    @ApiResponse({ status: 400, description: 'Bad Request' })
    @Get('/workflow/details/:id')
    async getChildWorkFlowRes(@Param('id') id: string) {
        return await this.workManagerService.getChildWorkFlowRes(id)
    }

}