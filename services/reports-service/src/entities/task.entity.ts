import { ApiProperty } from "@nestjs/swagger";
import { TaskStatus, TaskType } from "src/constants/enums";
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { OperationsEntity } from "./operation.entity";
import { WorkerEntity } from "./worker.entity";
import { TaskErrorEntity } from "./task-error.entity";
import { JobRunEntity } from "./jobrun.entity";

@Entity({ name: "tasks" })
@Index("idx_job_run_id", ["jobRunId"])
@Index("idx_job_run_status", ["jobRunId", "status"])
@Index("idx_task_type", ["taskType"])
export class TaskEntity {
  @ApiProperty({ description: "UUID of the job run" })
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ApiProperty({ description: "Job run id" })
  @Column({ type: "uuid", nullable: false, name: "job_run_id" })
  jobRunId: string;

  @ApiProperty({ description: "Task status" })
  @Column({ type: "varchar", name: "status" })
  status: TaskStatus;

  @ApiProperty({ description: "Task type" })
  @Column({ type: "varchar", name: "task_type", nullable: true })
  taskType: TaskType;

  @ApiProperty({ description: "Id of the worker worked on the task" })
  @Column({ type: "uuid", nullable: true, name: "worker_id" })
  workerId: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => JobRunEntity, (jobRun) => jobRun.tasks, {
    onDelete: "CASCADE",
    orphanedRowAction: "delete",
    eager: false,
  })
  @JoinColumn({ name: "job_run_id" })
  jobRun: JobRunEntity;

  @OneToMany(() => OperationsEntity, (operations) => operations.task, {
    cascade: true,
    eager: false,
  })
  operations: OperationsEntity[];

  @ManyToOne(() => WorkerEntity, (worker) => worker.tasks, {
    onDelete: "CASCADE",
    orphanedRowAction: "delete",
    eager: false,
  })
  @JoinColumn({ name: "worker_id" })
  worker: WorkerEntity;

  @OneToOne(() => TaskErrorEntity, (taskError) => taskError.task, {
    onDelete: "CASCADE",
    eager: false,
  })
  taskErrors: TaskErrorEntity;
}
