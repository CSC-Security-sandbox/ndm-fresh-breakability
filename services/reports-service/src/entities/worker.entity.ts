import {
  Entity,
  Column,
  PrimaryColumn,
  ManyToOne,
  JoinColumn,
  ManyToMany,
  OneToMany,
  OneToOne,
} from "typeorm";
import { ApiProperty } from "@nestjs/swagger";
import { WorkerStatus } from "src/constants/enums";
import { Base } from "./base.entity";
import { WorkerJobRunMap } from "./workerjobrun.entity";
import { WorkerStatsEntity } from "./worker-stats.entity";
import { TaskEntity } from "./task.entity";
import { ProjectEntity } from "./project.entity";
import { FileServerEntity } from "./fileserver.entity";

@Entity({ name: "worker" })
export class WorkerEntity extends Base {
  @ApiProperty({ description: "workerId" })
  @PrimaryColumn({ type: "uuid", name: "id" })
  workerId: string;

  @ApiProperty({ description: "projectId" })
  @Column({ type: "uuid", nullable: false, name: "project_id" })
  projectId: string;

  @ApiProperty({ description: "workerName" })
  @Column({
    type: "varchar",
    length: 255,
    nullable: false,
    name: "worker_name",
  })
  workerName: string;

  @ApiProperty({ description: "ipAddress" })
  @Column({ type: "varchar", length: 255, nullable: false, name: "ip_address" })
  ipAddress: string;

  @ManyToOne(() => ProjectEntity, (project) => project.workers)
  @JoinColumn({ name: "project_id" })
  project: ProjectEntity;

  @ApiProperty({ description: "status" })
  @Column({ type: "varchar", name: "status" })
  status: WorkerStatus;

  @ManyToMany(() => FileServerEntity, (fileServers) => fileServers.workers, {
    cascade: true,
    orphanedRowAction: "delete",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  fileServers: FileServerEntity[];

  @OneToMany(() => WorkerJobRunMap, (jobRunMap) => jobRunMap.worker, {
    cascade: true,
    eager: false,
  })
  jobRunMap: WorkerJobRunMap[];

  @OneToMany(() => TaskEntity, (task) => task.worker, {
    cascade: true,
    eager: false,
  })
  tasks: TaskEntity[];

  @OneToOne(() => WorkerStatsEntity, (workerStats) => workerStats.worker, {
    cascade: true,
  })
  stats: WorkerStatsEntity;
}
