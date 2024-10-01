import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export class Base {
  @ApiProperty({ description: 'created_at' })
  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @ApiProperty({ description: 'updated_at' })
  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;
  
  @ApiProperty({ description: 'created_by' })
  @Column({ name: 'created_by' })
  created_by: string;

  @ApiProperty({ description: 'updated_by' })
  @Column({ name: 'updated_by' })
  updated_by: string;
}
