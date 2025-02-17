import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
} from "typeorm";
import { Base } from "./base.entity";
import { TaskEntity } from "./task.entity";

@Entity({ name: "task_errors" })
export class TaskErrorEntity extends Base {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @OneToOne(() => TaskEntity, (task) => task.taskErrors, {
    onDelete: "CASCADE",
  })
  task: TaskEntity;

  @Column({ type: "varchar", length: 50 })
  errorCode: string;

  @Column({ type: "text" })
  errorMessage: string;
}
