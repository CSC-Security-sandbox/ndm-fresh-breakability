import { IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterWorkerDto {
  @ApiProperty({ description: 'Project Id' })
  @IsUUID()
  projectId: string;
}

export class RegisterWorkerResponseDto {
  @ApiProperty({ description: 'Project Id' })
  @IsUUID()
  projectId: string;

  @ApiProperty({ description: 'WorkerId' })
  @IsString()
  workerId: string;

  @ApiProperty({ description: 'workerSecret' })
  @IsString()
  workerSecret: string;

  @ApiProperty({ description: 'controlPlaneIp' })
  @IsString()
  controlPlaneIp: string;

  constructor(
    projectId?: string,
    workerId?: string,
    workerSecret?: string,
    controlPlaneIp?: string,
  ) {
    this.projectId = projectId;
    this.workerId = workerId;
    this.workerSecret = workerSecret;
    this.controlPlaneIp = controlPlaneIp;
  }

  set setProjectId(value: string) {
    this.projectId = value;
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
