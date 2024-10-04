import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity({ name: 'inventory' })
export class InventoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ name: 'mount_path' })
  mount_path: string;

  @ApiProperty()
  @Column({ name: 'file_server' })
  file_server: string;

  @ApiProperty()
  @Column({ name: 'file_name' })
  file_name: string;

  @ApiProperty()
  @Column({ name: 'folder' })
  folder: boolean;

  @ApiProperty()
  @Column({ name: 'metadata', type: 'text' })
  metadata: string;
}
