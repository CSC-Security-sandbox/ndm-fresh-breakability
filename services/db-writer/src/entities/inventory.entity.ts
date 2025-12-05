import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

@Entity({name:'inventory'})
@Index('idx_id', ['id'])
@Index('idx_path', ['path'])
@Index('idx_file_server_path_id', ['pathId'])
@Index('idx_inventory_job_run_id', ['jobRunId'])
@Unique('uq_path_job_run_id_is_directory', ['path', 'jobRunId', 'isDirectory'])
export class InventoryEntity {
    @ApiProperty({ description: 'UUID of the inventory' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'Path from where inventory has been discovered' })
    @Column({ name: 'path',type:'text' })
    path: string;

    @ApiProperty({ description: 'Is Directory' })
    @Column({ name: 'is_directory',type:'boolean' })
    isDirectory: boolean;

    @ApiProperty({ description: 'Source Server file checksum' })
    @Column({ name: 'source_checksum',type:'text' , nullable : true})
    sourceChecksum: string;

    @ApiProperty({ description: 'Target Server file checksum' })
    @Column({ name: 'target_checksum' ,type:'text',nullable : true})
    targetChecksum: string;

    @ApiProperty({ description: 'Parent Path', type: 'string' })
    @Column({ name: 'parent_path' })
    parentPath: string;

    @ApiProperty({ description: 'Depth of the file in tree  hierarchy' })
    @Column({ name: 'depth' ,type:'int'})
    depth: number;

    @ApiProperty({ description: 'File Name' })
    @Column({ name: 'file_name' ,type:'text'})
    fileName: string;

    @ApiProperty({ description: 'UID of the inventory' })
    @Column({ name: 'uid' ,type:'text'})
    uid: string;

    @ApiProperty({ description: 'GID of the inventory' })
    @Column({ name: 'gid',type:'text' })
    gid: string;

    @ApiProperty({ description: 'File Size' })
    @Column({ name: 'file_size' ,type:'bigint'})
    fileSize: bigint

    @ApiProperty({ description: 'Extension' })
    @Column({ name: 'extension', type:'text' })
    extension: string;

    @ApiProperty({ description: 'File Type' })
    @Column({ name: 'file_type', type:'text' })
    fileType: string;

    @ApiProperty({ description: 'Modified Time' })
    @Column({ name: 'modified_time',type:'timestamp' })
    modifiedTime: string;

    @ApiProperty({ description: 'Access Time' })
    @Column({ name: 'access_time',type:'timestamp' })
    accessTime: string;

    @ApiProperty({ description: 'File Permission' })
    @Column({ name: 'file_permission' })    
    permission: string;

    @ApiProperty({ description: 'File Server Exports/Shared Path ID' })
    @Column({ name: 'volume_id',type:'uuid' })    
    pathId: string;

    @ApiProperty({ description: 'Birth Time' })
    @Column({ name: 'birth_time',type:'timestamp' })
    birthTime: string;

    @ApiProperty({ description: 'Job Run ID' })
    @Column({ name: 'job_run_id',type:'uuid' })
    jobRunId: string;

    @ApiProperty({ description: 'created_at' })
    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @ApiProperty({ description: 'updated_at' })
    @UpdateDateColumn({ name: 'updated_at',nullable:true })
    updatedAt: Date;

    @ApiProperty({ description: 'Source Metadata', nullable: true })
    @Column({ name: 'source_meta', type: 'jsonb', nullable: true })
    sourceMeta: Record<string, any>;    

    @ApiProperty({ description: 'Target Metadata', nullable: true })
    @Column({ name: 'target_meta', type: 'jsonb', nullable: true })
    targetMeta: Record<string, any>;    

    @ApiProperty({ description: 'Inode number', nullable: true })
    @Column({ name: 'inode', type: 'numeric', nullable: true })
    inode: number;  

    @ApiProperty({ description: 'Is file deleted' })
    @Column({ name: 'is_deleted', type: 'boolean', default: false })
    isDeleted: boolean;
}