import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Protocol } from 'src/constants/enums';
import { RequestType, ResponseStatus } from 'src/constants/status';

@Entity({name:'request_track', schema:'data'})
export class RequestTrackEntity {
  @ApiProperty({ description: 'Unique identifier for the request' })
  @PrimaryGeneratedColumn('uuid')
  requestId: string;

  @ApiProperty({ description: 'Type of the request' })
  @Column({ type: 'enum', enum: RequestType, nullable: false })
  requestType: RequestType;

  @ApiProperty({ description: 'Response' })
  @Column({ type: 'text', nullable: true })
  response: string;

  @ApiProperty({ description: 'Status of the request' })
  @Column({ type: 'enum', enum: ResponseStatus, default: ResponseStatus.Pending })
  status: ResponseStatus;

  @ApiProperty({ description: 'Protocol of the request' })
  @Column({ type: 'enum', enum: Protocol, nullable: false })
  protocol: Protocol;

  @ApiProperty({ description: 'Agent ID' })
  @Column({ type: 'uuid', nullable: false })
  agentId: string;

  @ApiProperty({ description: 'Creation timestamp' })
  @CreateDateColumn()
  createdOn: Date;

  @ApiProperty({ description: 'Last updated timestamp' })
  @UpdateDateColumn()
  updatedAt: Date;
}
