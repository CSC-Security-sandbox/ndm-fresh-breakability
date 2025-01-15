import { ApiProperty } from "@nestjs/swagger";
import { Column, Entity, JoinColumn, ManyToOne, OneToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Base } from "./base.entity";
import { FileServerEntity } from "./fileserver.entity";
import { ProjectEntity } from "./project.entity";
import { ConfigStatus } from "src/constants/enums";
import { FileServerWorkingDirectoryMappingEntity } from "./fileserver_workingdirectory_mapping.entity";

@Entity({name:'config'})
export class ConfigEntity extends Base {
    @ApiProperty({ description: 'configId' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'Config Name' })
    @Column({ type: 'text', nullable: true,  name:'config_name' })
    configName: string;

    @ApiProperty({ description: 'Config Type' })
    @Column({ type: 'text', nullable: true,  name:'config_type' })
    configType: string;

    @ApiProperty({ description: 'Project ID' })
    @Column({ type: 'uuid', nullable: false , name: 'project_id'})
    projectId: string;

    @ApiProperty({ description: 'status' })
    @Column({ type: 'varchar', nullable: true,  name: 'status', default: ConfigStatus.Draft})
    status: ConfigStatus;

    @ApiProperty({ description: 'Scanned Date' })
    @Column({ name: 'scanned_date' , nullable : true, type : 'timestamp without time zone'})
    scannedDate: Date;

    @OneToMany(()=> FileServerEntity, fileServers=>fileServers.config, { cascade: true,  eager: false})
    fileServers: FileServerEntity[]

    @ManyToOne(() => ProjectEntity, project => project.configs)
    @JoinColumn({ name: 'project_id' })
    project: ProjectEntity;

    @OneToOne(() => FileServerWorkingDirectoryMappingEntity, mapping => mapping.config)
    fileServerWorkingDirectoryMapping: FileServerWorkingDirectoryMappingEntity;
}
