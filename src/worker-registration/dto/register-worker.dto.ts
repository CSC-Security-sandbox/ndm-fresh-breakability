
import { IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterWorkerDto {
  @ApiProperty({ description: 'Name of role to be created' })
  @IsString()
  workerName: string;

  @ApiProperty({ description: 'Project Id' })
  @IsUUID()
  projectId: string;
}
