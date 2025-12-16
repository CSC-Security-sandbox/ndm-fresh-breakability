import { ApiProperty } from "@nestjs/swagger";
import { Column, Entity, JoinColumn, ManyToOne, OneToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Base } from "./base.entity";
import { FileServerEntity } from "./fileserver.entity";
import { ProjectEntity } from "./project.entity";
import { FileServerWorkingDirectoryMappingEntity } from "./fileserver_workingdirectory_mapping.entity";
import { ConfigStatus } from "src/constants/enums";

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
    @Column({ type: 'varchar', nullable: true,  name: 'status'})
    status: ConfigStatus;

    @ApiProperty({ description: 'Scanned Date' })
    @Column({ name: 'scanned_date' , nullable : true, type : 'timestamp without time zone'})
    scannedDate: Date;

    @ApiProperty({ description: 'Error message' })
    @Column({ name: 'error_message', type: 'text', nullable: true })
    errorMessage: string;

    @ApiProperty({ description: 'Hostname' })
    @Column({ type: 'text', nullable: true, name: 'hostname' })
    hostname: string;

    @ApiProperty({ description: 'Port' })
    @Column({ type: 'integer', nullable: true, name: 'port' })
    port: number;

    @ApiProperty({ description: 'Server Type' })
    @Column({ type: 'text', nullable: true, name: 'server_type' })
    serverType: string;

    @ApiProperty({ description: 'Username' })
    @Column({ type: 'text', nullable: true, name: 'username' })
    username: string;

    @ApiProperty({ description: 'Password' })
    @Column({ type: 'text', nullable: true, name: 'password' })
    password: string;

    @ApiProperty({ description: 'TLS Accepted' })
    @Column({ type: 'boolean', nullable: true, name: 'tls_accepted' })
    tlsAccepted: boolean;

    @ApiProperty({ description: 'TLS CA Certificate' })
    @Column({ type: 'text', nullable: true, name: 'tls_ca_certificate' })
    tlsCaCertificate: string;

    @OneToMany(()=> FileServerEntity, fileServers=>fileServers.config, { cascade: true,  eager: false})
    fileServers: FileServerEntity[]

    @ManyToOne(() => ProjectEntity, project => project.configs)
    @JoinColumn({ name: 'project_id' })
    project: ProjectEntity;

    @OneToOne(() => FileServerWorkingDirectoryMappingEntity, mapping => mapping.config)
    workingDirectory: FileServerWorkingDirectoryMappingEntity;
}
