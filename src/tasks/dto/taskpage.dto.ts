import { 
    IsOptional, 
    IsString, 
    IsInt, 
    IsArray, 
    ArrayMinSize, 
    Min, 
    IsIn, 
    IsNumberString, 
    IsEnum, 
    IsUUID 
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TaskStatus, TaskType } from 'src/constants/enums';

export class TaskQueryParamsDto {
    @ApiPropertyOptional({ 
        description: 'Page number for pagination', 
        example: '1' 
    })
    @IsOptional()
    @IsNumberString()
    page?: string;

    @ApiPropertyOptional({ 
        description: 'Number of items per page', 
        example: '10' 
    })
    @IsOptional()
    @IsNumberString()
    limit?: string;

    @ApiPropertyOptional({ 
        description: 'Field to sort by', 
        example: 'createdAt', 
        enum: ['createdAt', 'createdBy', 'updatedAt', 'updatedBy'] 
    })
    @IsOptional()
    @IsIn(['createdAt', 'createdBy', 'updatedAt', 'updatedBy'])
    sort?: string;

    @ApiPropertyOptional({ 
        description: 'Order of sorting', 
        example: 'asc', 
        enum: ['asc', 'desc'] 
    })
    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: 'asc' | 'desc';

    @ApiPropertyOptional({ 
        description: 'Filter by operation types', 
        enum: TaskType, 
        isArray: true,
        example: [TaskType.Migrate, TaskType.Copy] 
    })
    @IsOptional()
    @IsArray()
    @IsEnum(TaskType, { each: true }) 
    @ArrayMinSize(1)                     
    @Type(() => String)                  
    operationType?: TaskType[];

    @ApiPropertyOptional({ 
        description: 'Filter by task IDs', 
        isArray: true, 
        example: ['123e4567-e89b-12d3-a456-426614174000', '123e4567-e89b-12d3-a456-426614174001'] 
    })
    @IsOptional()
    @IsArray()
    @IsUUID('4', { each: true }) 
    @ArrayMinSize(1)            
    @Type(() => String)         
    id?: string[];

    @ApiPropertyOptional({ 
        description: 'Filter by worker IDs', 
        isArray: true, 
        example: ['123e4567-e89b-12d3-a456-426614174000', '123e4567-e89b-12d3-a456-426614174001'] 
    })
    @IsOptional()
    @IsArray()
    @IsUUID('4', { each: true }) 
    @ArrayMinSize(1)            
    @Type(() => String)         
    workerId?: string[];

    @ApiPropertyOptional({ 
        description: 'Filter by task statuses', 
        enum: TaskStatus, 
        isArray: true,
        example: [TaskStatus.Completed, TaskStatus.Pending] 
    })
    @IsOptional()
    @IsArray()
    @IsEnum(TaskStatus, { each: true }) 
    @ArrayMinSize(1)                     
    @Type(() => String)                  
    status?: TaskStatus[];

    @ApiPropertyOptional({ 
        description: 'Page number for pagination', 
        example: '1' 
    })
    @IsOptional()
    @IsNumberString()
    jobRunId?: string;
}
