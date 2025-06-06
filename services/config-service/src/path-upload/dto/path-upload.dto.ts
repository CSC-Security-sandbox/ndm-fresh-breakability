import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsNumber, IsString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class PathUploadDto {
    @ApiProperty({ description: 'UUID of the path upload' })
    @IsUUID()
    @IsNotEmpty()
    @Type(() => String)
    uploadId: string;

    @ApiProperty({ description: 'Volume path for the upload' })
    @IsString()
    @IsNotEmpty()
    volumePath: string;

    @ApiProperty({ description: 'File server ID associated with this path upload' })
    @IsUUID()
    @IsNotEmpty()
    fileServerId: string;
}

export class ImportVolumePathsDto {
    @ApiProperty({ description: 'File Name', example: 'file.txt' })
    @IsString()
    fileName: string;

    @ApiProperty({ description: 'File Content', type: 'string', format: 'binary' })
    @IsString()
    contents: string;

    @ApiProperty({ description: 'File Size in bytes', example: 1024 })
    @IsNumber()
    fileSize: number;
}

export class UpdateValidationResultDto {
    @ApiProperty({
      description: 'Validation result array',
      type: [Object],
    })
    @IsArray()
    validationResult: [];
}