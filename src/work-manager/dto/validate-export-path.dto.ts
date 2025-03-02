import { IsString, IsOptional, IsNotEmpty, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ConfigStatus } from 'src/constants/enums';

export class ListPathDTO {
    @ApiProperty({ enum: ['NFS', 'SMB'], description: 'The type of protocol (NFS or SMB)' })
    @IsString()
    type: 'NFS' | 'SMB';

    @ApiProperty({ description: 'The username for the protocol' })
    @IsString()
    username: string;

    @ApiProperty({ description: 'The password for the protocol (optional)', required: false })
    @IsOptional()
    @IsString()
    password?: string;

    @ApiProperty({ description: 'The host address for the protocol', example: '127.0.0.1:2049' })
    @IsString()
    @IsNotEmpty()
    host: string;
}

export class ConfigStatusPayloadDTO {
    @ApiProperty({ description: 'The ID of the configuration', example: 'abc123' })
    @IsString()
    configId: string;

    @ApiProperty({
        description: 'The status of the configuration',
        enum: ConfigStatus,
        example: ConfigStatus.ACTIVE,
        nullable: true
    })
    @IsOptional()
    @IsEnum(ConfigStatus)
    status: ConfigStatus;

    @ApiProperty({ description: 'Error message if any', example: 'Invalid configuration', nullable: true })
    @IsOptional()
    @IsString()
    errorMessage: string;
}
