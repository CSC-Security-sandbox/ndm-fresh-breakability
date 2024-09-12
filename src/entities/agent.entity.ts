import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { AgentStatus } from 'src/constants/enums';

@Entity({name:'agent', schema:'data'})
export class AgentEntity {
  @ApiProperty({ description: 'agentId' })
  @PrimaryColumn({ type: 'uuid', })
  agentId: string;

  @ApiProperty({ description: 'projectId' })
  @Column({ type: 'varchar', length: 255, nullable: false })
  projectId: string;

  @ApiProperty({ description: 'clientId' })
  @Column({ type: 'varchar', length: 255, nullable: false })
  clientId: string;

  @ApiProperty({ description: 'status' })
  @Column({ type: 'enum', enum: AgentStatus, default: AgentStatus.Offline })
  status: AgentStatus;

  @ApiProperty({ description: 'agentName' })
  @Column({ type: 'varchar', length: 255, nullable: false })
  agentName: string;

  @ApiProperty({ description: 'ipAddress' })
  @Column({ type: 'varchar', length: 255, nullable: false })
  ipAddress: string;

  @ApiProperty({ description: 'createdOn' })
  @CreateDateColumn({ name: 'createdOn', type: 'timestamp' })
  createdOn: Date;

  @ApiProperty({ description: 'updatedAt' })
  @UpdateDateColumn({ name: 'updatedAt', type: 'timestamp' })
  updatedAt: Date;
}
