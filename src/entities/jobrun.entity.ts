import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';
import { InventoryEntity } from './inventory.entity';
import { JobConfigEntity } from './jobconfig.entity';
import { JobRunStatus } from 'src/constants/enums';
import { WorkerJobRunMap } from './jobrunworker.entity';
import { TaskEntity } from './task.entity';


@Entity({ name: "jobrun" })
export class JobRunEntity extends Base {
  @ApiProperty({ description: "UUID of the job run" })
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ApiProperty({ description: "Job Run status" })
  @Column({ type: "varchar", name: "status" })
  status: JobRunStatus;

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
  inventories: InventoryEntity[];

  @OneToMany(() => WorkerJobRunMap, (workerMap) => workerMap.jobRun, {
    cascade: true,
    eager: false,
  })
  worker: WorkerJobRunMap[];

  @OneToMany(() => TaskEntity, (task) => task.jobRun, {
    cascade: true,
    eager: false,
  })
  tasks: TaskEntity[];
}