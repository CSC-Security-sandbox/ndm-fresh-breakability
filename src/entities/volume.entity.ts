import { ApiProperty } from "@nestjs/swagger";
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Base } from "./base.entity";
import { FileServerEntity } from "./fileserver.entity";
import { InventoryEntity } from "./inventory.entity";

@Entity({name:'volume', schema:'kunal'})
export class VolumeEntity extends Base {
    @ApiProperty({ description: 'configId' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'data' })
    @Column({ type: 'text', nullable: true,  name:'volume_path' })
    volumePath: string;

    @ApiProperty({ description: 'fileServerId' })
    @Column({ type: 'uuid', nullable: false , name: 'file_server_id'})
    fileServerId: string;

    @ManyToOne(() => FileServerEntity, fileServer => fileServer.volumes)
    @JoinColumn({ name: 'file_server_id' }) 
    fileServer: FileServerEntity;

    @OneToMany(()=> InventoryEntity, inventory=>inventory.volume)
    inventory: InventoryEntity[]
}