import { IsDate, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateProjectDto {
  @ApiProperty({ description: 'Account Id for which project is to be created' })
  @IsString()
  account_id: string;

  @ApiProperty({ description: 'Name of project to be created' })
  @IsString()
  project_name: string;

  @ApiProperty({ description: 'Description of project' })
  @IsString()
  @IsOptional()
  project_description: string;

  @ApiProperty({ description: 'Start date of the project' })
  @IsDate()
  @Type(() => Date)
  start_date: Date;
}
