import { OperationStatus, OperationType } from 'src/constants/enums';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Base } from './base.entity';
import { TaskEntity } from './task.entity';
import { OperationErrorEntity } from './operation-error.entity';

@Entity({ name: 'operations' })
@Index('idx_operation_run_status', ['jobRunId', 'status'])
@Index('idx_file_path_task', ['fPath', 'taskId'])
@Index('idx_operation_type', ['operationType'])
export class OperationsEntity extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'task_id', nullable: true })
  taskId: string;

  @Column({ type: 'uuid', name: 'job_run_id', nullable: true })
  jobRunId: string;

  @Column({ type: 'uuid', name: 'source_path_id', nullable: true })
  sPathId: string;

  @Column({ type: 'uuid', name: 'target_path_id', nullable: true })
  tPathId: string;

  @Column({ type: 'varchar', name: 'status', nullable: false })
  status: OperationStatus;

  @Column({ name: 'operation_type', type: 'varchar', nullable: false })
  operationType: OperationType;

  @Column({ name: 'request', type: 'jsonb', nullable: false })
  request: Record<string, any>;

  @Column({ name: 'error_details', type: 'text', nullable: true })
  errorDetails: string;

  @Column({ name: 'f_path', type: 'text', nullable: false })
  fPath: string;

  @Column({ name: 'retry_count', type: 'int', nullable: true })
  retryCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => TaskEntity, (task) => task.operations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id' })
  task: TaskEntity;

  @OneToMany(
    () => OperationErrorEntity,
    (operationErrors) => operationErrors.operation,
    { onDelete: 'CASCADE' },
  )
  operationErrors: OperationErrorEntity[];
}
