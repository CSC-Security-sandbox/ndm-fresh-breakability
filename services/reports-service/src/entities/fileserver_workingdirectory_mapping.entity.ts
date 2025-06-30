import { ApiProperty } from "@nestjs/swagger";
import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Base } from "./base.entity";
import { FileServerEntity } from "./fileserver.entity";

@Entity({ name: "fileserver_workingdirectory_mapping" })
export class FileServerWorkingDirectoryMappingEntity extends Base {
  @ApiProperty({
    description: "UUID of the fileserver working directory mapping",
  })
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ApiProperty({ description: "Path Name" })
  @Column({ type: "text", nullable: true, name: "path_name" })
  pathName: string;

  @ApiProperty({ description: "Working Directory" })
  @Column({ type: "text", nullable: true, name: "working_directory" })
  workingDirectory: string;

  @ApiProperty({ description: "Path ID" })
  @Column({ type: "uuid", nullable: true, name: "path_id" })
  pathId: string;

  @ApiProperty({ description: "Config ID" })
  @Column({ type: "uuid", nullable: true, name: "config_id" })
  configId: string;

  @OneToOne(
    () => FileServerEntity,
    (fileServer) => fileServer.workingDirectory,
    { onDelete: "CASCADE" }
  )
  @JoinColumn({ name: "config_id" })
  fileServer: FileServerEntity;
}
