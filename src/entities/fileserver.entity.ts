import { ApiProperty } from "@nestjs/swagger";
import { ServerType } from "src/constants/enums";
import { Protocol } from "src/schemas/Configuration.schema";
import { Column, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Base } from "./base.entity";
import { VolumeEntity } from "./volume.entity";
import { ConfigEntity } from "./config.entity";
import { AgentEntity } from "./agent.entity";

@Entity({name:'file_server', schema:'kunal'})
export class FileServerEntity extends Base {
    @ApiProperty({ description: 'configId' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'data' })
    @Column({ type: 'text', nullable: true,  name:'config_name' })
    host: string;

    @ApiProperty({ description: 'data' })
    @Column({ type: 'text', nullable: true,  name:'config_type' })
    userName: string;

    @ApiProperty({ description: 'protocal' })
    @Column({ type: 'enum', enum: Protocol, name:'protocal' })
    protocal: Protocol;

    @Column({ type: 'enum', enum: ServerType, name:'server_type' })
    serverType: ServerType;

    @ApiProperty({ description: 'configId' })
    @Column({ type: 'uuid', nullable: false , name: 'config_id'})
    configId: string;

    @ManyToOne(() => ConfigEntity, config => config.fileServers)
    @JoinColumn({ name: 'config_id' }) 
    config: ConfigEntity;

    @OneToMany(()=> VolumeEntity, volume=>volume.fileServer)
    volumes: VolumeEntity[]

    @ManyToMany(() => AgentEntity)
    @JoinTable({
        name: 'file_server_agent', // Name of the join table
        joinColumn: {
            name: 'file_server_id',
            referencedColumnName: 'id',
        },
        inverseJoinColumn: {
            name: 'agent_id',
            referencedColumnName: 'agentId',
        },
    })
    inventories: AgentEntity[];
}