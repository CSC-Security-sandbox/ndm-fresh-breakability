import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { WorkerEntity } from './worker.entity';
import { Base } from './base.entity';
import { ConfigEntity } from './config.entity';

@Entity({ name: 'project' })
export class ProjectEntity extends Base {
  @ApiProperty({ description: 'configId' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Project Name' })
  @Column({ type: 'text', nullable: true, name: 'project_name' })
  projectName: string;

  @Column({ type: 'date', nullable: true, name: 'start_date' })
  startDate: Date;

  @Column({ type: 'text', nullable: true, name: 'project_description' })
  projectDescription: string;

  @Column({ type: 'uuid', nullable: true, name: 'account_id' })
  accountId: string;

  @OneToMany(() => WorkerEntity, (worker) => worker.project, {
    cascade: true,
    orphanedRowAction: 'delete',
    onDelete: 'CASCADE',
  })
  workers: WorkerEntity[];

  @OneToMany(() => ConfigEntity, (config) => config.project, {
    cascade: true,
    orphanedRowAction: 'delete',
    onDelete: 'CASCADE',
  })
  configs: ConfigEntity[];
}
