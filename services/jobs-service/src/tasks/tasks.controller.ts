import { Controller, Get, Query, ValidationPipe } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { TaskQueryParamsDto } from './dto/taskpage.dto';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {

    constructor(private taskService: TasksService) {}

    @ApiOperation({ summary: 'Get a paginated list of Task',  description: 'Returns a list of task based on the provided pagination parameters.'})
    @ApiOkResponse({ description: 'The list of task has been retrieved successfully.',  })
    @ApiBadRequestResponse({
        description: 'Invalid pagination parameters.'
    })
    @Get('/')
    async getTaskList(@Query(new ValidationPipe({ transform: false, whitelist: true })) taskQuery: TaskQueryParamsDto) {
        return await this.taskService.getTaskList(taskQuery)
    }
}
