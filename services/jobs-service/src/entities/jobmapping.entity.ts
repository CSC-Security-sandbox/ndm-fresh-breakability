import { ApiProperty } from '@nestjs/swagger';
import { JobIdMappingType } from 'src/constants/enums';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';

@Entity({ name: 'jobidmapping' })
export class JobIdMappingEntity extends Base {
  @ApiProperty({ description: 'UUID of the job mapping' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'UUID of the file server' })
  @Column({ type: 'uuid', nullable: false, name: 'file_server_id' })
  jobConfigId: string;

  @ApiProperty({ description: 'Type of mapping, e.g. GID | UID | SID' })
  @Column({ type: 'varchar', nullable: false, name: 'type' })
  type: JobIdMappingType;

  @ApiProperty({ description: 'source id' })
  @Column({ name: 'source_id', nullable: false })
  sourceId: string;

  @ApiProperty({ description: 'destination' })
  @Column({ name: 'destination_id', nullable: false })
  destinationId: string;
}
