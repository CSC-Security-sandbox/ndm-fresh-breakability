import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAccountDto {
  @ApiProperty({ description: 'Name of account to be created' })
  @IsString()
  account_name: string;
}
