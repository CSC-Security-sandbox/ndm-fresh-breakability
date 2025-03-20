import { IsString } from 'class-validator';

export class ConsumerDto {
  @IsString()
  jobRunId: string;

  @IsString()
  readerName: string;

  @IsString()
  consumerType: string;
}
