import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Base } from './base.entity';

export enum JobIdMappingType {
  Gid = 'GID',
  Uid = 'UID',
  Sid = 'SID'
}
@Entity({ name: 'jobidmapping', schema: 'migrateadmin' })
export class JobIdMappingEntity extends Base {
  @ApiProperty({ description: 'UUID of the job mapping' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'UUID of the file server' })
  @Column({ type: 'uuid', nullable: false, name: 'file_server_id' })
  jobConfigId: string;

  @ApiProperty({ description: 'Type of mapping, e.g. GID | UID | SID' })
  @Column({ type: 'enum', enum: JobIdMappingType, nullable: false, name: 'type' })
  type: JobIdMappingType;

  @ApiProperty({ description: 'source id' })
  @Column({ name: 'source_id', nullable: false })
  sourceId: string;

  @ApiProperty({ description: 'destination' })
  @Column({ name: 'destination_id', nullable: false })
  destinationId: string;
}