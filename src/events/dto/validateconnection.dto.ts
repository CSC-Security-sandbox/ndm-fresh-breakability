import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Protocol } from 'src/constants/enums';

class ProtocolsDTO {
  @ApiProperty({
    description: 'protocol',
    example: Protocol.NFS
  })
  @IsEnum(Protocol)
  protocol: Protocol

  @ApiProperty({
    description: 'username',
    type: [String], example: 'root'
  })
  @IsString()
  username: string

  @ApiPropertyOptional({
    description: 'password',
    type: [String], example: '***'
  })
  @IsString()
  password: string

}

export class ValidateConnectionDto {

  @ApiProperty({
    description: 'hostname',
    type: [String], example: 'localhost'
  })
  @IsString()
  hostname: string
  
  @ApiProperty({
    description: 'protocols',
    type: [ProtocolsDTO], 
  })
  @IsArray()
  @ArrayMinSize(1) 
  @ValidateNested({ each: true })
  @Type(() => ProtocolsDTO) 
  protocols: ProtocolsDTO[];



  @ApiProperty({
    description: 'List of workers',
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  workers: string[];

}
