import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';
import { UploadPathAction } from '../constants/enums';

@Entity({ name: 'path_uploads' })
export class PathUploadsEntity extends Base {
    @ApiProperty({ description: 'UUID of the path upload' })
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ApiProperty({ description: 'Upload ID associated with this path upload' })
    @Column({ type: 'uuid', name: 'upload_id' })
    uploadId: string;

    @ApiProperty({ description: 'Volume path for the upload' })
    @Column({ type: 'text', name: 'volume_path' })
    volumePath: string;

    @ApiProperty({ description: 'File name of the upload' })
    @Column({ type: 'text', name: 'file_name' })
    fileName: string;

    @ApiProperty({ enum: UploadPathAction, description: 'Action to be performed on the path upload' })
    @Column({ type: 'enum', enum: UploadPathAction, name: 'action' })
    action: UploadPathAction;

    @ApiProperty({ description: 'File server ID associated with this path upload' })
    @Column({ type: 'uuid', name: 'file_server_id' })
    fileServerId: string;
}