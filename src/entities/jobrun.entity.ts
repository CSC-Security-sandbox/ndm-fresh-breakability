import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';
import { InventoryEntity } from './inventory.entity';
import { JobConfigEntity } from './jobconfig.entity';
import { JobRunStatus } from 'src/constants/enums';



@Entity({ name: 'jobrun', schema: 'migrateadmin' })
export class JobRunEntity extends Base {
  @ApiProperty({ description: 'UUID of the job run' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Job Run status' })
  @Column({ type: 'enum', enum: JobRunStatus, default: JobRunStatus.Pending, name:'status' })
  status: JobRunStatus;

  @ApiProperty({ description: 'Start time of the job' })
  @Column({ name: 'start_time' })
  startTime: Date;

  @ApiProperty({ description: 'End time of the job' })
  @Column({ name: 'end_time' })
  endTime: Date;

  @ApiProperty({ description: 'Job ID associated with this run' })
  @Column({ name: 'job_config_id' })
  jobConfigId: string;

  @OneToMany(() => InventoryEntity, inventory => inventory.jobRunDetails, { cascade: true, eager: false })
  inventoryDetails: InventoryEntity[];

  @ManyToOne(() => JobConfigEntity, jobConfig => jobConfig.jobRunDetails, {eager: false })
  @JoinColumn({ name: 'job_config_id' })
  jobConfig: JobConfigEntity; 
}