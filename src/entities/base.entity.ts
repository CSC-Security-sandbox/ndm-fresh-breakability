import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export class Base {

  @ApiProperty({ description: 'createdOn' })
  @CreateDateColumn({ name: 'createdOn', type: 'timestamp' })
  createdOn: Date;

  @ApiProperty({ description: 'updatedAt' })
  @UpdateDateColumn({ name: 'updatedAt', type: 'timestamp' })
  updatedAt: Date;
  
  @ApiProperty({ description: 'createdBy' })
  @Column({ name: 'createdBy', type: 'uuid' })
  createdBy: string;

  @ApiProperty({ description: 'updatedBy' })
  @Column({ name: 'updatedBy', type: 'uuid', nullable: true})
  updatedBy: string;
}
