import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
} from 'typeorm';
import { OperationsEntity } from './operation.entity';

@Entity({ name: 'operation_errors' })
export class OperationErrorEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: false, name: 'operation_id' })
  operationId: string;

  @Column({ type: 'varchar', length: 50, name: 'error_code' })
  errorCode: string;

  @Column({ type: 'text', name: 'error_message' })
  errorMessage: string;

  @Column({ type: 'text', name: 'file_name' })
  fileName: string;

  @Column({ type: 'text', name: 'file_path' })
  filePath: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'text', name: 'origin' })
  origin: string;

  @Column({ type: 'text', name: 'operation_type' })
  operationType: string;

  @Column({ type: 'text', name: 'error_type' })
  errorType: string;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'error_status',
    default: "'UNRESOLVED'",
  })
  errorStatus: string;

  @ManyToOne(() => OperationsEntity, (operation) => operation.operationErrors, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'operation_id' })
  operation: OperationsEntity;
}
