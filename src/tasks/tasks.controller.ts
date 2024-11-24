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
  } from '@nestjs/common';
  import { ApiTags, ApiResponse } from '@nestjs/swagger';
  import { TaskService } from './tasks.service';
  import { TaskEntity } from '../entities/task.entity';
  
  @ApiTags('Tasks')
  @Controller('tasks')
  export class TaskController {
    constructor(private readonly taskService: TaskService) {}
  
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
    @ApiResponse({ status: 200, description: 'Deletes a task.' })
    @ApiResponse({ status: 404, description: 'Task not found.' })
    @Get('/worker/:workerId/:jobRunId')
    async getTaskForWorker(
      @Param('workerId') workerId: string, 
      @Param('jobRunId') jobRunId: string, 
    ) {
      // tasks will be assigned to worker with this API.
    }
  }
  