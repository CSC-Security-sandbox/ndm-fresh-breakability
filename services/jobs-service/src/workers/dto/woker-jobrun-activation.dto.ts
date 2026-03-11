import { ApiProperty } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsUUID } from 'class-validator';

export class WorkerJobRunActivationParamsDto {
  @ApiProperty({
    description: 'The UUID v4 of the worker',
    format: 'uuid',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4', { message: 'workerId must be a valid UUID v4' })
  @IsNotEmpty()
  workerId: string;

  @ApiProperty({
    description: 'The UUID v4 of the job run',
    format: 'uuid',
    example: 'a7b8c9d0-e1f2-3g4h-5i6j-7890k1l2m3n4',
  })
  @IsUUID('4', { message: 'jobrunId must be a valid UUID v4' })
  @IsNotEmpty()
  jobrunId: string;

  @ApiProperty({
    description:
      "Activation status of the worker job run ('true' or 'false' as string in URL)",
    enum: ['true', 'false'],
    example: 'true',
  })
  @Expose()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean({ message: 'activationStatus must be a boolean value' })
  @IsNotEmpty()
  active: boolean;
}
