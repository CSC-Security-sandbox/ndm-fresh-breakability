import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsUUID } from "class-validator";
import { JobStatus, JobType } from "src/constants/enums";

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

    @ApiProperty({ description: 'Total Jobs Runs' ,nullable: true}) 
    totalRuns: number;

    @ApiProperty({ description: 'Destination Server Path Details' ,nullable: true})
    destinationServer:DestinationServer ;

    @ApiProperty({ description: 'Source Server Path Details' ,nullable: true})
    sourceServer: SourceServer;

    @ApiProperty({ description: 'Error counts for the job config',nullable: true })
    errors: number;

    @ApiProperty({ description: 'Next Schedule Date' ,nullable: true})
    nextScheduleDate:Date;
    
    @ApiProperty({ description: 'Job creation date' })
    createdAt: Date;

    @ApiProperty({ description: 'Job update date' })
    updatedAt: Date;
    
}
export interface SourceServer{
    serverName: string;
    path: string;
    directoryPath?: string;
    protocol: string;
}
export interface DestinationServer{
    serverName?: string;
    path?: string;
    directoryPath?: string;
    protocol?: string;
}
