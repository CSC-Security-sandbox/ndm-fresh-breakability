import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Protocol } from 'src/constants/enums';
import { Exclude } from 'class-transformer';
import { JobConfigEntity } from './jobconfig.entity';

@Entity({ name: 'speed_test_config' })
export class SpeedTestConfigEntity {
  @ApiProperty({ description: 'Job UUID of the speed test config' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'UUID of the related job config' })
  @Column({ type: 'uuid', nullable: false, name: 'job_id' })
  jobId: string;

  @ManyToOne(() => JobConfigEntity, (jobConfig) => jobConfig.speedTestConfigs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'job_id' })
  jobConfig: JobConfigEntity;

  @ApiProperty({ description: 'UUID for File server' })
  @Column({ type: 'uuid', nullable: false, name: 'file_server_name' })
  fileServer: string;

  @ApiProperty({ description: 'protocol for File server' })
  @Column({ type: 'varchar', nullable: false, name: 'protocol' })
  protocol: Protocol;

  @ApiProperty({ description: 'read test' })
  @Column({ name: 'read_test', type: 'boolean', default: true })
  readTest: boolean;

  @ApiProperty({ description: 'write test' })
  @Column({ name: 'write_test', type: 'boolean', default: true })
  writeTest: boolean;

  @ApiProperty({ description: 'packet loss test' })
  @Column({ name: 'packet_loss_test', type: 'boolean', default: true })
  packetLossTest: boolean;

  @ApiProperty({ description: 'List of workers' })
  @Exclude()
  workers: string[];

  @OneToMany(
    () => SpeedTestConfigWorkerEntity,
    (worker) => worker.speedTestConfig,
    { cascade: true },
  )
  workerEntities: SpeedTestConfigWorkerEntity[];
}

@Entity({ name: 'speed_test_workers' })
export class SpeedTestConfigWorkerEntity {
  @ApiProperty({ description: 'Primary key for speedtestworkers' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Job UUID of the speedtestconfig' })
  @Column({ type: 'uuid', nullable: false, name: 'speed_test_config_id' })
  speedTestConfigId: string;

  @ApiProperty({ description: 'Worker uuid for speedtestconfig' })
  @Column({ type: 'uuid', nullable: false, name: 'workers_id' })
  workersId: string;

  @ManyToOne(
    () => SpeedTestConfigEntity,
    (speedTestConfig) => speedTestConfig.workerEntities,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'speed_test_config_id' })
  speedTestConfig: SpeedTestConfigEntity;
}
