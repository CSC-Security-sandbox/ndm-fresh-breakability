import { ApiProperty } from "@nestjs/swagger";
import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import { Base } from "./base.entity";

@Entity({name:'fileserver_workingdirectory_mapping', schema:'migrateadmin'})
export class FileServerWorkingDirectoryMappingEntity extends Base {
    @ApiProperty({ description: 'UUID of the ' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'Path Name' })
    @Column({ type: 'text', nullable: true,  name:'path_name' })
    pathName: string;

    @ApiProperty({ description: 'Working Directory' })
    @Column({ type: 'text', nullable: true,  name:'working_directory' })
    workingDirectory: string;

    @ApiProperty({ description: 'pathId' })
    @Column({ type: 'uuid', nullable:true,  name: 'path_id'})
    pathId: string;
}
