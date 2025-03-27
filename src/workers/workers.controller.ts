import { Body, Controller, Get, Logger, Post, Query, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkersStatusPageDto, WorkerStatusPageResponseDto } from './dto/workers.page.dto';
import { WorkersService } from './workers.service';
import { Ctx, MessagePattern, Payload, RmqContext } from '@nestjs/microservices';
import { Auth } from '@netapp-cloud-datamigrate/auth-lib';



@ApiTags("Workers")
@Controller('workers')
export class WorkersController {

    constructor(private workersService: WorkersService) {}

    @ApiOperation({ summary: 'Get a paginated list of Workers',  description: 'Returns a list of Workers based on the provided pagination parameters.'})
    @ApiOkResponse({ description: 'The list of Workers has been retrieved successfully.',  type: WorkerStatusPageResponseDto})
    @ApiBadRequestResponse({
        description: 'Invalid pagination parameters.'
    })
    @ApiBearerAuth()
    @Auth()
    @Get('/')
    async getWorkers(@Query(new ValidationPipe({ transform: false, whitelist: true }))  workerStatusPageDto: WorkersStatusPageDto) {
        return await this.workersService.findAllWorkers(workerStatusPageDto);
    }
}

