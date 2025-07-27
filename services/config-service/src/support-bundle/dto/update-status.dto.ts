import { IsUUID, IsEnum } from 'class-validator';
import { SupportBundleStatus } from 'src/constants/enums';

export class UpdateStatusDto {
  @IsUUID()
  traceId: string;

  @IsEnum(SupportBundleStatus)
  status: SupportBundleStatus;
}
