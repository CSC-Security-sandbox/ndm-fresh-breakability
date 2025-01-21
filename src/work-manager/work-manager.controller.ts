import { Controller, Get, Param } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { WorkerConfiguration } from 'src/constants/types';
import { WorkManagerService } from './work-manager.service';
import { ClientIp } from 'src/middleware/clientip';

@Controller('work-manager')
export class WorkManagerController {

    constructor(
        private workManagerService: WorkManagerService
    ) {}

    @ApiOperation({ summary: 'Get Configuration by ID' })
    @ApiOkResponse({ description: 'Configuration Found' ,  type: WorkerConfiguration})
    @ApiNotFoundResponse({ description: 'Configuration Not Found' })
    @Get('config/:id/:apiKey')
    async getConfiguration(@Param('id') id: string, @ClientIp() ip: string, @Param('apiKey') apiKey: string) {
        return await this.workManagerService.getConfiguration(id, ip, apiKey)
    }
}
