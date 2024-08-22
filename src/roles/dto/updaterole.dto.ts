import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class UpdateRoleDTO{
    @ApiPropertyOptional({
        description: "Name of Role",
        example: "Admin"
    })
    @IsOptional()
    @IsString()
    name?: string;

    @ApiPropertyOptional({
        description: "UserId of creator",
        example: "UUID"
    })
    @IsNotEmpty()
    @IsString()    
    createdBy?: string;
}