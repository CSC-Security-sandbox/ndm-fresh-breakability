import { FindManyOptions, FindOneOptions, Repository } from 'typeorm';
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TaskEntity, TaskStatus } from '../entities/task.entity';
import { JobRunEntity, JobRunStatus } from 'src/entities/jobrun.entity';

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

  async updateTasksByIds(ids: string[], updateData: Partial<TaskEntity>) {
    return await this.taskRepository
      .createQueryBuilder()
      .update(TaskEntity)
      .set(updateData)
      .whereInIds(ids)
      .execute();
  }

  async assignTasksToWorker(jobRunId: string, limit: number) {
    const queryRunner = this.taskRepository.manager.connection.createQueryRunner();
  
    try {
      // Start transaction
      await queryRunner.startTransaction();
  
      // Step 1: Select and lock tasks
      const tasks = await queryRunner.manager
        .createQueryBuilder(TaskEntity, 'task')
        .setLock('pessimistic_write') // Lock rows to prevent other workers from accessing them
        .where('task.job_run_id = :jobRunId', { jobRunId })
        .andWhere('task.status = :status', { status: TaskStatus.Pending })
        .limit(limit)
        .getMany();
  
      if (!tasks || tasks.length === 0) {
        await queryRunner.rollbackTransaction();
        return [];
      }
  
      // step 2: Update job run row status

      await queryRunner.manager
        .createQueryBuilder()
        .update(JobRunEntity)
        .set({ status: JobRunStatus.Running })
        .where({ id: jobRunId, status: JobRunStatus.Ready })
        .execute();

      // Step 3: Update tasks to "Running" status
      const taskIds = tasks.map(task => task.id);
      await queryRunner.manager
        .createQueryBuilder()
        .update(TaskEntity)
        .set({ status: TaskStatus.Running })
        .whereInIds(taskIds)
        .execute();
  
      // Commit transaction
      await queryRunner.commitTransaction();
  
      return tasks;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw new ConflictException('Failed to assign tasks to the worker.');
    } finally {
      await queryRunner.release();
    }
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.taskRepository.delete(id);
    return result.affected > 0;
  }
}
