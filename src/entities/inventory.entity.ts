import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity({ name: 'inventory', schema: 'inventory' })
export class InventoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // commenting because from discovery pathId comming as string instead of uuid
  // so for testing purpose making it as string
  // @ApiProperty()
  // @Column({ name: 'pathId', type: 'uuid' })
  // pathId: string;

  @ApiProperty()
  @Column({ name: 'pathId', type: 'text' })
  pathId: string;

  @ApiProperty()
  @Column({ name: 'jobRunId', type: 'uuid' })
  jobRunId: string;

  @ApiProperty()
  @Column({ name: 'path', type: 'text' })
  path: string;

  @ApiProperty()
  @Column({ name: 'is_folder' })
  isFolder: boolean;

  @ApiProperty()
  @Column({ name: 'status' })
  status: string;

  @ApiProperty()
  @Column({ name: 'source_checksum', type: 'text', nullable: true })
  sourceChecksum: string | null;

  @ApiProperty()
  @Column({ name: 'target_checksum', type: 'text', nullable: true })
  targetChecksum: string | null;

  @ApiProperty()
  @Column({ name: 'parent_path', type: 'text' })
  parentPath: string;

  @ApiProperty()
  @Column({ name: 'depth' })
  depth: number;

  @ApiProperty()
  @Column({ name: 'fileName', type: 'text' })
  fileName: string;

  @ApiProperty()
  @Column({ name: 'uid' })
  uid: number;

  @ApiProperty()
  @Column({ name: 'gid' })
  gid: number;

  @ApiProperty()
  @Column({ name: 'size' })
  size: number;

  @ApiProperty()
  @Column({ name: 'mtime' })
  mtime: string;

  @ApiProperty()
  @Column({ name: 'atime' })
  atime: string;

  @ApiProperty()
  @Column({ name: 'birthtime' })
  birthtime: string;

  @ApiProperty()
  @Column({ name: 'extension' })
  extension: string;

  @ApiProperty()
  @Column({ name: 'permission' })
  permission: string;
}
