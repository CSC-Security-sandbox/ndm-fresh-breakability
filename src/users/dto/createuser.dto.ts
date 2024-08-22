import { IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateUserDTO{
    @ApiProperty({
        description: "Name of User",
        example: "John Smith"
    })
    @IsNotEmpty()
    @IsString()
    userName: string;

    @ApiProperty({
        description: "Email of User",
        example: "john@smith@test.com"
    })
    @IsNotEmpty()
    @IsString()    
    email: string;

    @ApiProperty({
        description: "Password",
        example: "abcd@1234"
    })
    @IsNotEmpty()
    @IsString()    
    password: string;

    @ApiProperty({
        description: "UserId of creator",
        example: "UUID"
    })
    @IsNotEmpty()
    @IsString()    
    createdBy: string;
}