import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';

@Entity({ name: 'jobconfig', schema: 'migrate' })
export class JobConfigEntity extends Base {
  @ApiProperty({ description: 'UUID of the job' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'UUID of the file server' })
  @Column({ type: 'uuid', nullable: false, name: 'file_server_id' })
  file_server_id: string;

  @ApiProperty({ description: 'UUID of the path configuration' })
  @Column({ type: 'uuid', nullable: false, name: 'path_id' })
  path_id: string;

  @ApiProperty({ description: 'Job type, e.g. discovery' })
  @Column({ name: 'job_type' })
  job_type: string;

  @ApiProperty({ description: 'Scheduled time of a job' })
  @Column({ name: 'schedule_time' })
  schedule_time: Date;

  @ApiProperty({ description: 'Status of a job' })
  @Column({ name: 'status' })
  status: string;
}


