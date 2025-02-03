import { IsString } from 'class-validator';

export class ConsumerDto {
  @IsString()
  streamKey: string;

  @IsString()
  jobRunId: string;

  @IsString()
  readerName: string;

  @IsString()
  consumerType: string;
}
