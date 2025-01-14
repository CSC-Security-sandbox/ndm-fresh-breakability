import { ApiProperty } from "@nestjs/swagger";
import { FileServerStatus, Protocol, ProtocolVersion, ServerType } from "src/constants/enums";
import { Column, Entity, JoinColumn, JoinTable, OneToOne, ManyToMany, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { WorkerEntity } from "./worker.entity";
import { Base } from "./base.entity";
import { ConfigEntity } from "./config.entity";
import { VolumeEntity } from "./volume.entity";
import { FileServerWorkingDirectoryMappingEntity } from "./fileserver_workingdirectory_mapping.entity";

@Entity({name:'file_server', schema:'migrateadmin'})
export class FileServerEntity extends Base {
    @ApiProperty({ description: 'File Server ID' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'Host' })
    @Column({ type: 'text', nullable: true,  name:'hostname' })
    host: string;

    @ApiProperty({ description: 'Username' })
    @Column({ type: 'text', nullable: true,  name:'username' })
    userName: string;

    @ApiProperty({ description: 'Protocol' })
    @Column({ type: 'varchar', name: 'protocol', nullable: true})
    protocol: Protocol;

    @ApiProperty({ description: 'Server Type' })
    @Column({ type: 'varchar', name:'server_type' })
    serverType: ServerType;

    @ApiProperty({ description: 'password' })
    @Column({ type: 'text', nullable: true,  name:'password' })
    password: string;

    @ApiProperty({ description: 'configId' })
    @Column({ type: 'uuid', nullable:true,  name: 'config_id'})
    configId: string;

    @ManyToOne(() => ConfigEntity, config => config.fileServers,{ onDelete:'CASCADE', orphanedRowAction : 'delete'})
    @JoinColumn({ name: 'config_id' }) 
    config: ConfigEntity;

    @OneToMany(()=> VolumeEntity, volume=>volume.fileServer, {cascade: true, eager: false})
    volumes: VolumeEntity[]

    @ApiProperty({ description: 'is Refreshed Config' })
    @Column({ name: 'is_refreshed' , nullable : true, type : 'boolean'})
    isRefreshed: boolean;

    @ApiProperty({ description: 'status' })
    @Column({ type: 'varchar', nullable: true,  name: 'status'})
    status: FileServerStatus;

    @ApiProperty({ description: 'protocol version' })
    @Column({ type: 'varchar', nullable: true,  name: 'protocol_version'})
    protocolVersion: ProtocolVersion;

    @OneToOne(() => FileServerWorkingDirectoryMappingEntity, workingDirectoryMapping => workingDirectoryMapping.fileServer)
    workingDirectoryMapping: FileServerWorkingDirectoryMappingEntity;

    @ManyToMany(() => WorkerEntity, worker=>worker.fileServers)
    @JoinTable({
        name: 'file_server_worker',
        joinColumn: {
            name: 'file_server_id',
            referencedColumnName: 'id',
        },
        inverseJoinColumn: {
            name: 'worker_id',
            referencedColumnName: 'workerId',
        },
    })
    workers: WorkerEntity[];
}