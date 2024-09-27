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
    atime: string;
  
    @IsString()
    mtime: string;

    @IsString()
    ctime: string;
  
    @IsString()
    birthtime: string;
   
    @IsString()
    fileName: string;
  
    @IsString()
    filePath: string;
  
    @IsString()
    extension: string;

    @IsString()
    type: string;
  
    @IsBoolean()
    folder: boolean;

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
  
    @IsBoolean()
    folder: boolean;

    @ValidateNested()
    @Type(() => metadataDTO)
    metadata: metadataDTO
}







