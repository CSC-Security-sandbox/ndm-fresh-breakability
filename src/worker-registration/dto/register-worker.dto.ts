
import { IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterWorkerDto {
  @ApiProperty({ description: 'Project Id' })
  @IsUUID()
  projectId: string;
}


export class RegisterWorkerResponseDto {
  @ApiProperty({ description: 'WorkerId' })
  @IsString()
  workerId: string;

  @ApiProperty({ description: 'workerSecret' })
  @IsString()
  workerSecret: string;

  @ApiProperty({ description: 'controlPlaneIp' })
  @IsString()
  controlPlaneIp: string;

  constructor(workerId?: string, workerSecret?: string, controlPlaneIp?: string) {
    this.workerId = workerId;
    this.workerSecret = workerSecret;
    this.controlPlaneIp = controlPlaneIp;
  }

  set setWorkerSecret(value: string) {
    this.workerSecret = value;
  }

  set setControlPlaneIp(value: string) {
    this.controlPlaneIp = value;
  }

  set setWorkerId(value: string) {
    this.workerId = value;
  }
}
