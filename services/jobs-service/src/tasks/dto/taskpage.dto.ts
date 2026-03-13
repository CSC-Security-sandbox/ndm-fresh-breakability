import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsNumberString,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { TaskStatus, TaskType } from 'src/constants/enums';

export class TaskQueryParamsDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination',
    example: '1',
  })
  @IsOptional()
  @IsNumberString()
  page?: string;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: '10',
  })
  @IsOptional()
  @IsNumberString()
  limit?: string;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    example: 'createdAt',
    enum: ['createdAt', 'updatedAt'],
  })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt'])
  sort?: string;

  @ApiPropertyOptional({
    description: 'Order of sorting',
    example: 'asc',
    enum: ['asc', 'desc'],
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({
    description: 'Filter by operation types',
    enum: TaskType,
    isArray: true,
    example: [TaskType.Migrate, TaskType.Copy],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(TaskType, { each: true })
  @Transform(({ value }: { value: TaskType | TaskType[] }): TaskType[] =>
    Array.isArray(value) ? value : [value],
  )
  @ArrayMinSize(1)
  taskType?: TaskType[];

  @ApiPropertyOptional({
    description: 'Filter by task IDs',
    isArray: true,
    example: [
      '123e4567-e89b-12d3-a456-426614174000',
      '123e4567-e89b-12d3-a456-426614174001',
    ],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }: { value: string | string[] }): string[] =>
    Array.isArray(value) ? value : [value],
  )
  @ArrayMinSize(1)
  id?: string[];

  @ApiPropertyOptional({
    description: 'Filter by worker IDs',
    isArray: true,
    example: [
      '123e4567-e89b-12d3-a456-426614174000',
      '123e4567-e89b-12d3-a456-426614174001',
    ],
  })
  @IsOptional()
  @IsArray()
  @Transform(({ value }: { value: string | string[] }): string[] =>
    Array.isArray(value) ? value : [value],
  )
  @IsUUID('4', { each: true })
  workerId?: string[];

  @ApiPropertyOptional({
    description: 'Filter by task statuses',
    enum: TaskStatus,
    isArray: true,
    example: [TaskStatus.Completed, TaskStatus.Pending],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(TaskStatus, { each: true })
  @Transform(({ value }: { value: TaskStatus | TaskStatus[] }): TaskStatus[] =>
    Array.isArray(value) ? value : [value],
  )
  status?: TaskStatus[];

  @ApiProperty({
    description: 'Job run ID for filtering',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4')
  jobRunId?: string;
}
