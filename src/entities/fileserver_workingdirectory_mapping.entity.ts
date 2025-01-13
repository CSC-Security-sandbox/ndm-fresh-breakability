import { ApiProperty } from "@nestjs/swagger";
import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from "typeorm";
import { Base } from "./base.entity";
import { VolumeEntity } from "./volume.entity";

@Entity({name:'fileserver_workingdirectory_mapping', schema:'migrateadmin'})
export class FileServerWorkingDirectoryMappingEntity extends Base {
    @ApiProperty({ description: 'UUID of the fileserver working directory mapping' })
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

    @OneToOne(() => VolumeEntity, volume => volume.fileServerWorkingDirectoryMapping)
    @JoinColumn({ name: 'path_id' })
    volume: VolumeEntity;
}
