import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from "typeorm";
import { TaskEntity } from "./task.entity";

@Entity({ name: "task_errors" })
export class TaskErrorEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", nullable: false, name: "task_id" })
  taskId: string;

  @Column({ type: "varchar", length: 50, name: "error_code" })
  errorCode: string;

  @Column({ type: "text", name: "error_message" })
  errorMessage: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @OneToMany(() => TaskEntity, (task) => task.taskErrors, {
    onDelete: "CASCADE",
  })
  task: TaskEntity;
}
