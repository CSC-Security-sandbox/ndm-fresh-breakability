import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, JoinColumn, ManyToOne } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Protocol } from 'src/constants/enums';
import { RequestType, ResponseStatus } from 'src/constants/status';
import { AgentEntity } from './agent.entity';
import { Base } from './base.entity';

@Entity({name:'request_track', schema:'migrate'})
export class RequestTrackEntity extends Base {
  @ApiProperty({ description: 'Unique identifier for the request' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Type of the request' })
  @Column({ type: 'enum', enum: RequestType, nullable: false, name:'request_type' })
  requestType: RequestType;

  @ApiProperty({ description: 'data' })
  @Column({ type: 'text', nullable: true,  name:'response' })
  response: string;

  @ApiProperty({ description: 'Status of the request', name:'status'  })
  @Column({ type: 'enum', enum: ResponseStatus, default: ResponseStatus.Pending })
  status: ResponseStatus;

  @ApiProperty({ description: 'Protocol of the request',  name:'protocol'  })
  @Column({ type: 'enum', enum: Protocol, nullable: false })
  protocol: Protocol;

  @ApiProperty({ description: 'Agent ID' })
  @Column({ type: 'uuid', nullable: false,  name: 'agent_id'  })
  agentId: string;

  @ApiProperty({ description: 'requestId' })
  @Column({ type: 'uuid', nullable: false,  name: 'request_id'  })
  requestId: string;

  @ManyToOne(() => AgentEntity)
  @JoinColumn({ name: 'agent_id' }) 
  agentEntity: AgentEntity;

}
