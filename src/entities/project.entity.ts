import { ApiProperty } from "@nestjs/swagger";
import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { WorkerEntity } from "./worker.entity";
import { Base } from "./base.entity";

import { ConfigEntity } from "./config.entity";

@Entity({name:'project', schema:'migrate'})
export class ProjectEntity extends Base {
    @ApiProperty({ description: 'configId' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'Project Name' })
    @Column({ type: 'text', nullable: true,  name:'project_name' })
    projectName: string;

    @Column({type:'timestamp without time zone', name:'start_date', nullable: false})
    startDate : string;

    @OneToMany(()=> WorkerEntity, worker=>worker.project, {cascade: true, orphanedRowAction: 'delete', onDelete:'CASCADE'})
    workers: WorkerEntity[]
    
    @OneToMany(()=> ConfigEntity, config=>config.project, {cascade: true, orphanedRowAction: 'delete', onDelete:'CASCADE' })
    configs: ConfigEntity[]

}