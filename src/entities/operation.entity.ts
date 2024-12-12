import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';
import { ErrorDetails, OperationStatus, OperationType } from 'src/constants/enums';



@Entity({ name: 'operations', schema: 'migrateadmin' })
@Index('idx_task_id', ['taskId'])
@Index('idx_operation_type', ['operationType'])
export class OperationEntity extends Base {
  @ApiProperty({ description: 'UUID of the task' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Task id' })
  @Column({ type: 'uuid', nullable: false,  name: 'task_id'})
  taskId: string;

  @ApiProperty({ description: 'Operation status' })
  @Column({ type: 'enum', enum: OperationStatus, default: OperationStatus.Failed, name:'status' })
  status: OperationStatus;

  @ApiProperty({ description: 'Operation type' })
  @Column({ type: 'enum', enum: OperationType, name:'operation_type' })
  operationType: OperationType;

  @ApiProperty({ description: 'Operation paylod sent to worker' })
  @Column({ type: 'jsonb', nullable: false, name: 'request_payload' })
  request: object;


  @ApiProperty({ description: 'Retry Count' })
  @Column({ type: 'int', nullable: false, name: 'retry_count' ,default: 0})
  retryCount: number;

  @ApiProperty({ description: 'Error Details' })
  @Column({ type: 'jsonb', nullable: true, name: 'error_details'})
  errorDetails: ErrorDetails;
}