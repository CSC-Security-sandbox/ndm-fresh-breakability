import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty } from '@nestjs/swagger';
import { CreateConfigurationDto, CreateMountDto, CreateShareDto } from './createconfiguration.dto';
import { ConfigurationType, Protocol, ServerType } from '../../schemas/Configuration.schema';

export class UpdateConfigurationDto extends PartialType(CreateConfigurationDto) {
    @ApiProperty({description: 'Configuration type'})
    configurationType?: ConfigurationType;

    @ApiProperty({ description: 'User name', example: 'admin', required: false })
    userName?: string;

    @ApiProperty({ description: 'Host', example: 'localhost', required: false })
    host?: string;

    @ApiProperty({ description: 'Protocol', example: 'NFS', required: false })
    protocol?: Protocol;
   
    @ApiProperty({description: 'Server type'})
    serverType?: ServerType;

    @ApiProperty({ description: 'List of mounts', type: [CreateMountDto], required: false })
    mounts?: CreateMountDto[];

    @ApiProperty({ description: 'List of shares', type: [CreateShareDto], required: false })
    shares?: CreateShareDto[];
}