import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';
import { OperationEntity } from './operation.entity';
import { TaskStatus, TaskType } from 'src/constants/enums';
import { JobRunEntity } from './jobrun.entity';


@Entity({ name: 'tasks', schema: 'migrateadmin' })
@Index('idx_task_job_run_id', ['jobRunId'])
@Index('idx_job_run_status', ['jobRunId', 'status'])
@Index('idx_task_type', ['taskType'])
export class TaskEntity extends Base {
  @ApiProperty({ description: 'UUID of the job run' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Job run id' })
  @Column({ type: 'uuid', nullable: false,  name: 'job_run_id'})
  jobRunId: string;

  @ApiProperty({ description: 'Task status' })
  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.Pending, name:'status' })
  status: TaskStatus;

  @ApiProperty({ description: 'Task type' })
  @Column({ type: 'enum', enum: TaskType, name:'task_type',nullable: true})
  taskType: TaskType;

  @ApiProperty({ description: 'Id of the worker worked on the task' })
  @Column({ type: 'uuid', nullable: true,  name: 'worker_id' })
  workerId: string;

  @ApiProperty({ description: 'Operations for the task' })
  @Column({ type: 'jsonb', nullable: false, name: 'operations' })
  operations: OperationEntity[];

  @ManyToOne(() => JobRunEntity, jobRun => jobRun.tasks, { onDelete: 'CASCADE' }) 
  jobRun: JobRunEntity;
}