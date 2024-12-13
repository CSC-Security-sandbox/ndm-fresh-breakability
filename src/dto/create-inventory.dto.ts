import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsUUID,
  IsNumber,
} from 'class-validator';

export class CreateInventoryDto {
  @ApiProperty()
  // @IsUUID()
  pathId: string;

  @ApiProperty()
  @IsUUID()
  jobRunId: string;

  @ApiProperty()
  @IsString()
  path: string;

  @ApiProperty()
  @IsBoolean()
  isFolder: boolean;

  @ApiProperty()
  @IsString()
  status: string;

  @ApiProperty()
  @IsString()
  parentPath: string;

  @ApiProperty()
  @IsNumber()
  depth: number;

  @ApiProperty()
  @IsString()
  fileName: string;

  @ApiProperty()
  @IsNumber()
  uid: number;

  @ApiProperty()
  @IsNumber()
  gid: number;

  @ApiProperty()
  @IsNumber()
  size: number;

  @ApiProperty()
  @IsNumber()
  blocks: number;

  @ApiProperty()
  @IsString()
  mtime: string;

  @ApiProperty()
  @IsString()
  atime: string;

  @ApiProperty()
  @IsString()
  birthtime: string;

  @ApiProperty()
  @IsString()
  extension: string;

  @ApiProperty()
  @IsString()
  permission: string;
}
