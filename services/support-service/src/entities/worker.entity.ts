import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'worker' })
export class WorkerEntity {
  @ApiProperty({ description: 'workerId' })
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  workerId: string;

  @ApiProperty({ description: 'projectId' })
  @Column({ type: 'uuid', nullable: false, name: 'project_id' })
  projectId: string;

  @ApiProperty({ description: 'envVariables' })
  @Column({ type: 'json', name: 'env_variables', nullable: true })
  envVariables: Record<string, any>;
}
