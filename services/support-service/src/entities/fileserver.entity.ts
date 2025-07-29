import { ApiProperty } from "@nestjs/swagger";
import { ExportPathSource, Protocol, ProtocolVersion, ServerType } from "src/constants/enum";
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Base } from "./base.entity";
import { ConfigEntity } from "./config.entity";
import { VolumeEntity } from "./volume.entity";

@Entity({ name: 'file_server' })
export class FileServerEntity extends Base {
    @ApiProperty({ description: 'File Server ID' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'Host' })
    @Column({ type: 'text', nullable: true, name: 'hostname' })
    host: string;

    @ApiProperty({ description: 'Username' })
    @Column({ type: 'text', nullable: true, name: 'username' })
    userName: string;

    @ApiProperty({ description: 'Protocol' })
    @Column({ type: 'varchar', name: 'protocol', nullable: true })
    protocol: Protocol;

    @ApiProperty({ description: 'Server Type' })
    @Column({ type: 'varchar', name: 'server_type' })
    serverType: ServerType;

    @ApiProperty({ description: 'password' })
    @Column({ type: 'text', nullable: true, name: 'password' })
    password: string;

    @ApiProperty({ description: 'configId' })
    @Column({ type: 'uuid', nullable: true, name: 'config_id' })
    configId: string;

    @ManyToOne(() => ConfigEntity, config => config.fileServers, { onDelete: 'CASCADE', orphanedRowAction: 'delete' })
    @JoinColumn({ name: 'config_id' })
    config: ConfigEntity;

    @OneToMany(() => VolumeEntity, volume => volume.fileServer, { cascade: true, eager: false })
    volumes: VolumeEntity[]

    @ApiProperty({ description: 'is Refreshed Config' })
    @Column({ name: 'is_refreshed', nullable: true, type: 'boolean' })
    isRefreshed: boolean;

    @ApiProperty({ description: 'protocol version' })
    @Column({ type: 'varchar', nullable: false, name: 'protocol_version' })
    protocolVersion: ProtocolVersion;

    @ApiProperty({ description: 'Export path source' })
    @Column({ type: 'varchar', nullable: true, name: 'export_path_source' })
    exportPathSource: ExportPathSource;

}