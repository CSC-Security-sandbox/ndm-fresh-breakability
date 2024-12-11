import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';

export enum OperationType {
    ValidateNFSConnection= 'VAL_NFS_CONN',
    ValidateSMBCOnnection= 'VAL_SMB_CONN',
    ListNFSPaths= 'LS_NFS_PATHS',
    ListSMBPaths= 'LS_SMB_PATHS',
    ScanPaths= 'SCAN_PATH',
    Copy="CP",
    CalculateChecksum="CS",
    ComapreChecksum="CC",
    CopyMetadata="CM",
    ReadThroughput="R_TPT",
    WriteThroughput="W_TPT",
    NetworkLatency="N_LAT",
}

export enum OperationStatus {
    Completed = 'COMPLETED',
    Failed = 'FAILED',
}

export class ErrorDetails {
    @ApiProperty({ description: 'Error code' })
    errorCode: string;

    @ApiProperty({ description: 'Error message' })
    errorMessage: string;
}

@Entity({ name: 'operations', schema: 'migrate' })
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