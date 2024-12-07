import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToMany, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Base } from './base.entity';
import { JobRunEntity } from './jobrun.entity';
import { OperationsEntity } from './operation.entity';

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
export class TaskEntity  {
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(()=> JobRunEntity, jobRun=>jobRun.task, {onDelete: 'CASCADE', orphanedRowAction:'delete', eager: false})
  @JoinColumn({ name: 'job_run_id' })
  jobRun: JobRunEntity

  @OneToMany(()=> OperationsEntity, operations=>operations.task, { cascade: true,  eager: false})
  operations: OperationsEntity[]

}