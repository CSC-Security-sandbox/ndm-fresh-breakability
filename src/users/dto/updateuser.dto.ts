import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class UpdateUserDTO{
    @ApiPropertyOptional({
        description: "Name of User",
        example: "John Smith"
    })
    @IsOptional()
    @IsString()
    userName?: string;

    @ApiPropertyOptional({
        description: "Email of User",
        example: "john@smith@test.com"
    })
    @IsOptional()
    @IsString()    
    email?: string;

    @ApiPropertyOptional({
        description: "Password",
        example: "abcd@1234"
    })
    @IsOptional()
    @IsString()    
    password?: string;

    @ApiPropertyOptional({
        description: "UserId of creator",
        example: "UUID"
    })
    @IsNotEmpty()
    @IsString()    
    createdBy?: string;
}