import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsObject, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { Options } from "src/work-manager/dto/validate-connection.dto";
import { ListPathDTO } from "src/work-manager/dto/validate-export-path.dto";

export class ValidateExportPathAndWorkingDirectoryDTO {
    @ApiProperty({ description: 'Export path of a config' })
    @IsString()
    exportPath: string;

    @ApiProperty({ description: 'Working directory of a config' })
    @IsString()
    workingDirectory: string;

    @ApiProperty({ description: 'Config id of a config' })
    @IsString()
    configId: string;
   
    @ApiProperty({ type: [String], description: 'List of worker IDs (UUIDs)' })
    @IsArray()
    @IsUUID('4', { each: true })  
    workerIds: string[];

    @ApiProperty({ description: 'List path payload details' })
    @IsArray()
    listPathPayload: ListPathDTO[]

    @ApiProperty({ type: Options, description: 'Workflow options', required: false })
    @IsObject()
    @ValidateNested()
    @Type(() => Options)
    @IsOptional()
    options: Options = new Options();
}