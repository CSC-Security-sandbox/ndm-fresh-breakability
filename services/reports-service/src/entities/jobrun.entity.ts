import { ApiProperty } from "@nestjs/swagger";
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Base } from "./base.entity";
import { JobConfigEntity } from "./jobconfig.entity";
import { WorkerJobRunMap } from "./workerjobrun.entity";
import { JobRunStatus, PausedReason } from "src/constants/enums";
import { InventoryEntity } from "./inventory.entity";
import { TaskEntity } from "./task.entity";
import { JobOptionsEntity } from "./joboptions.entity";
import { WorkerConfiguration } from "src/constants/types";
import { JobRunStats } from "src/job-run/dto/job-rundetails.dto";

@Entity({ name: "jobrun" })
export class JobRunEntity extends Base {
  @ApiProperty({ description: "UUID of the job run" })
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ApiProperty({ description: "Job Run status" })
  @Column({ type: "varchar", name: "status" })
  status: JobRunStatus;

  @Column({ type: "text", name: "sub_status", nullable: true })
  subStatus: string;

  @ApiProperty({ description: "Start time of the job" })
  @Column({ name: "start_time" })
  startTime: Date;

  @ApiProperty({ description: "End time of the job" })
  @Column({ name: "end_time", nullable: true })
  endTime: Date;

  @ApiProperty({ description: "Iteration number of the job" })
  @Column({ name: "iteration_number" })
  iterationNumber: number;

  @ApiProperty({ description: "Job ID associated with this run" })
  @Column({ name: "job_config_id" })
  jobConfigId: string;

  @ApiProperty({ description: "Job ID associated with this run" })
  @Column({ name: "is_report_ready" })
  isReportReady: boolean;

  @ManyToOne(() => JobConfigEntity, (jobConfig) => jobConfig.jobRuns, {
    onDelete: "CASCADE",
    orphanedRowAction: "delete",
  })
  @JoinColumn({ name: "job_config_id" })
  jobConfig: JobConfigEntity;

  @OneToMany(() => InventoryEntity, (inventory) => inventory.jobRuns, {
    cascade: true,
    eager: false,
  })
  inventoryDetails: InventoryEntity[];

  @OneToMany(() => TaskEntity, (task) => task.jobRun, {
    cascade: true,
    eager: false,
  })
  tasks: TaskEntity[];
  inventories: InventoryEntity[];

  @OneToMany(() => WorkerJobRunMap, (workerMap) => workerMap.jobRun, {
    cascade: true,
    eager: false,
  })
  workerMap: WorkerJobRunMap[];

  @OneToMany(() => WorkerJobRunMap, (workerMap) => workerMap.jobRun, {
    cascade: true,
    eager: false,
  })
  worker: WorkerJobRunMap[];

  @OneToOne(() => JobOptionsEntity, (jobOption) => jobOption.jobRun, {
    cascade: true,
    eager: false,
  })
  options: JobOptionsEntity;

  @Column({ type: "json", nullable: true, name: "meta_config" })
  metaConfig: WorkerConfiguration[];

  @Column({ type: "text", nullable: true, name: "workflow_id" })
  workFlowId: string;

  @Column({ type: "json", nullable: true, name: "job_stats" })
  jobStats: JobRunStats;

  @Column({ type: "text", nullable: true, name: "paused_reason" })
  pausedReason: PausedReason;
}
