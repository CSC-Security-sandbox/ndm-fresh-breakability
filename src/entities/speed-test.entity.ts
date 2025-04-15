import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne,OneToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';


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

  @OneToMany(() => SpeedLogEntryEntity, speedLogEntry => speedLogEntry.speedLog, { cascade: true })
  speedLogEntries: SpeedLogEntryEntity[];
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