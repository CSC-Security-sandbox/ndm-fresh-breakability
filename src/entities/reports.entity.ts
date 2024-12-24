import { ApiProperty } from "@nestjs/swagger";
import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";


@Entity({name:'reports', schema:'migrateadmin'})
export class ReportsEntity{
    @ApiProperty({ description: 'reportId' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'Report Data' })
    @Column({ type: 'text', nullable: true,  name:'report_data' })
    reportData: string;

    @ApiProperty({ description: 'Report Data' })
    @Column({ type: 'timestamp', nullable: true,  name:'created_at' })
    createdAt: string;


    @ApiProperty({ description: 'Job Run Id'})
    @Column({ type: 'uuid', nullable: true,  name:'job_run_id' })
    jobRunId: string;

    @ApiProperty({ description: 'Report Type'})
    @Column({ type: 'text', nullable: true,  name:'report_type' })
    reportType: string;

}