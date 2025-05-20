import { IsString } from 'class-validator';

export class ConsumerDto {
  @IsString()
  jobRunId: string;
}
