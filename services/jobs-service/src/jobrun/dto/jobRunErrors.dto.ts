import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ErrorType } from "@netapp-cloud-datamigrate/jobs-lib";
import { Transform } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";

export class JobErrorQueryDto {
  @ApiPropertyOptional({
    description: "Page number for pagination",
    example: "1",
  })
  @IsOptional()
  @IsNumberString()
  page?: string;

  @ApiPropertyOptional({
    description: "Number of items per page",
    example: "10",
  })
  @IsOptional()
  @IsNumberString()
  limit?: string;

  @ApiPropertyOptional({
    description: "Field to sort by",
    example: "createdAt",
    enum: ["createdAt"],
  })
  @IsOptional()
  @IsIn(["createdAt"])
  sort?: string;

  @ApiPropertyOptional({
    description: "Order of sorting",
    example: "asc",
    enum: ["ASC", "DESC"],
  })
  @IsOptional()
  @IsIn(["ASC", "DESC"])
  order?: "ASC" | "DESC";

  @ApiPropertyOptional({
    description: "Filter by task IDs",
    isArray: true,
    example: [
      "123e4567-e89b-12d3-a456-426614174000",
      "123e4567-e89b-12d3-a456-426614174001",
    ],
  })
  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @ArrayMinSize(1)
  operationId?: string[];

  @ApiProperty({
    description: "Job run ID for filtering",
    example: "123e4567-e89b-12d3-a456-426614174000",
  })
  @IsUUID("4")
  jobRunId?: string;

  @ApiPropertyOptional({
    description: "Error type for filtering",
    example: "TRANSIENT_ERROR",
    enum: ["FATAL_ERROR", "TRANSIENT_ERROR", "RECOVERABLE_ERROR", "METADATA_UPDATE_CONFLICT"],
  })
  @IsEnum(ErrorType)
  errorType?: ErrorType;
}
