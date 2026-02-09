import { IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadChunkDto {
  @ApiProperty({ 
    description: 'Zero-based index of this chunk',
    example: 0
  })
  @IsNumber()
  @Min(0)
  chunkIndex: number;
}

export class UploadChunkResponseDto {
  @ApiProperty({ description: 'Whether chunk was received successfully' })
  received: boolean;

  @ApiProperty({ description: 'Index of the received chunk' })
  chunkIndex: number;

  @ApiProperty({ description: 'Bytes received for this chunk' })
  bytesReceived: number;
}