import { ApiProperty } from "@nestjs/swagger";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  Long,
  ManyToOne,
  PrimaryGeneratedColumn,
  Timestamp,
} from "typeorm";
import { Base } from "./base.entity";
import { VolumeEntity } from "./volume.entity";
import { JobRunEntity } from "./jobrun.entity";

@Entity({ name: "inventory" })
@Index("idx_id", ["id"])
@Index("idx_path", ["path"])
@Index("idx_file_server_path_id", ["fileServerPathId"])
@Index("idx_inventory_job_run_id", ["jobRunId"])
export class InventoryEntity extends Base {
  @ApiProperty({ description: "UUID of the inventory" })
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ApiProperty({ description: "Path from where inventory has been discovered" })
  @Column({ name: "path", type: "text" })
  path: string;

  @ApiProperty({ description: "Is Directory" })
  @Column({ name: "is_directory", type: "boolean" })
  isDirectory: boolean;

  @ApiProperty({ description: 'Is file deleted' })
  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted: boolean;

  @ApiProperty({ description: "Source Server file checksum" })
  @Column({ name: "source_checksum", type: "text", nullable: true })
  sourceChecksum: string;

  @ApiProperty({ description: "Target Server file checksum" })
  @Column({ name: "target_checksum", type: "text", nullable: true })
  targetChecksum: string;

  @ApiProperty({ description: "Parent Path", type: "text" })
  @Column({ name: "parent_path" })
  parentPath: string;

  @ApiProperty({ description: "Depth of the file in tree  hierarchy" })
  @Column({ name: "depth", type: "int" })
  depth: number;

  @ApiProperty({ description: "File Name" })
  @Column({ name: "file_name", type: "text" })
  fileName: string;

  @ApiProperty({ description: "UID of the inventory" })
  @Column({ name: "uid", type: "text" })
  uid: string;

  @ApiProperty({ description: "GID of the inventory" })
  @Column({ name: "gid", type: "text" })
  gid: string;

  @ApiProperty({ description: "File Size" })
  @Column({ name: "file_size", type: "bigint" })
  fileSize: Long;

  @ApiProperty({ description: "File Type" })
  @Column({ name: "file_type", type: "text" })
  fileType: string;

  @ApiProperty({ description: "Modified Time" })
  @Column({ name: "modified_time", type: "timestamp" })
  modifiedTime: Timestamp;

  @ApiProperty({ description: "Access Time" })
  @Column({ name: "access_time", type: "timestamp" })
  accessTime: Timestamp;

  @ApiProperty({ description: "File Permission" })
  @Column({ name: "file_permission" })
  filePermission: string;

  @ApiProperty({ description: "File Server Exports/Shared Path ID" })
  @Column({ name: "volume_id", type: "uuid" })
  fileServerPathId: string;

  @ApiProperty({ description: "Job Run ID" })
  @Column({ name: "job_run_id", type: "uuid" })
  jobRunId: string;

  @ManyToOne(() => JobRunEntity, (jobRun) => jobRun.inventories, {
    onDelete: "CASCADE",
    orphanedRowAction: "delete",
  })
  @JoinColumn({ name: "job_run_id" })
  jobRuns: JobRunEntity;

  @ManyToOne(() => VolumeEntity, (volume) => volume.inventory, {
    onDelete: "CASCADE",
    orphanedRowAction: "delete",
  })
  @JoinColumn({ name: "volume_id" })
  volume: VolumeEntity;
}
