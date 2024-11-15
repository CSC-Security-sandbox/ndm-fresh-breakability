import { IsArray, ArrayNotEmpty, IsString, ValidateNested, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Protocol } from 'src/constants/enums';


class WorkerDetails {
  @ApiProperty({ description: 'Worker ID', example: 'workerId' })
  @IsString()
  @IsNotEmpty()   
  workerId: string;
}

export class MountConnectionsDTO {
  @ApiProperty({
    description: 'List of worker details',
    type: [WorkerDetails],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => WorkerDetails)
  workers: WorkerDetails[];


  @ApiProperty({
    description: 'List of protocols',
    enum: Protocol,
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  protocol: Protocol[];

  @ApiPropertyOptional({description: 'configId'})
  @IsString()
  configId: string

}
