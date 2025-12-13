import { ApiProperty } from "@nestjs/swagger";
import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import { ServerType } from "src/constants/enums";
import { Base } from "./base.entity";

@Entity({ name: 'management_server', schema: 'datamigrator' })
export class ManagementServerEntity extends Base {
    @ApiProperty({ description: 'Management Server ID' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'Management Server Name' })
    @Column({ type: 'text', nullable: false, name: 'name' })
    name: string;

    @ApiProperty({ description: 'Project ID' })
    @Column({ type: 'uuid', nullable: false, name: 'project_id' })
    projectId: string;

    @ApiProperty({ description: 'Hostname' })
    @Column({ type: 'text', nullable: false, name: 'hostname' })
    hostname: string;

    @ApiProperty({ description: 'Server Type' })
    @Column({ type: 'varchar', name: 'server_type' })
    serverType: ServerType;

    @ApiProperty({ description: 'Username' })
    @Column({ type: 'text', nullable: false, name: 'username' })
    username: string;

    @ApiProperty({ description: 'Password' })
    @Column({ type: 'text', nullable: true, name: 'password' })
    password: string;

    @ApiProperty({ description: 'TLS Accepted' })
    @Column({ type: 'boolean', nullable: true, name: 'tls_accepted', default: false })
    tlsAccepted: boolean;

}
