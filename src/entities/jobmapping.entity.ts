import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Base } from './base.entity';

@Entity({ name: 'jobidmapping', schema: 'migrate' })
export class JobMappingEntity extends Base {
  @ApiProperty({ description: 'UUID of the job mapping' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'UUID of the file server' })
  @Column({ type: 'uuid', nullable: false, name: 'file_server_id' })
  job_config_id: string;

  @ApiProperty({ description: 'Type of mapping, e.g. GID' })
  @Column({ nullable: false, name: 'type' })
  type: string;

  @ApiProperty({ description: 'source id' })
  @Column({ name: 'source_id', nullable: false })
  source_id: string;

  @ApiProperty({ description: 'destination' })
  @Column({ name: 'destination_id', nullable: false })
  destination_id: string;

  @ApiProperty({ description: 'Timestamp when the entity was created' })
  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @ApiProperty({ description: 'Timestamp when the entity was last updated' })
  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;
}