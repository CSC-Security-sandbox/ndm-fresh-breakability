import { IsString, IsUUID, IsOptional } from 'class-validator';
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

  @ApiProperty({ description: 'Gateway CA Certificate', nullable: true })
  @IsString()
  @IsOptional()
  gatewayCACertificate: string | null;

  constructor(
    projectId: string,
    workerId?: string,
    workerSecret?: string,
    controlPlaneIp?: string,
    gatewayCACertificate?: string | null,
  ) {
    this.projectId = projectId;
    this.workerId = workerId;
    this.workerSecret = workerSecret;
    this.controlPlaneIp = controlPlaneIp;
    this.gatewayCACertificate = gatewayCACertificate ?? null;
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

  set setGatewayCACertificate(value: string | null) {
    this.gatewayCACertificate = value;
  }
}
