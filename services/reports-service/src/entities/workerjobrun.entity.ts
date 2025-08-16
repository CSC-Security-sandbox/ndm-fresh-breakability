import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { WorkerEntity } from "./worker.entity";
import { JobRunEntity } from "./jobrun.entity";

@Entity({ name: "worker_jobrun_mapping" })
export class WorkerJobRunMap {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "boolean", default: false, name: "status" })
  isActive: boolean;

  @Column({ name: "worker_id", type: "uuid" })
  workerId: string;

  @Column({ name: "job_run_id", type: "uuid" })
  jobRunId: string;

  @Column({ name: "is_path_mounted", type: "boolean", default: "false" })
  isPathMounted: boolean = false;

  @ManyToOne(() => WorkerEntity, (worker) => worker.jobRunMap, {
    onDelete: "CASCADE",
    orphanedRowAction: "delete",
  })
  @JoinColumn({ name: "worker_id" })
  worker: WorkerEntity;

  @ManyToOne(() => JobRunEntity, (jonRun) => jonRun.workerMap, {
    onDelete: "CASCADE",
    orphanedRowAction: "delete",
  })
  @JoinColumn({ name: "job_run_id" })
  jobRun: JobRunEntity;

  @Column({
    name: "worker_response",
    type: "jsonb",
    nullable: true,
    default: null,
  })
  workerResponse?: Record<string, any>;
}
