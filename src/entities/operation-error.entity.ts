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
  
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToOne(() => OperationsEntity, (operation) => operation.operationErrors, { onDelete: "CASCADE" })
  operation: OperationsEntity;
}
