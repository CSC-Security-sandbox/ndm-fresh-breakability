import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class GetConfigurationRequestDto {
  @ApiProperty({
    description: 'Environment variables from the worker',
    required: false,
    type: Object,
    additionalProperties: true,
  })
  @IsObject()
  envVariables: Record<string, any> | null;
}
