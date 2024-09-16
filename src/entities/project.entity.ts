import { ApiProperty } from "@nestjs/swagger";
import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { AgentEntity } from "./agent.entity";
import { Base } from "./base.entity";
import { JobEntity } from "./job.entity";
import { ConfigEntity } from "./config.entity";

@Entity({name:'project', schema:'kunal'})
export class ProjectEntity extends Base {
    @ApiProperty({ description: 'configId' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'Project Name' })
    @Column({ type: 'text', nullable: true,  name:'project_name' })
    projectName: string;

    @Column({type:'timestamp without time zone', name:'start_date', nullable: false})
    startDate : string;

    @OneToMany(()=> AgentEntity, agent=>agent.project, {cascade: true, orphanedRowAction: 'delete', onDelete:'CASCADE', onUpdate:'CASCADE'})
    agents: AgentEntity[]

    @OneToMany(()=> JobEntity, job=>job.project, {cascade: true, orphanedRowAction: 'delete', onDelete:'CASCADE', onUpdate:'CASCADE'})
    jobs: JobEntity[]

    @OneToMany(()=> ConfigEntity, config=>config.project, {cascade: true, orphanedRowAction: 'delete', onDelete:'CASCADE', onUpdate:'CASCADE'})
    configs: ConfigEntity[]

}