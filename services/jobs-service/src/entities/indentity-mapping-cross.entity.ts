import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Base } from './base.entity';
import { JobConfigEntity } from './jobconfig.entity';
import { IdentityMappingEntity } from './indentity-mapping.entity';

@Entity({ name: 'identity_config_cross_mapping' })
export class IdentityConfigCrossMappingEntity extends Base {
  @ApiProperty({ description: 'Cross mapping ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Identity Mapping ID' })
  @Column({ type: 'uuid', nullable: false, name: 'identity_mapping_id' })
  identityMappingId: string;

  @ManyToOne(
    () => IdentityMappingEntity,
    (identityMapping) => identityMapping.id,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'identity_mapping_id' })
  identityMapping: IdentityMappingEntity;

  @ApiProperty({ description: 'Job Config ID' })
  @Column({ type: 'uuid', nullable: false, name: 'job_config_id' })
  jobConfigId: string;

  @ManyToOne(() => JobConfigEntity, (jobConfig) => jobConfig.id, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'job_config_id' })
  jobConfig: JobConfigEntity;

  @ApiProperty({ description: 'Indicates if the mapping is orphaned' })
  @Column({ type: 'boolean', default: false, name: 'is_orphan' })
  isOrphan: boolean;
}
