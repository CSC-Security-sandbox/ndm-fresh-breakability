import {
  Column,
  Entity,
  Index,
  OneToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Base } from "./base.entity";
import { OperationsEntity } from "./operation.entity";

@Entity({ name: "operation_errors" })
export class OperationErrorEntity extends Base {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @OneToOne(() => OperationsEntity, (operation) => operation.operationErrors, {
    onDelete: "CASCADE",
  })
  @Index()
  operation: OperationsEntity;

  @Column({ type: "varchar", length: 50 })
  errorCode: string;

  @Column({ type: "text" })
  errorMessage: string;
}
