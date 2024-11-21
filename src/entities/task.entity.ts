import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
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

@Entity({ name: 'tasks' })
export class TaskEntity extends Base {
  @ApiProperty({ description: 'UUID of the job run' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Job run id' })
  @Column({ type: 'uuid', nullable: false,  name: 'job_run_id'})
  job_run_id: string;

  @ApiProperty({ description: 'Task status' })
  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.Pending, name:'status' })
  status: TaskStatus;

  @ApiProperty({ description: 'File server id' })
  @Column({ type: 'uuid', nullable: false,  name: 'file_server_id'})
  file_server_id: string;

  @ApiProperty({ description: 'Operations for the task' })
  @Column({ type: 'jsonb', nullable: false, name: 'operations' })
  operations: object;
}