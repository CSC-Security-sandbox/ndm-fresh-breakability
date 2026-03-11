import { ApiProperty } from '@nestjs/swagger';
export class HealthCheckResponse {
  @ApiProperty({ description: 'HTTP status code of the response' })
  statusCode: number;

  @ApiProperty({
    description: 'Error details (if any)',
    required: false,
    nullable: true,
  })
  error?: string | null;
}
