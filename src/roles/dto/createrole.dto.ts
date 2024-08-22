import { IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateRoleDTO{
    @ApiProperty({
        description: "Name of Role",
        example: "Admin"
    })
    @IsNotEmpty()
    @IsString()
    name: string;

    @ApiProperty({
        description: "UserId of creator",
        example: "UUID"
    })
    @IsNotEmpty()
    @IsString()    
    createdBy: string;
}