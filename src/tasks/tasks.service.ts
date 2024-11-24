import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, FindOneOptions, Repository } from 'typeorm';
import { TaskEntity } from '../entities/task.entity';

@Injectable()
export class TaskService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly taskRepository: Repository<TaskEntity>,
  ) {}

  async find(condition: FindManyOptions<TaskEntity>): Promise<TaskEntity[]> {
    return this.taskRepository.find(condition);
  }

  async findOne(condition: FindOneOptions<TaskEntity>): Promise<TaskEntity | null> {
    return this.taskRepository.findOne(condition);
  }

  async create(taskData: Partial<TaskEntity>): Promise<TaskEntity> {
    const task = this.taskRepository.create(taskData);
    return this.taskRepository.save(task);
  }

  async update(
    id: string,
    taskData: Partial<TaskEntity>,
  ): Promise<TaskEntity | null> {
    const existingTask = await this.findOne({ where: { id } });
    if (!existingTask) {
      return null;
    }
    const updatedTask = this.taskRepository.merge(existingTask, taskData);
    return this.taskRepository.save(updatedTask);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.taskRepository.delete(id);
    return result.affected > 0;
  }
}
