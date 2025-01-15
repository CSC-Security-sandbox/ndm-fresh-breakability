import { ApiProperty } from "@nestjs/swagger";
import { Protocol, ServerType } from "src/constants/enums";
import { Column, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne, OneToMany, OneToOne, PrimaryGeneratedColumn } from "typeorm";
import { Base } from "./base.entity";
import { ConfigEntity } from "./config.entity";
import { VolumeEntity } from "./volume.entity";

@Entity({name:'file_server', schema:'migrateadmin'})
export class FileServerEntity extends Base {
    @ApiProperty({ description: 'configId' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'data' })
    @Column({ type: 'text', nullable: true,  name:'hostname' })
    host: string;

    @ApiProperty({ description: 'data' })
    @Column({ type: 'text', nullable: true,  name:'username' })
    userName: string;

    @ApiProperty({ description: 'protocol' })
    @Column({ type: 'text', name:'protocol', nullable: true})
    protocol: Protocol;

    @Column({ type: 'enum', enum: ServerType, name:'server_type' })
    serverType: ServerType;

    @ApiProperty({ description: 'password' })
    @Column({ type: 'text', nullable: true,  name:'password' })
    password: string;

    @ApiProperty({ description: 'configId' })
    @Column({ type: 'uuid', nullable:true,  name: 'config_id'})
    configId: string;

    @OneToOne(() => ConfigEntity, config => config.fileServers,{ onDelete:'CASCADE', orphanedRowAction : 'delete'})
    @JoinColumn({ name: 'config_id' }) 
    config: ConfigEntity;

    @OneToMany(()=> VolumeEntity, volume=>volume.fileServer, {cascade: true, eager: false})
    volumes: VolumeEntity[]

    @ApiProperty({ description: 'is Refreshed Config' })
    @Column({ name: 'is_refreshed' , nullable : true, type : 'boolean'})
    isRefreshed: boolean;
}