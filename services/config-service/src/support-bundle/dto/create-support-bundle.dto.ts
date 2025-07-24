import { IsOptional, IsArray, IsUUID, IsDateString } from 'class-validator';

export class CreateSupportBundleDTO {
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  projectIds?: string[];

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
