import { ApiProperty } from '@nestjs/swagger';
import { Protocol } from 'src/constants/enums';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

class speedTests {
  @ApiProperty({ description: 'Read test' })
  @IsBoolean()
  readTest: boolean;
  @ApiProperty({ description: 'Write test' })
  @IsBoolean()
  writeTest: boolean;
  @ApiProperty({ description: 'packet loss test' })
  @IsBoolean()
  networkPerformance: boolean;
}

export class speedTestConfigOptions {
  @ApiProperty({ description: 'File serverr name' })
  @IsString()
  fileServer: string;

  @ApiProperty({ description: 'protocol for file server', required: false })
  @IsString()
  protocol?: Protocol;

  @ApiProperty({ description: 'List of workers' })
  @IsArray()
  workers: string[];

  @ApiProperty({ description: 'List of workers' })
  @ValidateNested({ each: true })
  @Type(() => speedTests)
  test: speedTests;
}

export class WriteReadResult {
  @ApiProperty({
    description: 'Total time taken for the operation',
    example: 2.982695291,
  })
  @IsNumber()
  totalTimeTaken: number;

  @ApiProperty({ description: 'Error in Read write test' })
  @IsString()
  error: string;

  @ApiProperty({
    description: 'Size of the file used in the test',
    example: 6442450944,
  })
  @IsNumber()
  fileSize: number;
}

export class RoundTripDelay {
  @ApiProperty({ description: 'Minimum round trip delay' })
  @IsNumber()
  min: number;

  @ApiProperty({ description: 'Average round trip delay' })
  @IsNumber()
  avg: number;

  @ApiProperty({ description: 'Maximum round trip delay' })
  @IsNumber()
  max: number;

  @ApiProperty({ description: 'Mean deviation of round trip delay' })
  @IsNumber()
  mdev: number;
}

export class NetworkPerformanceResult {
  @ApiProperty({ description: 'Packet loss percentage' })
  @IsNumber()
  packetLoss: number;

  @ApiProperty({ description: 'Error in NetworkPerformance test' })
  @IsString()
  error: string;

  @ApiProperty({ description: 'Round trip delay metrics' })
  @ValidateNested({ each: true })
  @Type(() => RoundTripDelay)
  roundTripDelay: RoundTripDelay;
}

export class SpeedTestResult {
  @ApiProperty({ description: 'UUID of traceId', required: true })
  @IsUUID()
  traceId: string;

  @ApiProperty({ description: 'UUID of workerId', required: true })
  @IsUUID()
  workerId: string;

  @ApiProperty({ description: 'UUID of fileServerID', required: true })
  @IsUUID()
  fileServerID: string;

  @ApiProperty({ description: 'Write result of the speed test' })
  @ValidateNested({ each: true })
  @Type(() => WriteReadResult)
  writeResult: WriteReadResult;

  @ApiProperty({ description: 'Read result of the speed test' })
  @ValidateNested({ each: true })
  @Type(() => WriteReadResult)
  readResult: WriteReadResult;

  @ApiProperty({ description: 'Network performance result' })
  @ValidateNested({ each: true })
  @Type(() => NetworkPerformanceResult)
  networkPerformanceResult: NetworkPerformanceResult;
}

export class JobConfigSpeedTest {
  @ApiProperty({
    description: 'Job schedule configuration',
    example: new Date().toISOString(),
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  firstRunAt: Date;

  @ApiProperty({
    description:
      'List of speedTest Fileserver config and tests to be performed ',
    isArray: true,
    type: speedTestConfigOptions,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => speedTestConfigOptions)
  speedTests: speedTestConfigOptions[];

  @ApiProperty({ description: 'UUID of createdBy', required: false })
  @IsOptional()
  @IsUUID()
  createdBy?: string;
}
