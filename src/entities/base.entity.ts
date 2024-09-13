import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export class Base {

  @ApiProperty({ description: 'createdAt' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'updatedAt' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
  
  @ApiProperty({ description: 'createdBy' })
  @Column({ name: 'created_by', type: 'uuid', })
  createdBy: string;

  @ApiProperty({ description: 'updatedBy' })
  @Column({ name: 'updated_by', type: 'uuid', nullable: true})
  updatedBy: string;
}
