import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsString, IsNumber, IsOptional } from 'class-validator';

export class JobRunDto {
  @ApiProperty({ description: 'UUID of the job run' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'Job run status' })
  @IsString()
  status: string;

  @ApiProperty({ description: 'Start time of the job' })
  @IsNumber()
  start_time: Date;

  @ApiProperty({ description: 'End time of the job' })
  @IsNumber()
  end_time: Date;

  @ApiProperty({ description: 'Iteration number of the job' })
  @IsNumber()
  iteration_number: number;

  @ApiProperty({ description: 'Job ID associated with this run' })
  @IsOptional()
  @IsNumber()
  job_id: string;
}