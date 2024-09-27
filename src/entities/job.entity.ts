import { ApiProperty } from "@nestjs/swagger";
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Base } from "./base.entity";
import { ConfigEntity } from "./config.entity";
import { ProjectEntity } from "./project.entity";

@Entity({name:'job', schema:'migrate'})
export class JobEntity extends Base {
    @ApiProperty({ description: 'configId' })
    @PrimaryGeneratedColumn('uuid')
    id: string;
  
    @ApiProperty({ description: 'projectId' })
    @Column({ type: 'uuid', nullable: false , name: 'project_id'})
    projectId: string;

    @ApiProperty({ description: 'sourceConfigId' })
    @Column({ type: 'uuid', nullable: false , name: 'source_config_id'})
    sourceConfigId: string;

    @ApiProperty({ description: 'targetConfigId' })
    @Column({ type: 'uuid', nullable: false , name: 'target_config_id'})
    targetConfigId: string;

    @ManyToOne(() => ConfigEntity)
    @JoinColumn({ name: 'source_config_id' }) 
    sourceConfig: ConfigEntity;

    @ManyToOne(() => ConfigEntity)
    @JoinColumn({ name: 'target_config_id' }) 
    targetConfig: ConfigEntity;

    @ManyToOne(() => ProjectEntity, project => project.agents)
    @JoinColumn({ name: 'project_id' }) 
    project: ProjectEntity;


}