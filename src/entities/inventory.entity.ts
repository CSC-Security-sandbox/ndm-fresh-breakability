import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity({ name: 'inventory', schema: 'inventory' })
export class InventoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ name: 'mountPath' })
  mountPath: string;

  @ApiProperty()
  @Column({ name: 'fileServer' })
  fileServer: string;

  @ApiProperty()
  @Column({ name: 'fileName' })
  fileName: string;

  @ApiProperty()
  @Column({ name: 'folder' })
  folder: boolean;

  @ApiProperty()
  @Column({ name: 'metadata', type: 'text' })
  metadata: string;
}
