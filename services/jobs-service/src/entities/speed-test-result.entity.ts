import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

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

  @ApiProperty({ description: 'Error for read/write test' })
  @Column({ name: 'error', type: 'text' })
  error: string;

  @OneToMany(
    () => SpeedLogEntryEntity,
    (speedLogEntry) => speedLogEntry.speedLog,
    { cascade: true },
  )
  speedLogEntries: SpeedLogEntryEntity[];
}

@Entity({ name: 'network_performance_result' })
export class NetworkPerformanceResultEntity {
  @ApiProperty({ description: 'UUID of the network performance result' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Packet loss percentage' })
  @Column({ name: 'packet_loss', type: 'float', nullable: false })
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

  @ApiProperty({ description: 'Error for read/write test' })
  @Column({ name: 'error', type: 'text' })
  error: string;
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

  @ManyToOne(() => SpeedLogEntity, (speedLog) => speedLog.speedLogEntries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'speed_log_id' })
  speedLog: SpeedLogEntity;

  @ApiProperty({ description: 'Timestamp of the speed log' })
  @Column({ name: 'time_stamp', type: 'varchar', nullable: false })
  timeStamp: string;

  @ApiProperty({ description: 'Speed at the given timestamp' })
  @Column({ type: 'float', nullable: false })
  speed: number;
}
