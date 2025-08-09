import { IsUUID, IsEnum, IsString, IsOptional } from 'class-validator';
import { SupportBundleStatus } from 'src/constants/enums';

export class UpdateStatusDto {
  @IsUUID()
  traceId: string;

  @IsEnum(SupportBundleStatus)
  status: SupportBundleStatus;

  @IsOptional()
  @IsString()
  errorMessage?: string | null;
}
