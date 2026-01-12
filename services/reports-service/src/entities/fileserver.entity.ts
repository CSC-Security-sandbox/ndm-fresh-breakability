import { ApiProperty } from "@nestjs/swagger";
import { Protocol, ProtocolVersion, ServerType } from "src/constants/enums";
import {
  Column,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { WorkerEntity } from "./worker.entity";
import { Base } from "./base.entity";
import { ConfigEntity } from "./config.entity";
import { VolumeEntity } from "./volume.entity";
import { FileServerWorkingDirectoryMappingEntity } from "./fileserver_workingdirectory_mapping.entity";

export enum ConsolidatedReportStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  PARTIAL = 'PARTIAL',
}

@Entity({ name: "file_server" })
export class FileServerEntity extends Base {
  @ApiProperty({ description: "configId" })
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ApiProperty({ description: "data" })
  @Column({ type: "text", nullable: true, name: "hostname" })
  host: string;

  @ApiProperty({ description: 'File Server Name' })
  @Column({ type: 'text', nullable: true, name: 'file_server_name' })
  fileServerName: string;

  @ApiProperty({ description: "data" })
  @Column({ type: "text", nullable: true, name: "username" })
  userName: string;

  @ApiProperty({ description: "protocol" })
  @Column({ type: "varchar", name: "protocol", nullable: true })
  protocol: Protocol;

  @ApiProperty({ description: "password" })
  @Column({ type: "text", nullable: true, name: "password" })
  password: string;

  @ApiProperty({ description: "configId" })
  @Column({ type: "uuid", nullable: true, name: "config_id" })
  configId: string;

  @ManyToOne(() => ConfigEntity, (config) => config.fileServers, {
    onDelete: "CASCADE",
    orphanedRowAction: "delete",
  })
  @JoinColumn({ name: "config_id" })
  config: ConfigEntity;

  @OneToMany(() => VolumeEntity, (volume) => volume.fileServer, {
    cascade: true,
    eager: false,
  })
  volumes: VolumeEntity[];

  @ApiProperty({ description: "is Refreshed Config" })
  @Column({ name: "is_refreshed", nullable: true, type: "boolean" })
  isRefreshed: boolean;

  @ApiProperty({ description: "protocol version" })
  @Column({ type: "varchar", nullable: false, name: "protocol_version" })
  protocolVersion: ProtocolVersion;

  @ManyToMany(() => WorkerEntity, (worker) => worker.fileServers)
  @JoinTable({
    name: "file_server_worker",
    joinColumn: {
      name: "file_server_id",
      referencedColumnName: "id",
    },
    inverseJoinColumn: {
      name: "worker_id",
      referencedColumnName: "workerId",
    },
  })
  workers: WorkerEntity[];

  @OneToOne(
    () => FileServerWorkingDirectoryMappingEntity,
    (mapping) => mapping.fileServer
  )
  @JoinColumn({ name: "config_id" })
  workingDirectory: FileServerWorkingDirectoryMappingEntity;

  @ApiProperty({ description: 'Consolidated report generation status' })
  @Column({ type: 'varchar', name: 'consolidated_report_status', nullable: true })
  consolidatedReportStatus: ConsolidatedReportStatus;

  @ApiProperty({ description: 'Path to the consolidated report file' })
  @Column({ type: 'varchar', name: 'consolidated_report_path', nullable: true })
  consolidatedReportPath: string;

  @ApiProperty({ description: 'Temporal workflow ID for consolidated report' })
  @Column({ type: 'varchar', name: 'consolidated_report_workflow_id', nullable: true })
  consolidatedReportWorkflowId: string;

  @ApiProperty({ description: 'Last update time for consolidated report' })
  @Column({ type: 'timestamp with time zone', name: 'consolidated_report_updated_at', nullable: true })
  consolidatedReportUpdatedAt: Date;
}
