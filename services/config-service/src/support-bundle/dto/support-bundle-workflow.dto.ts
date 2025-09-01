import { ApiProperty } from '@nestjs/swagger';
import { CreateSupportBundleDTO } from './create-support-bundle.dto';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Options } from 'src/work-manager/dto/validate-connection.dto';

export class SupportBundleWorkflowPayloadDTO extends CreateSupportBundleDTO {
  @ApiProperty({ description: 'User ID', type: String, format: 'uuid' })
  @IsUUID()
  @IsNotEmpty()
  userId: string;
}
