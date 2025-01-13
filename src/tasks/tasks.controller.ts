import { Controller, Get, Query, ValidationPipe } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { WorkersService } from 'src/workers/workers.service';
import { TaskQueryParamsDto } from './dto/taskpage.dto';

@Controller('tasks')
export class TasksController {


    @ApiOperation({ summary: 'Get a paginated list of Task',  description: 'Returns a list of Workers based on the provided pagination parameters.'})
    @ApiOkResponse({ description: 'The list of Workers has been retrieved successfully.',  })
    @ApiBadRequestResponse({
        description: 'Invalid pagination parameters.'
    })
    @Get('/')
    async getWorkers(@Query(new ValidationPipe({ transform: false, whitelist: true })) taskQuery: TaskQueryParamsDto) {
        return taskQuery
    }
}
