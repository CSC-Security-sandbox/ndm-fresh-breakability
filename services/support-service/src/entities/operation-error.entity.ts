import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('operation_errors', { schema: 'datamigrator' })
export class OperationErrorEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'operation_id', type: 'uuid' })
  operationId!: string;

  @Column({ name: 'error_code', type: 'varchar', length: 50 })
  errorCode!: string;

  @Column({ name: 'error_message', type: 'text' })
  errorMessage!: string;

  @Column({
    name: 'created_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @Column({ name: 'file_name', type: 'text', nullable: true })
  fileName!: string;

  @Column({ name: 'file_path', type: 'text', nullable: true })
  filePath!: string;

  @Column({ name: 'error_type', type: 'text', nullable: true })
  errorType!: string;

  @Column({ name: 'operation_type', type: 'text', nullable: true })
  operationType!: string;

  @Column({ name: 'origin', type: 'text', nullable: true })
  origin!: string;
}
