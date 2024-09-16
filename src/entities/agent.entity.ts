import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, ManyToMany } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { AgentStatus } from 'src/constants/enums';
import { ProjectEntity } from './project.entity';
import { Base } from './base.entity';
import { FileServerEntity } from './fileserver.entity';

@Entity({name:'agent', schema:'kunal'})
export class AgentEntity extends Base  {
  @ApiProperty({ description: 'agentId' })
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  agentId: string;

  @ApiProperty({ description: 'projectId' })
  @Column({ type: 'uuid', nullable: false , name: 'project_id'})
  projectId: string;


  @ApiProperty({ description: 'clientId' })
  @Column({ type: 'varchar', length: 255, nullable: false, name:'client_id' })
  clientId: string;

  @ApiProperty({ description: 'agentName' })
  @Column({ type: 'varchar', length: 255, nullable: false, name:'agent_name' })
  agentName: string;

  @ApiProperty({ description: 'ipAddress' })
  @Column({ type: 'varchar', length: 255, nullable: false , name: 'ip_address' })
  ipAddress: string;

  @ManyToOne(() => ProjectEntity, project => project.agents)
  @JoinColumn({ name: 'project_id' }) 
  project: ProjectEntity;

  @ApiProperty({ description: 'status' })
  @Column({ type: 'enum', enum: AgentStatus, default: AgentStatus.Offline, name:'status' })
  status: AgentStatus;

  @ManyToMany(() => FileServerEntity, fileServers=>fileServers.agents,{cascade: true, orphanedRowAction: 'delete', onDelete:'CASCADE', onUpdate:'CASCADE'})
  fileServers: FileServerEntity[];

}
