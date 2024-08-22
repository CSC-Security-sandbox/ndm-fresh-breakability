import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class UpdateCustomerDTO{
    @ApiPropertyOptional({
        description: "Name of Customer",
        example: "Example Org Inc"
    })
    @IsOptional()
    @IsString()
    orgName?: string;

    @ApiPropertyOptional({
        description: "Email of Customer",
        example: "info@test.com"
    })
    @IsOptional()
    @IsString()    
    email?: string;
}