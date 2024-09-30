import { Body, Controller, Get, Post, Query, ValidationPipe } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkersStatusPageDto, WorkerStatusPageResponceDto } from './dto/workers.page.dto';
import { WorkersService } from './workers.service';



@ApiTags("Workers")
@Controller('workers')
export class WorkersController {

    constructor(private workersService: WorkersService) {}

    @ApiOperation({ summary: 'Get a paginated list of Workers',  description: 'Returns a list of Workers based on the provided pagination parameters.'})
    @ApiOkResponse({ description: 'The list of Workers has been retrieved successfully.',  type: WorkerStatusPageResponceDto})
    @ApiBadRequestResponse({
        description: 'Invalid pagination parameters.'
    })
    @Get('/')
    async getWorkers(@Query(new ValidationPipe({ transform: false, whitelist: true }))  workerStatusPageDto: WorkersStatusPageDto) {
        return await this.workersService.findAllWorkers(workerStatusPageDto);
    }

}
