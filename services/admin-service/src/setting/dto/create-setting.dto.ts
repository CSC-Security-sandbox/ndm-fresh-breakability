import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CreateSettingDto {
  @ApiProperty({ description: 'Global Setting Key Name', example: 'SMTP_HOST' })
  @IsString()
  settingKey: string;
  @ApiProperty({
    description: 'Global Setting Value',
    example: 'smtp.gmail.com',
  })
  @IsString()
  settingValue: string;
  @ApiProperty({
    description: 'Global Setting Description',
    example: 'SMTP Host',
  })
  @IsString()
  description: string;

  @ApiProperty({ description: 'setting type', example: 'SMTP', nullable: true })
  settingType: SettingType;
}

export enum SettingType {
  SMTP = 'SMTP',
  BACKUP_LOCATION = 'BACKUP_LOCATION',
  SYSTEM = 'SYSTEM',
}
