import { IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateCustomerDTO{
    @ApiProperty({
        description: "Name of Organization",
        example: "Some Organization Name"
    })
    @IsNotEmpty()
    @IsString()
    orgName: string;

    @ApiProperty({
        description: "Email of Organization",
        example: "info@test.com"
    })
    @IsNotEmpty()
    @IsString()    
    email: string;
}