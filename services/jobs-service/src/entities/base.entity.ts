import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export class Base {
  @ApiProperty({ description: 'created_at' })
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty({ description: 'updated_at' })
  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt: Date;

  @ApiProperty({ description: 'created_by' })
  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @ApiProperty({ description: 'updated_by' })
  @Column({ name: 'updated_by', nullable: true })
  updatedBy: string;
}
