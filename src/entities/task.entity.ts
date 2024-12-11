import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';
import { OperationEntity } from './operation.entity';

export enum TaskType {
    Scan = 'SCAN',
    Migrate = 'MIGRATE',
    Sync = 'SYNC',
    ValidateConnection= 'VALIDATE_CONNECTION',
    ListPaths= 'LIST_PATHS',
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
    InProgress = 'IN_PROGRESS',
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
  @Column({ type: 'enum', enum: TaskType, name:'task_type',nullable: true})
  taskType: TaskType;

  @ApiProperty({ description: 'Id of the worker worked on the task' })
  @Column({ type: 'uuid', nullable: true,  name: 'worker_id' })
  workerId: string;

  @ApiProperty({ description: 'Operations for the task' })
  @Column({ type: 'jsonb', nullable: false, name: 'operations' })
  operations: OperationEntity[];
}