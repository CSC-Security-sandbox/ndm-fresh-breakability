import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { OperationsEntity } from './operation.entity';
import { TaskStatus, TaskType } from 'src/enum/queues.enum';
import { TaskErrorEntity } from './task-error.entity';
import { Base } from './base.entity';



@Entity({ name: 'tasks'})
@Index('idx_job_run_id', ['jobRunId'])
@Index('idx_job_run_status', ['jobRunId', 'status'])
@Index('idx_task_type', ['taskType'])
export class TaskEntity {
  @ApiProperty({ description: 'UUID of the job run' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Job run id' })
  @Column({ type: 'uuid', nullable: false,  name: 'job_run_id'})
  jobRunId: string;

  @ApiProperty({ description: 'Task status' })
  @Column({ type: 'varchar', name:'status' })
  status: TaskStatus;

  @ApiProperty({ description: 'Task type' })
  @Column({ type: 'varchar', name:'task_type',nullable: true})
  taskType: TaskType;

  @ApiProperty({ description: 'Id of the worker worked on the task' })
  @Column({ type: 'uuid', nullable: true,  name: 'worker_id' })
  workerId: string;

  @OneToMany(()=> OperationsEntity, operations=>operations.task, { cascade: true,  eager: false})
  operations: OperationsEntity[]

  @OneToOne(() => TaskErrorEntity, (taskError) => taskError.task, { onDelete: 'CASCADE' })
  taskErrors: TaskErrorEntity;
}