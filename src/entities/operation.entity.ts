import { OperationStatus, OperationType } from 'src/constants/enums';
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Base } from './base.entity';
import { TaskEntity } from './task.entity';


@Entity({ name: 'operations', schema: 'migrate' })
@Index('idx_operation_run_status', ['jobRunId', 'status'])
@Index('idx_file_path_task', ['fPath', 'taskId'])
@Index('idx_operation_type', ['operationType'])
export class OperationsEntity extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'task_id' , nullable: true})
  taskId: string;

  @Column({ type: 'uuid', name: 'job_run_id' , nullable: true})
  jobRunId: string;

  @Column({ type: 'text',  name: 'status' , nullable: false})
  status: OperationStatus;
 
  @Column({ name: 'operation_type', enum: OperationType,  type: 'enum', nullable: false })
  operationType: OperationType;

  @Column({ name: 'request', type: 'jsonb', nullable: false })
  request: Record<string, any>;

  @Column({ name: 'error_details', type: 'text', nullable: true })
  errorDetails: string;

  @Column({ name: 'f_path', type: 'text' , nullable: false})
  fPath: string;

  @Column({ name: 'retry_count', type: 'int' , nullable:true})
  retryCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => TaskEntity, task => task.operations, { onDelete:'CASCADE'})
  @JoinColumn({ name: 'task_id' }) 
  task: TaskEntity;

}