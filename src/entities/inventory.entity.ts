import { ApiProperty } from "@nestjs/swagger";
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Base } from "./base.entity";
import { VolumeEntity } from "./volume.entity";

@Entity({name:'inventory', schema:'migrate'})
export class InventoryEntity extends Base {
    @ApiProperty({ description: 'configId' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'data' })
    @Column({ type: 'text', nullable: true,  name:'path' })
    path: string;

    @ApiProperty({ description: 'size' })
    @Column({ type: 'text', nullable: true,  name:'size' })
    size: string;

    @ApiProperty({ description: 'permission' })
    @Column({ type: 'text', nullable: true,  name:'permission' })
    permission: string;

    @ManyToOne(() => VolumeEntity, volume => volume.inventory, { onDelete:'CASCADE', onUpdate:'CASCADE', orphanedRowAction : 'delete'})
    @JoinColumn({ name: 'volume_id' }) 
    volume: VolumeEntity;

}