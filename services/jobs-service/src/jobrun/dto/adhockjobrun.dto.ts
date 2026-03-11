import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class AdHocRunDTO {
  @ApiProperty({ description: 'UUID of Job Config Id' })
  @IsUUID()
  jobConfigId: string;

  @ApiPropertyOptional({
    description: 'UUID of Job Run Id to retry failed items from',
  })
  @IsOptional()
  @IsUUID()
  jobRunId?: string;
}
