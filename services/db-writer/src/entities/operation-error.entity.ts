import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { OperationsEntity } from "./operation.entity";

@Entity({ name: "operation_errors" })
export class OperationErrorEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: 'uuid', nullable: false,  name: 'operation_id'})
  operationId: string;

  @Column({ type: "varchar", length: 50, name: 'error_code' })
  errorCode: string;
  
  @Column({ type: "text", name: 'error_message' })
  errorMessage: string;

  @Column({ type: "text", name: 'file_name' })
  fileName: string;

  @Column({ type: "text", name: 'file_path' })
  filePath: string;

  @Column({ type: "text", name: 'error_type' })
  error_type: string;
  
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ type: "text", name: 'operation_type' })
  operationType: string;

  @Column({ type: "text", name: 'origin' })
  origin: string;

  @Column({ type: "varchar", length: 20, name: 'error_status', default: "'UNRESOLVED'" })
  errorStatus: string;

  @OneToOne(() => OperationsEntity, (operation) => operation.operationErrors, { onDelete: "CASCADE" })
  operation: OperationsEntity;
}
