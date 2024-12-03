import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/mapped-types';
import { CreateInventoryDto } from './create-inventory.dto';
import { IsString } from 'class-validator';

export class UpdateInventoryDto extends PartialType(CreateInventoryDto) {
  @ApiPropertyOptional()
  @IsString()
  sourceChecksum?: string;

  @ApiPropertyOptional()
  @IsString()
  targetChecksum?: string;
}
