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
  @Column({ name: 'type' })
  type: string;

  @ApiProperty()
  @Column('text', {
    name: 'metadata',
    transformer: {
      to: (value: object) => JSON.stringify(value), // Save as a string in the database
      from: (value: string) => JSON.parse(value),   // Parse it to an object when fetching from the database
    },
  })
  metadata: object;

  @ApiProperty()
  @Column({ name: 'parent_path' })
  parent_path: string;

}
