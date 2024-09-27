import { ApiProperty } from "@nestjs/swagger";
import { Protocol, ServerType } from "src/constants/enums";
import { Column, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { AgentEntity } from "./agent.entity";
import { Base } from "./base.entity";
import { ConfigEntity } from "./config.entity";
import { VolumeEntity } from "./volume.entity";

@Entity({name:'file_server', schema:'migrate'})
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

    @ApiProperty({ description: 'projectId' })
    @Column({ type: 'uuid', nullable:true,  name: 'file_server_id'})
    configId: string;

    @ManyToOne(() => ConfigEntity, config => config.fileServers,{ onDelete:'CASCADE', onUpdate:'CASCADE', orphanedRowAction : 'delete'})
    @JoinColumn({ name: 'config_id' }) 
    config: ConfigEntity;

    @OneToMany(()=> VolumeEntity, volume=>volume.fileServer, {cascade: true, eager: true})
    volumes: VolumeEntity[]

    @ManyToMany(() => AgentEntity, agent=>agent.fileServers)
    @JoinTable({
        name: 'file_server_agent',
        joinColumn: {
            name: 'file_server_id',
            referencedColumnName: 'id',
        },
        inverseJoinColumn: {
            name: 'agent_id',
            referencedColumnName: 'agentId',
        },
    })
    agents: AgentEntity[];
}