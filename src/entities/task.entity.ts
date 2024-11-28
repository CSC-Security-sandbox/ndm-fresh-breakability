import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';

export enum TaskType {
    Scan = 'SCAN',
    Migrate = 'MIGRATE',
    Copy = 'COPY'
}

export enum TaskStatus {
    Ready = 'READY',
    Pending = 'PENDING',
    Running = 'RUNNING',
    Paused = 'PAUSED',
    Stopped = 'STOPPED',
    Errored = 'ERRORED',
    Failed = 'FAILED',
    Completed = 'COMPLETED',
}

export enum TaskOperation {
    ScanPath = 'SCAN_PATH',
    CopyFile = 'COPY_FILE',
    MetaStamp = 'META_STAMP'
}

@Entity({ name: 'tasks', schema: 'migrate' })
@Index('idx_job_run_id', ['jobRunId'])
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
  @Column({ type: 'enum', enum: TaskType, name:'task_type' })
  taskType: TaskType;

  @ApiProperty({ description: 'Operations for the task' })
  @Column({ type: 'jsonb', nullable: false, name: 'operations' })
  operations: object;
}