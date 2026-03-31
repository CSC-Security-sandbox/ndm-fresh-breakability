import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class AsupSettingsDto {
  @ApiProperty({ description: 'Whether ASUP is enabled' })
  enabled: boolean;

  @ApiProperty({ description: 'Last time settings were updated', required: false })
  lastUpdated?: string;
}

export class UpdateAsupSettingsDto {
  @ApiProperty({ description: 'Whether ASUP is enabled'})
  @IsBoolean()
  enabled: boolean;
}

export class SendSupportBundleDto {
  @ApiProperty({ description: 'Support bundle file name', example: 'ndm_logs_user-id.zip' })
  fileName: string;

  @ApiProperty({ description: 'Support bundle file content encoded as base64' })
  bundleBase64: string;
}
