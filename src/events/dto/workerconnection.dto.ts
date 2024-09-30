import { IsArray, ArrayNotEmpty, IsString, ValidateNested, IsNotEmpty, IsOptional, ValidateIf, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments, Validate } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class NFSConnectionDetails {
  @ApiProperty({ description: 'Username of connection', example: 'username' })
  @IsString()
  @IsNotEmpty()
  userName: string;

  @ApiProperty({ description: 'Password of connection', example: 'password' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ description: 'Host of connection', example: 'host' })
  @IsString()
  @IsNotEmpty()
  host: string;

  @ApiProperty({ description: 'Protocol of connection', example: 'protocol' })
  @IsString()
  @IsNotEmpty()
  protocol: string;
}

export class SMBConnectionDetails {
  @ApiProperty({ description: 'Username of connection', example: 'username' })
  @IsString()
  @IsNotEmpty()
  userName: string;

  @ApiProperty({ description: 'Password of connection', example: 'password' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ description: 'Host of connection', example: 'host' })
  @IsString()
  @IsNotEmpty()
  host: string;

  @ApiProperty({ description: 'Protocol of connection', example: 'protocol' })
  @IsString()
  @IsNotEmpty()
  protocol: string;
}

export class WorkerDetails {
  @ApiProperty({ description: 'Worker ID', example: 'workerId' })
  @IsString()
  @IsNotEmpty()
  workerId: string;
}

@ValidatorConstraint({ name: 'atLeastOneConnection', async: false })
class AtLeastOneConnectionConstraint implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments) {
    const object = args.object as TestConnectionsDTO;
    return !!object.nfsConnectionDetails || !!object.sbmConnectionDetails;
  }

  defaultMessage(args: ValidationArguments) {
    return 'At least one of nfsConnectionDetails or sbmConnectionDetails must be provided';
  }
}

export class TestConnectionsDTO {
  @ApiProperty({
    description: 'List of worker details',
    type: [WorkerDetails],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => WorkerDetails)
  workers: WorkerDetails[];

  @ApiPropertyOptional({ description: 'NFS Connection Details for Worker' })
  @ValidateIf((o) => !o.sbmConnectionDetails)
  @ValidateNested()
  @Type(() => NFSConnectionDetails)
  @IsOptional()
  @IsNotEmpty()
  nfsConnectionDetails?: NFSConnectionDetails;

  @ApiPropertyOptional({ description: 'SMB Connection Details for Worker' })
  @ValidateIf((o) => !o.nfsConnectionDetails)
  @ValidateNested()
  @Type(() => SMBConnectionDetails)
  @IsOptional()
  @IsNotEmpty()
  sbmConnectionDetails?: SMBConnectionDetails;

  @Validate(AtLeastOneConnectionConstraint)
  validateConnection: boolean;

  @ApiPropertyOptional({description: 'configId'})
  @IsOptional()
  @IsString()
  configId: string
}
