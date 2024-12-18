import { ApiProperty } from "@nestjs/swagger";
import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";


@Entity({name:'reports', schema:'migrateadmin'})
export class ReportsEntity{
    @ApiProperty({ description: 'reportId' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'Report Data' })
    @Column({ type: 'text', nullable: true,  name:'reportdata' })
    reportData: string;

    @ApiProperty({ description: 'Report Data' })
    @Column({ type: 'timestamp', nullable: true,  name:'created_at' })
    createdAt: string;


}