import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, IsArray, IsObject, IsOptional, ValidateNested, IsUUID } from 'class-validator';
import { Trim } from '../../utils/transformers';
import { ExportPathSource } from 'src/constants/enums';
import { WORKFLOW_EXECUTION_TIMEOUT_SECONDS } from 'src/constants/constants';

class Protocol {
  @ApiProperty({ enum: ['NFS', 'SMB'], description: 'The type of protocol (NFS or SMB)' })
  @IsString()
  type: 'NFS' | 'SMB';

  @ApiProperty({ description: 'The username for the protocol' })
  @IsString()
  username: string;

  @ApiProperty({ description: 'The password for the protocol (optional)', required: false })
  @IsOptional()
  @IsString()
  password?: string;

  // exportPathSource
  @ApiProperty({ description: 'export path source' })
  @IsOptional()
  @IsString()
  exportPathSource: ExportPathSource
}

class FileServer {
  @ApiProperty({ description: 'The hostname of the file server' })
  @IsString()
  @Trim()
  hostname: string;

  @ApiProperty({
    type: [Protocol],
    description: 'List of protocols supported by the file server',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Protocol)
  protocols: Protocol[];
}

export class Options {
  @ApiProperty({ description: 'Timeout for workflow execution', default: `${WORKFLOW_EXECUTION_TIMEOUT_SECONDS}s`, required: false })
  @IsOptional()
  @IsString()
  workflowExecutionTimeout: string = `${WORKFLOW_EXECUTION_TIMEOUT_SECONDS}s`;

  @ApiProperty({ description: 'Timeout for workflow task', default: '30s', required: false })
  @IsOptional()
  @IsString()
  workflowTaskTimeout: string = '30s';

  @ApiProperty({ description: 'Timeout for workflow run', default: '30s', required: false })
  @IsOptional()
  @IsString()
  workflowRunTimeout: string = '30s';

  @ApiProperty({ description: 'Delay before starting the workflow', default: '10s', required: false })
  @IsOptional()
  @IsString()
  startDelay: string = '1s';
}

export class CreateRequestDto {
  @ApiProperty({ type: FileServer, description: 'The file server details' })
  @IsObject()
  @ValidateNested()
  @Type(() => FileServer)
  fileServer: FileServer;

  @ApiProperty({ type: [String], description: 'List of worker IDs (UUIDs)' })
  @IsArray()
  @IsUUID('4', { each: true })  
  workerIds: string[];

  @ApiProperty({ type: Options, description: 'Workflow options', required: false })
  @IsObject()
  @ValidateNested()
  @Type(() => Options)
  @IsOptional()
  options: Options = new Options();
}
