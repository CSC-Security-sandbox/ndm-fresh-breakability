import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsUUID } from "class-validator";
import { JobStatus, JobType } from "src/entities/jobconfig.entity";

export class JobListingDTO{


    @ApiProperty({ description: 'UUID of the job config' })
    @IsUUID()
    jobConfigId: string;

    @ApiProperty({ description: 'Configuration Name' })
    configName: string;

    @ApiProperty({ description: 'Job type, e.g., discovery', enum: JobType })
    @IsEnum(JobType)
    jobType: string;

    @ApiProperty({ description: 'Status of the job', enum: JobStatus })
    @IsEnum(JobStatus)
    jobStatus: string;

    @ApiProperty({ description: 'protocol' })
    protocol: string;

    @ApiProperty({ description: 'Total Jobs Runs' ,nullable: true}) 
    totalRuns: number;

    @ApiProperty({ description: 'Destination Server Path Details' ,nullable: true})
    destinationPath: string;

    @ApiProperty({ description: 'Source Server Path Details' ,nullable: true})
    sourcePath: string;

    @ApiProperty({ description: 'Error counts for the job config',nullable: true })
    errors: number;

    @ApiProperty({ description: 'Next Schedule Date' ,nullable: true})
    nextScheduleDate:Date;
}
