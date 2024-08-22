import { IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ProjectPageDTO {
  @ApiPropertyOptional({
      description: "Current Page Number",
      example: "1",
      default: 1
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({
    description: "Number of Rows",
    example: "10",
    default: 10
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;
}
