import { Type } from 'class-transformer';
import {
  IsString,
  IsBoolean,
  IsArray,
  IsObject,
  IsEmail,
  IsOptional,
  ValidateNested,
  IsUUID,
  IsNumber,
} from 'class-validator';

export class metadataDTO {
    @IsNumber()
    uid: number;

    @IsNumber()
    gid: number;

    @IsNumber()
    blksize: number;

    @IsNumber()
    size: number;
    
    @IsNumber()
    blocks: number;
  
    @IsString()
    mtime: string;
  
    @IsString()
    birthtime: string;
  
    @IsString()
    extension: string;

    @IsString()
    permission: string;
}

export class createInventoryDTO {
    @IsString()
    mountPath: string;
  
    @IsString()
    fileServer: string;
  
    @IsString()
    fileName: string;
  
    @IsString()
    type: string;

    @ValidateNested()
    @Type(() => metadataDTO)
    metadata: metadataDTO;

    @IsString()
    parentPath: string;
}







