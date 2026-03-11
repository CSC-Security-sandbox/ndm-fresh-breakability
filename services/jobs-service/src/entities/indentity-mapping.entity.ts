import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';

@Entity({ name: 'identity_mapping' })
export class IdentityMappingEntity extends Base {
  @ApiProperty({ description: 'Mapping ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Identity Type' })
  @Column({ type: 'text', nullable: true, name: 'identity_type' })
  identityType: string;

  @ApiProperty({ description: 'Identity Map' })
  @Column({ type: 'uuid', nullable: false, name: 'identity_map' })
  identityMap: string;

  @ApiProperty({ description: 'Source Mapping' })
  @Column({ type: 'text', name: 'source_mapping', nullable: true })
  sourceMapping: string;

  @ApiProperty({ description: 'Target Mapping' })
  @Column({ type: 'text', name: 'target_mapping', nullable: true })
  targetMapping: string;
}
