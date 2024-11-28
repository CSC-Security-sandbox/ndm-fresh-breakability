import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
    HttpException,
    HttpStatus,
    NotFoundException,
  } from '@nestjs/common';
  import { ApiTags, ApiResponse } from '@nestjs/swagger';
  import { TaskService } from './tasks.service';
  import { TaskEntity } from '../entities/task.entity';
import { EventsGateway } from '../events/getway/events.gateway';
  
  @ApiTags('Tasks')
  @Controller('tasks')
  export class TaskController {
    constructor(
      private readonly taskService: TaskService,
      private readonly eventsGateway: EventsGateway
    ) {}
  
    @ApiResponse({ status: 200, description: 'Returns all tasks.' })
    @Get()
    async getAllTasks(): Promise<TaskEntity[]> {
      return this.taskService.find({});
    }
  
    @ApiResponse({ status: 200, description: 'Returns a task by ID.' })
    @ApiResponse({ status: 404, description: 'Task not found.' })
    @Get(':id')
    async getTaskById(@Param('id') id: string): Promise<TaskEntity> {
      const task = await this.taskService.findOne({ where: {  id}});
      if (!task) {
        throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
      }
      return task;
    }
  
    @ApiResponse({ status: 201, description: 'Creates a new task.' })
    @Post()
    async createTask(@Body() taskData: Partial<TaskEntity>): Promise<TaskEntity> {
      return this.taskService.create(taskData);
    }
  
    @ApiResponse({ status: 200, description: 'Updates a task.' })
    @ApiResponse({ status: 404, description: 'Task not found.' })
    @Put(':id')
    async updateTask(
      @Param('id') id: string,
      @Body() taskData: Partial<TaskEntity>,
    ): Promise<TaskEntity> {
      const updatedTask = await this.taskService.update(id, taskData);
      if (!updatedTask) {
        throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
      }
      return updatedTask;
    }
  
    @ApiResponse({ status: 200, description: 'Deletes a task.' })
    @ApiResponse({ status: 404, description: 'Task not found.' })
    @Delete(':id')
    async deleteTask(@Param('id') id: string): Promise<void> {
      const deleted = await this.taskService.delete(id);
      if (!deleted) {
        throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
      }
    }

    // Worker will call this api to get the list of tasks that can be picked
    @ApiResponse({ status: 200, description: 'Returns tasks assigned to a worker for processing.' })
    @ApiResponse({ status: 404, description: 'No tasks found for the worker.' })
    @Get('/worker/:workerId/:jobRunId')
    async getTaskForWorker(
      @Param('workerId') workerId: string, 
      @Param('jobRunId') jobRunId: string
    ) {
      const tasks = await this.taskService.assignTasksToWorker(jobRunId, 1000);

      if (!tasks || tasks.length === 0) {
        throw new NotFoundException('No tasks available for the worker.');
      }

      return {
        message: 'Tasks assigned to worker for processing.',
        tasks
      };
    }
}