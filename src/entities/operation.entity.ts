import { OperationStatus } from 'src/constants/enums';
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Base } from './base.entity';
import { TaskEntity } from './task.entity';



@Entity({ name: 'operations', schema: 'migrate' })
export class OperationsEntity extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'task_id' , nullable: true})
  taskId: string;

  @Column({ type: 'uuid', name: 'job_run_id' , nullable: true})
  jobRunId: string;

  @Column({ type: 'enum', enum: OperationStatus, name: 'status' , nullable: false})
  status: OperationStatus;
 
  @Column({ name: 'operation_type', type: 'text', nullable: false })
  operationType: string;

  @Column({ name: 'request', type: 'text', nullable: false })
  request: string;

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