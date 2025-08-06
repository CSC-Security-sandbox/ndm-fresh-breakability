import {
  Entity,
  Column,
  PrimaryColumn,
  ManyToOne,
  JoinColumn,
  ManyToMany,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Platform, WorkerStatus } from 'src/constants/enums';
import { WorkerConfiguration } from 'src/constants/types';
import { Base } from './base.entity';
import { ProjectEntity } from './project.entity';
import { FileServerEntity } from './fileserver.entity';
import { WorkerJobRunMap } from './workerjobrun.entity';
import { WorkerStatsEntity } from 'src/entities/worker-stats.entity';

@Entity({ name: 'worker' })
export class WorkerEntity extends Base {
  @ApiProperty({ description: 'workerId' })
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  workerId: string;

  @ApiProperty({ description: 'projectId' })
  @Column({ type: 'uuid', nullable: false, name: 'project_id' })
  projectId: string;

  @ApiProperty({ description: 'workerName' })
  @Column({
    type: 'varchar',
    length: 255,
    nullable: false,
    name: 'worker_name',
  })
  workerName: string;

  @ApiProperty({ description: 'ipAddress' })
  @Column({ type: 'varchar', length: 255, nullable: false, name: 'ip_address' })
  ipAddress: string;

  @ManyToOne(() => ProjectEntity, (project) => project.workers)
  @JoinColumn({ name: 'project_id' })
  project: ProjectEntity;

  @ApiProperty({ description: 'status' })
  @Column({ type: 'varchar', name: 'status' })
  status: WorkerStatus;

  @ApiProperty({ description: 'envVariables' })
  @Column({ type: 'json', name: 'env_variables', nullable: true })
  envVariables: Record<string, any>;

  @ApiProperty({ description: 'platform' })
  @Column({ type: 'enum', name: 'platform', nullable: true, enum: Platform })
  platform: Platform;

  @ApiProperty({ description: 'workerNumber' })
  @Column({ type: 'int', generated: 'increment', name: 'worker_number' })
  workerNumber: number;

  @Column({ type: 'json', nullable: true, name: 'meta_config' })
  metaConfig: WorkerConfiguration[];

  @ManyToMany(() => FileServerEntity, (fileServers) => fileServers.workers, {
    cascade: true,
    orphanedRowAction: 'delete',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  fileServers: FileServerEntity[];

  @OneToMany(() => WorkerJobRunMap, (jobRunMap) => jobRunMap.worker, {
    cascade: true,
    eager: false,
  })
  jobRunMap: WorkerJobRunMap[];

  @OneToOne(() => WorkerStatsEntity, (workerStats) => workerStats.worker, {
    cascade: true,
  })
  stats: WorkerStatsEntity;
}
