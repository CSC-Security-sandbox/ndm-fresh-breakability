import { ApiProperty } from '@nestjs/swagger';
import { JobStatus, JobType, Protocol } from 'src/constants/enums';
import { Column, Entity, JoinColumn, ManyToOne,OneToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';

import { JobRunEntity } from './jobrun.entity';
import { VolumeEntity } from './volume.entity';
import { Exclude } from 'class-transformer';


@Entity({ name: 'jobconfig' })
export class JobConfigEntity extends Base {
  @ApiProperty({ description: 'UUID of the job' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Job type, e.g., discovery' })
  @Column({ type: 'varchar', name: 'job_type' })
  jobType: JobType;

  @ApiProperty({ description: 'Status of the job' })
  @Column({ type: 'varchar', name: 'status' })
  status: JobStatus;

  @ApiProperty({ description: 'Exclude files older than this date' })
  @Column({ name: 'exclude_older_than', type: 'timestamp', nullable: true })
  excludeOlderThan: Date | null;

  @ApiProperty({ description: 'Patterns of files to exclude' })
  @Column({ name: 'exclude_file_patterns', type: 'text', nullable: true })
  excludeFilePatterns: string | null;

  @ApiProperty({ description: 'Preserve access time flag' })
  @Column({ name: 'preserve_access_time', type: 'boolean', default: false })
  preserveAccessTime: boolean;

  @ApiProperty({ description: 'Job schedule configuration' })
  @Column({ name: 'first_run_at', type: 'timestamp with time zone' , nullable: true})
  firstRunAt: Date;

  @ApiProperty({ description: 'Incremental job schedule configuration' })
  @Column({ name: 'future_schedule_at', type: 'text', nullable: true })
  futureScheduleAt: string;

  @ApiProperty({ description: 'UUID of the source path configuration' })
  @Column({ type: 'uuid', nullable: false, name: 'source_path_id' })
  sourcePathId: string;

  @ApiProperty({ description: 'UUID of the target path configuration' })
  @Column({ type: 'uuid', nullable: true, name: 'target_path_id' })
  targetPathId: string;

  @OneToMany(() => JobRunEntity, jobRun => jobRun.jobConfig, { cascade: true, eager: false })
  jobRuns: JobRunEntity[];

  @ManyToOne(() => VolumeEntity, volume => volume.sourcePath, { onDelete:'CASCADE'})
  @JoinColumn({ name: 'source_path_id' }) 
  sourcePath: VolumeEntity;

  @ManyToOne(() => VolumeEntity, volume => volume.targetPath, { onDelete:'CASCADE'})
  @JoinColumn({ name: 'target_path_id' }) 
  targetPath: VolumeEntity;

  @OneToMany(() => SpeedTestConfigEntity, speedTestConfig => speedTestConfig.jobConfig, { cascade: true })
  speedTestConfigs: SpeedTestConfigEntity[];

  @Column({ name: 'scheduler', type: 'varchar', nullable: true })
  scheduler: string;

  @Column({ name: 'skip_file', type: 'text', nullable: true })
  skipFile: string;
}


@Entity({ name: 'speed_test_config' })
export class SpeedTestConfigEntity {
  @ApiProperty({ description: 'Job UUID of the speed test config' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'UUID of the related job config' })
  @Column({ type: 'uuid', nullable: false, name: 'job_id' })
  jobId: string;

  @ManyToOne(() => JobConfigEntity, jobConfig => jobConfig.speedTestConfigs, { onDelete: 'CASCADE' })
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

  @OneToMany(() => SpeedTestConfigWorkerEntity, worker => worker.speedTestConfig, { cascade: true })
  workerEntities: SpeedTestConfigWorkerEntity[];
  
}


@Entity({ name: 'speed_test_workers' })
export class SpeedTestConfigWorkerEntity {
  @ApiProperty({ description: 'Primary key for speedtestworkers' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Job UUID of the speedtestconfig' })
  @Column({ type: 'uuid', nullable: false , name: 'job_id'})
  jobId: string;

  @ApiProperty({ description: 'Worker uuid for speedtestconfig' })
  @Column({ type: 'uuid', nullable: false , name: 'workers_id'})
  workersId: string;

  @ManyToOne(() => SpeedTestConfigEntity, speedTestConfig => speedTestConfig.workerEntities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_id' })
  speedTestConfig: SpeedTestConfigEntity;
}


@Entity({ name: 'speed_log' })
export class SpeedLogEntity {
  @ApiProperty({ description: 'UUID of the speed log' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Total time taken for the operation' })
  @Column({ name: 'total_time_taken', type: 'float', nullable: false })
  totalTimeTaken: number;

  @ApiProperty({ description: 'Size of the file used in the test' })
  @Column({ name: 'file_size', type: 'bigint', nullable: false })
  fileSize: number;

  @OneToMany(() => SpeedLogEntryEntity, speedLogEntry => speedLogEntry.speedLog, { cascade: true })
  speedLogEntries: SpeedLogEntryEntity[];
}


@Entity({ name: 'network_performance_result' })
export class NetworkPerformanceResultEntity {
  @ApiProperty({ description: 'UUID of the network performance result' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Packet loss percentage' })
  @Column({name: 'packet_loss', type: 'integer', nullable: false })
  packetLoss: number;

  @ApiProperty({ description: 'Minimum round trip delay' })
  @Column({ name: 'round_trip_delay_min', type: 'float', nullable: false })
  roundTripDelayMin: number;

  @ApiProperty({ description: 'Average round trip delay' })
  @Column({ name: 'round_trip_delay_avg', type: 'float', nullable: false })
  roundTripDelayAvg: number;

  @ApiProperty({ description: 'Maximum round trip delay' })
  @Column({ name: 'round_trip_delay_max', type: 'float', nullable: false })
  roundTripDelayMax: number;

  @ApiProperty({ description: 'Mean deviation of round trip delay' })
  @Column({ name: 'round_trip_delay_mdev', type: 'float', nullable: false })
  roundTripDelayMdev: number;
}


@Entity({ name: 'speed_test_result' })
export class SpeedTestResultEntity {
  @ApiProperty({ description: 'UUID of the speed test result' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'UUID of the related speed test config' })
  @Column({ type: 'uuid', nullable: false, name: 'trace_id' })
  traceId: string;

  @ApiProperty({ description: 'UUID of the related speed test config' })
  @Column({ type: 'uuid', nullable: false, name: 'worker_id' })
  workerId: string;

  @ApiProperty({ description: 'UUID of the related speed test config' })
  @Column({ type: 'uuid', nullable: false, name: 'file_server_id' })
  fileServerId: string;

  @OneToOne(() => SpeedLogEntity, { cascade: true })
  @JoinColumn({ name: 'write_result_id' })
  writeResult: SpeedLogEntity;

  @OneToOne(() => SpeedLogEntity, { cascade: true })
  @JoinColumn({ name: 'read_result_id' })
  readResult: SpeedLogEntity;

  @OneToOne(() => NetworkPerformanceResultEntity, { cascade: true })
  @JoinColumn({ name: 'network_performance_result_id' })
  networkPerformanceResult: NetworkPerformanceResultEntity;
}


@Entity({ name: 'speed_log_entry' })
export class SpeedLogEntryEntity {
  @ApiProperty({ description: 'UUID of the speed log entry' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'UUID of the related speed log' })
  @Column({ type: 'uuid', nullable: false, name: 'speed_log_id' })
  speedLogId: string;

  @ManyToOne(() => SpeedLogEntity, speedLog => speedLog.speedLogEntries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'speed_log_id' })
  speedLog: SpeedLogEntity;

  @ApiProperty({ description: 'Timestamp of the speed log' })
  @Column({ name: 'time_stamp', type: 'varchar', nullable: false })
  timeStamp: string;

  @ApiProperty({ description: 'Speed at the given timestamp' })
  @Column({ type: 'float', nullable: false })
  speed: number;
}
