import { ApiProperty } from "@nestjs/swagger";
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Base } from "./base.entity";
import { FileServerEntity } from "./fileserver.entity";
import { JobConfigEntity } from "./jobconfig.entity";
import { InventoryEntity } from "./inventory.entity";

@Entity({name:'volume'})
export class VolumeEntity extends Base {
    @ApiProperty({ description: 'configId' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'data' })
    @Column({ type: 'text', nullable: true,  name:'volume_path' })
    volumePath: string;

    @ApiProperty({ description: 'reachable worker Count' })
    @Column({ type: 'int', nullable: true,  name:'reachable_count' })
    reachableCount: number;

    @ApiProperty({ description: 'fileServerId' })
    @Column({ type: 'uuid', nullable:true,  name: 'file_server_id'})
    fileServerId: string;

    @ApiProperty({ description: 'isDiscoveryDone' })
    @Column({ type: 'boolean', nullable:true,  name: 'is_discovery_done', default: false})
    isDiscoveryDone: string;

    @ApiProperty({ description: 'isBaselineMigrationDone' })
    @Column({ type: 'boolean', nullable:true,  name: 'is_baseline_migration_done', default: false})
    isBaselineMigrationDone: string;

    @ManyToOne(() => FileServerEntity, fileServer => fileServer.volumes, { onDelete:'CASCADE', orphanedRowAction : 'delete'})
    @JoinColumn({ name: 'file_server_id' }) 
    fileServer: FileServerEntity;

    @OneToMany(()=> JobConfigEntity, inventory=>inventory.sourcePath,{ cascade: true,  eager: false})
    sourceConfig: JobConfigEntity[]

    @OneToMany(()=> JobConfigEntity, inventory=>inventory.destinationPath,{ cascade: true,  eager: false})
    targetConfig: JobConfigEntity[]

    @OneToMany(()=> InventoryEntity, inventory=>inventory.volume,{ cascade: true,  eager: false})
    inventory: InventoryEntity[]
}
