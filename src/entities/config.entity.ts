import { ApiProperty } from "@nestjs/swagger";
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Base } from "./base.entity";
import { FileServerEntity } from "./fileserver.entity";
import { ProjectEntity } from "./project.entity";

@Entity({name:'config', schema:'migrate'})
export class ConfigEntity extends Base {
    @ApiProperty({ description: 'configId' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'data' })
    @Column({ type: 'text', nullable: true,  name:'config_name' })
    configName: string;

    @ApiProperty({ description: 'data' })
    @Column({ type: 'text', nullable: true,  name:'config_type' })
    configType: string;

    @ApiProperty({ description: 'projectId' })
    @Column({ type: 'uuid', nullable: false , name: 'project_id'})
    projectId: string;

    @OneToMany(()=> FileServerEntity, fileServers=>fileServers.config, { cascade: true,  eager: false})
    fileServers: FileServerEntity[]

    @ManyToOne(() => ProjectEntity, project => project.configs)
    @JoinColumn({ name: 'project_id' }) 
    project: ProjectEntity;

    @ApiProperty({ description: 'refreshedOn' })
    @Column({ name: 'refreshed_on' , nullable : true, type : 'timestamp without time zone'})
    refreshedOn: Date;

}